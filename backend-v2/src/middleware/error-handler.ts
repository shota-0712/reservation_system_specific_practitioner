/**
 * Error Handling Middleware
 * Centralized error handling for the API
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { isApiError, ValidationError, ConflictError } from '../utils/errors.js';
import { logError, logRequest } from '../utils/logger.js';
import { env } from '../config/env.js';
import type { ApiResponse, AuthenticatedRequest } from '../types/index.js';

type PgErrorLike = {
    code?: string;
    constraint?: string;
    detail?: string;
};

/**
 * Handle Zod validation errors
 */
function formatZodError(error: ZodError): Record<string, string[]> {
    const formatted: Record<string, string[]> = {};

    for (const issue of error.issues) {
        const path = issue.path.join('.');
        if (!formatted[path]) {
            formatted[path] = [];
        }
        formatted[path].push(issue.message);
    }

    return formatted;
}

/**
 * Global error handler middleware
 */
export function errorHandler() {
    return (error: Error, req: Request, res: Response, _next: NextFunction): void => {
        const authenticatedReq = req as AuthenticatedRequest;

        // Log the error
        logError(error, {
            path: req.path,
            method: req.method,
            tenantId: authenticatedReq.tenantId,
            userId: authenticatedReq.user?.uid,
        });

        // Handle Zod validation errors
        if (error instanceof ZodError) {
            const validationError = new ValidationError('入力データが無効です', {
                validationErrors: formatZodError(error),
            });

            const response: ApiResponse = {
                success: false,
                error: {
                    code: validationError.code,
                    message: validationError.message,
                    details: validationError.details,
                },
            };

            res.status(400).json(response);
            return;
        }

        // Handle our custom API errors
        if (isApiError(error)) {
            const response: ApiResponse = {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    details: error.details,
                },
            };

            res.status(error.statusCode).json(response);
            return;
        }

        // Handle unknown errors
        // PostgreSQL exclusion constraint violation (double-booking, etc.)
        const pg = error as unknown as PgErrorLike;
        if (pg?.code === '23P01') {
            const conflict = new ConflictError('選択された時間帯はすでに予約が入っています', {
                code: pg.code,
                constraint: pg.constraint,
                detail: pg.detail,
            });

            const response: ApiResponse = {
                success: false,
                error: {
                    code: conflict.code,
                    message: conflict.message,
                    details: conflict.details,
                },
            };

            res.status(conflict.statusCode).json(response);
            return;
        }

        const statusCode = 500;
        const response: ApiResponse = {
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: env.NODE_ENV === 'production'
                    ? 'サーバーエラーが発生しました'
                    : error.message,
                details: env.NODE_ENV === 'production'
                    ? undefined
                    : { stack: error.stack },
            },
        };

        res.status(statusCode).json(response);
    };
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler() {
    return (req: Request, res: Response): void => {
        const response: ApiResponse = {
            success: false,
            error: {
                code: 'NOT_FOUND',
                message: `エンドポイント ${req.method} ${req.path} が見つかりません`,
            },
        };

        res.status(404).json(response);
    };
}

/**
 * Request logging middleware
 */
export function requestLogger() {
    return (req: Request, res: Response, next: NextFunction): void => {
        const startTime = Date.now();
        const authenticatedReq = req as AuthenticatedRequest;

        // Log after response is sent
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            logRequest(
                req.method,
                req.path,
                res.statusCode,
                duration,
                authenticatedReq.tenantId
            );
        });

        next();
    };
}

/**
 * Async handler wrapper
 * Catches errors from async route handlers and passes them to error middleware
 */
export function asyncHandler<T>(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
    return (req: Request, res: Response, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
