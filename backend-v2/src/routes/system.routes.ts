/**
 * Health Check & System Routes
 */

import { Router, Request, Response } from 'express';
import { env } from '../config/env.js';
import { checkReadiness } from '../services/readiness.service.js';
import type { ApiResponse } from '../types/index.js';

const router = Router();

/**
 * GET /health
 * Health check endpoint for Cloud Run
 */
router.get('/health', (_req: Request, res: Response) => {
    const response: ApiResponse<{ status: string; timestamp: string }> = {
        success: true,
        data: {
            status: 'healthy',
            timestamp: new Date().toISOString(),
        },
    };

    res.json(response);
});

/**
 * GET /ready
 * Readiness check endpoint
 */
router.get('/ready', (_req: Request, res: Response) => {
    checkReadiness().then(({ ready, checks, required }) => {
        const response: ApiResponse<{ ready: boolean; checks: typeof checks; required: typeof required }> = {
            success: ready,
            data: {
                ready,
                checks,
                required,
            },
            error: ready
                ? undefined
                : {
                    code: 'INTERNAL_ERROR',
                    message: 'Readiness check failed',
                },
        };
        res.status(ready ? 200 : 503).json(response);
    }).catch(() => {
        const checks = {
            database: false,
            firebase: false,
            line: false,
            lineConfigured: false,
            googleOauthConfigured: false,
            writeFreezeMode: env.WRITE_FREEZE_MODE,
        };
        const response: ApiResponse<{
            ready: boolean;
            checks: typeof checks;
            required: {
                database: true;
                firebase: true;
                line: boolean;
                googleOauthConfigured: boolean;
            };
        }> = {
            success: false,
            data: {
                ready: false,
                checks,
                required: {
                    database: true,
                    firebase: true,
                    line: env.READINESS_REQUIRE_LINE,
                    googleOauthConfigured: env.READINESS_REQUIRE_GOOGLE_OAUTH,
                },
            },
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Readiness check failed',
            },
        };
        res.status(503).json(response);
    });
});

/**
 * GET /info
 * API information (non-sensitive)
 */
router.get('/info', (_req: Request, res: Response) => {
    const response: ApiResponse<{
        name: string;
        version: string;
        environment: string;
    }> = {
        success: true,
        data: {
            name: 'Reservation System API',
            version: '2.0.0',
            environment: env.NODE_ENV,
        },
    };

    res.json(response);
});

export const systemRoutes = router;
