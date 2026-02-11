import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import type { ApiResponse } from '../types/index.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function writeFreezeGuard() {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!env.WRITE_FREEZE_MODE) {
            next();
            return;
        }

        if (!MUTATING_METHODS.has(req.method)) {
            next();
            return;
        }

        if (!req.path.startsWith('/api/v1/')) {
            next();
            return;
        }

        const response: ApiResponse = {
            success: false,
            error: {
                code: 'MAINTENANCE_MODE',
                message: '現在メンテナンス中のため、更新操作を一時停止しています',
                details: {
                    writeFreezeMode: true,
                },
            },
        };

        res.status(503).json(response);
    };
}

