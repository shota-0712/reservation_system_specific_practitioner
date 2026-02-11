/**
 * Winston Logger Configuration
 * Structured logging for production
 */

import winston from 'winston';
import { env } from '../config/env.js';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// Custom format for development
const devFormat = printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
});

// Create logger instance
export const logger = winston.createLogger({
    level: env.LOG_LEVEL,
    defaultMeta: {
        service: 'reservation-api',
    },
    transports: [
        // Console transport
        new winston.transports.Console({
            format: env.NODE_ENV === 'production'
                ? combine(
                    timestamp(),
                    errors({ stack: true }),
                    json()
                )
                : combine(
                    colorize(),
                    timestamp({ format: 'HH:mm:ss' }),
                    errors({ stack: true }),
                    devFormat
                ),
        }),
    ],
});

// Request logging helper
export function logRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    tenantId?: string
): void {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logger.log(level, `${method} ${path} ${statusCode} ${duration}ms`, {
        type: 'request',
        method,
        path,
        statusCode,
        duration,
        tenantId,
    });
}

// Error logging helper
export function logError(
    error: Error,
    context?: Record<string, unknown>
): void {
    logger.error(error.message, {
        type: 'error',
        stack: error.stack,
        name: error.name,
        ...context,
    });
}

// Audit logging helper
export function logAudit(
    action: string,
    userId: string,
    tenantId: string,
    resourceType: string,
    resourceId: string,
    details?: Record<string, unknown>
): void {
    logger.info(`Audit: ${action}`, {
        type: 'audit',
        action,
        userId,
        tenantId,
        resourceType,
        resourceId,
        details,
        timestamp: new Date().toISOString(),
    });
}
