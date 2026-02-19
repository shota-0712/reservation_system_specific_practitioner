/**
 * Validation Middleware
 * Request body/query/params validation using Zod
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors.js';

/**
 * Validate request body
 */
export function validateBody<T extends ZodSchema>(schema: T) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            // BUG-26 fix: wrap ZodError in ValidationError so all middleware in the chain
            // receives an ApiError instance rather than a raw ZodError.
            return next(new ValidationError('入力値が不正です', {
                issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
            }));
        }

        // Replace body with parsed data (includes defaults, transformations)
        req.body = result.data;
        next();
    };
}

/**
 * Validate request query parameters
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.query);

        if (!result.success) {
            return next(new ValidationError('クエリパラメータが不正です', {
                issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
            }));
        }

        // req.query can be exposed as a getter-only property depending on runtime/router versions.
        // Mutate the underlying query object instead of reassigning to avoid TypeError.
        const currentQuery = req.query as Record<string, unknown>;
        for (const key of Object.keys(currentQuery)) {
            delete currentQuery[key];
        }
        Object.assign(currentQuery, result.data as Record<string, unknown>);
        next();
    };
}

/**
 * Validate request params
 */
export function validateParams<T extends ZodSchema>(schema: T) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.params);

        if (!result.success) {
            return next(new ValidationError('パスパラメータが不正です', {
                issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
            }));
        }

        req.params = result.data;
        next();
    };
}

// ============================================
// Common Validation Schemas
// ============================================

/**
 * Pagination schema
 */
export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * ID parameter schema
 */
export const idParamSchema = z.object({
    id: z.string().min(1, 'IDは必須です'),
});

/**
 * Tenant ID parameter schema
 */
export const tenantIdParamSchema = z.object({
    tenantId: z.string().min(1, 'テナントIDは必須です'),
});

/**
 * Date range query schema
 */
export const dateRangeSchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付はYYYY-MM-DD形式で入力してください'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付はYYYY-MM-DD形式で入力してください'),
}).refine(
    data => new Date(data.startDate) <= new Date(data.endDate),
    { message: '開始日は終了日より前にしてください' }
);

/**
 * Japanese phone number schema
 */
export const phoneSchema = z.string()
    .regex(/^0[0-9]{9,10}$/, '電話番号の形式が正しくありません')
    .optional();

/**
 * Email schema with Japanese error message
 */
export const emailSchema = z.string()
    .email('メールアドレスの形式が正しくありません')
    .optional();

/**
 * Time string schema (HH:mm)
 */
export const timeSchema = z.string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, '時刻はHH:mm形式で入力してください');

/**
 * Date string schema (YYYY-MM-DD)
 */
export const dateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付はYYYY-MM-DD形式で入力してください');
