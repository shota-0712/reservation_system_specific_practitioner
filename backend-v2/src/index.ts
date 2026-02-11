/**
 * Reservation System API - Main Entry Point
 * TypeScript + Express + PostgreSQL
 */

import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { env, logConfig } from './config/env.js';
import { initializeFirebase } from './config/firebase.js';
import { logger } from './utils/logger.js';
import {
    errorHandler,
    notFoundHandler,
    requestLogger,
    writeFreezeGuard,
} from './middleware/index.js';
import { systemRoutes } from './routes/system.routes.js';
import { v1Router } from './routes/v1/index.js';
import { platformOnboardingRoutes } from './routes/platform/onboarding.routes.js';

// Initialize Firebase
initializeFirebase();

// Create Express app
const app: Express = express();

// ============================================
// Security Middleware
// ============================================

// Helmet for security headers
app.use(helmet({
    contentSecurityPolicy: false, // Disable for API
    crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) {
            return callback(null, true);
        }

        // Check if origin is allowed
        const isAllowed = env.ALLOWED_ORIGINS.some(allowed => {
            if (allowed.includes('*')) {
                const regex = new RegExp('^' + allowed.replace(/\*/g, '.*') + '$');
                return regex.test(origin);
            }
            return allowed === origin;
        });

        if (isAllowed) {
            callback(null, true);
        } else {
            logger.warn(`CORS blocked origin: ${origin}`);
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMITED',
            message: 'リクエスト数が制限を超えました。しばらく待ってからお試しください。',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health' || req.path === '/ready';
    },
});
app.use(limiter);

// ============================================
// Body Parsing
// ============================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// Request Logging
// ============================================

app.use(requestLogger());

// ============================================
// Trust Proxy (for Cloud Run)
// ============================================

app.set('trust proxy', 1);

// ============================================
// Routes
// ============================================

// System routes (health check, info)
app.use('/', systemRoutes);

// Write freeze guard for planned cutover (blocks mutating API requests)
app.use(writeFreezeGuard());

// API v1 routes
app.use('/api/v1/:tenantKey', v1Router);
app.use('/api/platform/v1', platformOnboardingRoutes);

// Legacy route support (without version)
// app.use('/api/:tenantKey', v1Router);

// ============================================
// Error Handling
// ============================================

// 404 handler
app.use(notFoundHandler());

// Global error handler
app.use(errorHandler());

// ============================================
// Graceful Shutdown
// ============================================

function gracefulShutdown(signal: string): void {
    logger.info(`${signal} received. Shutting down gracefully...`);

    // Give ongoing requests some time to complete
    setTimeout(() => {
        logger.info('Shutdown complete.');
        process.exit(0);
    }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================
// Start Server
// ============================================

const server = app.listen(env.PORT, env.HOST, () => {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║   🚀 Reservation System API v2.0                           ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    logConfig();
    console.log(`\n📡 Server listening on http://${env.HOST}:${env.PORT}`);
    console.log('');
});

// Handle server errors
server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${env.PORT} is already in use`);
    } else {
        logger.error('Server error:', { error });
    }
    process.exit(1);
});

export { app };
