/**
 * Custom Error Classes
 * Structured error handling for the API
 */

export type ErrorCode =
    | 'VALIDATION_ERROR'
    | 'AUTHENTICATION_ERROR'
    | 'AUTHORIZATION_ERROR'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'RATE_LIMITED'
    | 'TENANT_NOT_FOUND'
    | 'TENANT_INACTIVE'
    | 'INTERNAL_ERROR'
    | 'EXTERNAL_SERVICE_ERROR';

export interface ErrorDetails {
    code: ErrorCode;
    message: string;
    statusCode: number;
    details?: Record<string, unknown>;
}

/**
 * Base API Error
 */
export class ApiError extends Error {
    public readonly code: ErrorCode;
    public readonly statusCode: number;
    public readonly details?: Record<string, unknown>;
    public readonly isOperational: boolean;

    constructor(
        code: ErrorCode,
        message: string,
        statusCode: number,
        details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }

    toJSON(): ErrorDetails {
        return {
            code: this.code,
            message: this.message,
            statusCode: this.statusCode,
            details: this.details,
        };
    }
}

/**
 * Validation Error (400)
 */
export class ValidationError extends ApiError {
    constructor(message: string, details?: Record<string, unknown>) {
        super('VALIDATION_ERROR', message, 400, details);
        this.name = 'ValidationError';
    }
}

/**
 * Authentication Error (401)
 */
export class AuthenticationError extends ApiError {
    constructor(message = '認証が必要です') {
        super('AUTHENTICATION_ERROR', message, 401);
        this.name = 'AuthenticationError';
    }
}

/**
 * Authorization Error (403)
 */
export class AuthorizationError extends ApiError {
    constructor(message = 'この操作を行う権限がありません') {
        super('AUTHORIZATION_ERROR', message, 403);
        this.name = 'AuthorizationError';
    }
}

/**
 * Not Found Error (404)
 */
export class NotFoundError extends ApiError {
    constructor(resource: string, id?: string) {
        const message = id
            ? `${resource}（ID: ${id}）が見つかりません`
            : `${resource}が見つかりません`;
        super('NOT_FOUND', message, 404, { resource, id });
        this.name = 'NotFoundError';
    }
}

/**
 * Conflict Error (409)
 */
export class ConflictError extends ApiError {
    constructor(message: string, details?: Record<string, unknown>) {
        super('CONFLICT', message, 409, details);
        this.name = 'ConflictError';
    }
}

/**
 * Rate Limit Error (429)
 */
export class RateLimitError extends ApiError {
    constructor(retryAfter?: number) {
        super('RATE_LIMITED', 'リクエスト数が制限を超えました。しばらく待ってからお試しください。', 429, {
            retryAfter,
        });
        this.name = 'RateLimitError';
    }
}

/**
 * Tenant Not Found Error (404)
 */
export class TenantNotFoundError extends ApiError {
    constructor(tenantId?: string) {
        super('TENANT_NOT_FOUND', '店舗が見つかりません', 404, { tenantId });
        this.name = 'TenantNotFoundError';
    }
}

/**
 * Tenant Inactive Error (403)
 */
export class TenantInactiveError extends ApiError {
    constructor(tenantId?: string) {
        super('TENANT_INACTIVE', 'この店舗は現在利用できません', 403, { tenantId });
        this.name = 'TenantInactiveError';
    }
}

/**
 * External Service Error (502)
 */
export class ExternalServiceError extends ApiError {
    constructor(service: string, originalError?: Error) {
        super('EXTERNAL_SERVICE_ERROR', `外部サービス（${service}）との通信に失敗しました`, 502, {
            service,
            originalMessage: originalError?.message,
        });
        this.name = 'ExternalServiceError';
    }
}

/**
 * Check if an error is our custom API error
 */
export function isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
}

/**
 * Wrap unknown error into ApiError
 */
export function wrapError(error: unknown): ApiError {
    if (isApiError(error)) {
        return error;
    }

    if (error instanceof Error) {
        return new ApiError('INTERNAL_ERROR', error.message, 500);
    }

    return new ApiError('INTERNAL_ERROR', 'An unexpected error occurred', 500);
}
