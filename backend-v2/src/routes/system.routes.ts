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
    checkReadiness().then(({ ready, checks }) => {
        const response: ApiResponse<{ ready: boolean; checks: typeof checks }> = {
            success: ready,
            data: {
                ready,
                checks,
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
        const response: ApiResponse<{ ready: boolean; checks: typeof checks }> = {
            success: false,
            data: {
                ready: false,
                checks,
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
