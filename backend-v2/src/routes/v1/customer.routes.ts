/**
 * Customer Routes
 * 顧客管理 API
 */

import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { getTenant } from '../../middleware/tenant.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { validateBody, validateParams, validateQuery, idParamSchema } from '../../middleware/validation.js';
import { CustomerRepository } from '../../repositories/customer.repository.js';
import { z } from 'zod';

const router = Router();

// バリデーションスキーマ
const updateCustomerSchema = z.object({
    name: z.string().min(1).optional(),
    phoneNumber: z.string().optional(),
    email: z.string().email().optional().nullable(),
    birthDate: z.string().optional().nullable(),
    gender: z.enum(['male', 'female', 'other', 'undisclosed']).optional().nullable(),
    memo: z.string().optional().nullable(),
    tags: z.array(z.string()).optional(),
    notificationSettings: z.object({
        reminder: z.boolean().optional(),
        marketing: z.boolean().optional(),
    }).optional(),
});

const searchCustomerSchema = z.object({
    query: z.string().min(1),
});

const listCustomersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.enum(['created_at', 'name', 'total_spend', 'total_visits', 'last_visit_at']).default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    tag: z.string().min(1).optional(),
    rfmSegment: z.string().min(1).optional(),
});

const customerSearchQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * 顧客一覧を取得
 * @route GET /v1/:storeCode/admin/customers
 * @access Staff+
 */
router.get(
    '/',
    requireRole('staff', 'manager', 'owner'),
    validateQuery(listCustomersQuerySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const customerRepo = new CustomerRepository(tenant.id);

        const query = req.query as unknown as z.infer<typeof listCustomersQuerySchema>;
        const { page, limit, sortBy, sortOrder } = query;

        // フィルター
        const filters: Record<string, unknown> = {};

        if (query.tag) {
            filters.tag = query.tag;
        }
        if (query.rfmSegment) {
            filters.rfmSegment = query.rfmSegment;
        }

        const result = await customerRepo.findPaginatedWithFilters(
            filters,
            { page, limit, sortBy, sortOrder }
        );

        res.json({
            success: true,
            data: result.data,
            pagination: {
                page: result.page,
                limit: result.limit,
                total: result.total,
                totalPages: result.totalPages,
                hasNext: result.hasNext,
                hasPrev: result.hasPrev,
            },
        });
    })
);

/**
 * 顧客を検索
 * @route POST /v1/:storeCode/admin/customers/search
 * @access Staff+
 */
router.post(
    '/search',
    requireRole('staff', 'manager', 'owner'),
    validateQuery(customerSearchQuerySchema),
    validateBody(searchCustomerSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const customerRepo = new CustomerRepository(tenant.id);
        const { query } = req.body;

        const { limit } = req.query as unknown as z.infer<typeof customerSearchQuerySchema>;

        const customers = await customerRepo.search(query, limit);

        res.json({
            success: true,
            data: customers,
        });
    })
);

/**
 * 顧客詳細を取得
 * @route GET /v1/:storeCode/admin/customers/:id
 * @access Staff+
 */
router.get(
    '/:id',
    requireRole('staff', 'manager', 'owner'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const customerId = req.params.id as string;
        const customerRepo = new CustomerRepository(tenant.id);

        const customer = await customerRepo.findById(customerId);

        if (!customer) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'CUSTOMER_NOT_FOUND',
                    message: '顧客が見つかりません',
                },
            });
            return;
        }

        res.json({
            success: true,
            data: customer,
        });
    })
);

/**
 * 顧客を更新
 * @route PATCH /v1/:storeCode/admin/customers/:id
 * @access Staff+
 */
router.patch(
    '/:id',
    requireRole('staff', 'manager', 'owner'),
    validateParams(idParamSchema),
    validateBody(updateCustomerSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const customerId = req.params.id as string;
        const customerRepo = new CustomerRepository(tenant.id);

        const customer = await customerRepo.findById(customerId);

        if (!customer) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'CUSTOMER_NOT_FOUND',
                    message: '顧客が見つかりません',
                },
            });
            return;
        }

        const {
            name,
            phoneNumber,
            email,
            birthDate,
            gender,
            memo,
            tags,
        } = req.body as {
            name?: string;
            phoneNumber?: string;
            email?: string | null;
            birthDate?: string | null;
            gender?: 'male' | 'female' | 'other' | 'undisclosed' | null;
            memo?: string | null;
            tags?: string[];
        };

        await customerRepo.update(customerId, {
            name,
            phone: phoneNumber,
            email: email ?? undefined,
            birthDate: birthDate ?? undefined,
            gender: gender ?? undefined,
            memo: memo ?? undefined,
            tags,
        });

        const updated = await customerRepo.findById(customerId);

        res.json({
            success: true,
            data: updated,
        });
    })
);

/**
 * 顧客の予約履歴を取得
 * @route GET /v1/:storeCode/admin/customers/:id/reservations
 * @access Staff+
 */
router.get(
    '/:id/reservations',
    requireRole('staff', 'manager', 'owner'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const customerId = req.params.id as string;
        const customerRepo = new CustomerRepository(tenant.id);

        const customer = await customerRepo.findById(customerId);

        if (!customer) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'CUSTOMER_NOT_FOUND',
                    message: '顧客が見つかりません',
                },
            });
            return;
        }

        const reservations = await customerRepo.getReservationHistory(customerId);

        res.json({
            success: true,
            data: reservations,
        });
    })
);

/**
 * 顧客にタグを追加
 * @route POST /v1/:storeCode/admin/customers/:id/tags
 * @access Manager+
 */
router.post(
    '/:id/tags',
    requireRole('manager', 'owner'),
    validateParams(idParamSchema),
    validateBody(z.object({ tags: z.array(z.string()) })),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const customerId = req.params.id as string;
        const customerRepo = new CustomerRepository(tenant.id);
        const { tags } = req.body;

        const customer = await customerRepo.findById(customerId);

        if (!customer) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'CUSTOMER_NOT_FOUND',
                    message: '顧客が見つかりません',
                },
            });
            return;
        }

        // 既存タグとマージ
        const currentTags = customer.tags ?? [];
        const newTags = [...new Set([...currentTags, ...tags])];

        await customerRepo.update(customerId, { tags: newTags });

        res.json({
            success: true,
            data: { tags: newTags },
        });
    })
);

/**
 * 顧客からタグを削除
 * @route DELETE /v1/:storeCode/admin/customers/:id/tags/:tag
 * @access Manager+
 */
router.delete(
    '/:id/tags/:tag',
    requireRole('manager', 'owner'),
    validateParams(z.object({ id: z.string().min(1), tag: z.string().min(1) })),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const customerId = req.params.id as string;
        const tagToRemove = req.params.tag as string;
        const customerRepo = new CustomerRepository(tenant.id);

        const customer = await customerRepo.findById(customerId);

        if (!customer) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'CUSTOMER_NOT_FOUND',
                    message: '顧客が見つかりません',
                },
            });
            return;
        }

        const currentTags = customer.tags ?? [];
        const newTags = currentTags.filter(t => t !== tagToRemove);

        await customerRepo.update(customerId, { tags: newTags });

        res.json({
            success: true,
            data: { tags: newTags },
        });
    })
);

/**
 * 顧客統計を取得
 * @route GET /v1/:storeCode/admin/customers/stats
 * @access Manager+
 */
router.get(
    '/stats/overview',
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const customerRepo = new CustomerRepository(tenant.id);

        const stats = await customerRepo.getStats();

        res.json({
            success: true,
            data: stats,
        });
    })
);

export default router;
