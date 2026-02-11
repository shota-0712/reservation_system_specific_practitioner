/**
 * Settings Routes (PostgreSQL版)
 * 設定管理 API - Tenant & Store 設定
 */

import { Router, Request, Response } from 'express';
import { requireFirebaseAuth, requireRole } from '../../middleware/auth.js';
import { getTenant, getTenantId } from '../../middleware/tenant.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { validateBody } from '../../middleware/validation.js';
import { TenantRepository, createStoreRepository } from '../../repositories/tenant.repository.js';
import { z } from 'zod';

const router = Router();

// バリデーションスキーマ
const updateProfileSchema = z.object({
    name: z.string().min(1).optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    email: z.string().email().optional(),
});

const updateBusinessSchema = z.object({
    businessHours: z.record(z.object({
        isOpen: z.boolean(),
        openTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        closeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    })).optional(),
    regularHolidays: z.array(z.number().min(0).max(6)).optional(),
    slotDuration: z.number().min(15).max(120).optional(),
    advanceBookingDays: z.number().min(1).max(90).optional(),
    cancelDeadlineHours: z.number().min(0).max(72).optional(),
});

const updateLineConfigSchema = z.object({
    channelId: z.string().optional(),
    liffId: z.string().optional(),
    channelAccessToken: z.string().optional(),
    channelSecret: z.string().optional(),
});

const updateBrandingSchema = z.object({
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    logoUrl: z.string().url().optional().nullable(),
});

/**
 * 現在の設定を取得
 * @route GET /v1/:storeCode/admin/settings
 * @access Manager+
 */
router.get(
    '/',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const tenantId = getTenantId(req);
        const storeRepo = createStoreRepository(tenantId);

        // 最初のストアを取得（マルチストア対応前）
        const stores = await storeRepo.findAll();
        const store = stores[0];

        // Sensitive情報をマスク
        const safeTenant = {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            plan: tenant.plan,
            status: tenant.status,
            branding: tenant.branding,
            lineConfig: tenant.lineConfig ? {
                channelId: tenant.lineConfig.channelId,
                liffId: tenant.lineConfig.liffId,
            } : undefined,
        };

        res.json({
            success: true,
            data: {
                tenant: safeTenant,
                store: store || null,
            },
        });
    })
);

/**
 * 店舗プロフィールを更新
 * @route PUT /v1/:storeCode/admin/settings/profile
 * @access Owner
 */
router.put(
    '/profile',
    requireFirebaseAuth(),
    requireRole('owner'),
    validateBody(updateProfileSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeRepo = createStoreRepository(tenantId);

        const stores = await storeRepo.findAll();
        const store = stores[0];

        if (!store) {
            res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: '店舗が見つかりません' },
            });
            return;
        }

        const updated = await storeRepo.update(store.id, req.body);

        res.json({
            success: true,
            data: updated,
        });
    })
);

/**
 * ビジネス設定（営業時間など）を更新
 * @route PUT /v1/:storeCode/admin/settings/business
 * @access Owner
 */
router.put(
    '/business',
    requireFirebaseAuth(),
    requireRole('owner'),
    validateBody(updateBusinessSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeRepo = createStoreRepository(tenantId);

        const stores = await storeRepo.findAll();
        const store = stores[0];

        if (!store) {
            res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: '店舗が見つかりません' },
            });
            return;
        }

        const updated = await storeRepo.update(store.id, req.body);

        res.json({
            success: true,
            data: {
                businessHours: updated.businessHours,
                regularHolidays: updated.regularHolidays,
                slotDuration: updated.slotDuration,
                advanceBookingDays: updated.advanceBookingDays,
                cancelDeadlineHours: updated.cancelDeadlineHours,
            },
        });
    })
);

/**
 * LINE設定を更新
 * @route PUT /v1/:storeCode/admin/settings/line
 * @access Owner
 */
router.put(
    '/line',
    requireFirebaseAuth(),
    requireRole('owner'),
    validateBody(updateLineConfigSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const tenantRepo = new TenantRepository();

        await tenantRepo.updateLineConfig(tenant.id, req.body);

        res.json({
            success: true,
            message: 'LINE configuration updated successfully',
        });
    })
);

/**
 * ブランディング設定を更新
 * @route PUT /v1/:storeCode/admin/settings/branding
 * @access Owner
 */
router.put(
    '/branding',
    requireFirebaseAuth(),
    requireRole('owner'),
    validateBody(updateBrandingSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const tenantRepo = new TenantRepository();

        await tenantRepo.update(tenant.id, {
            branding: {
                ...tenant.branding,
                ...req.body,
            },
        });

        const updated = await tenantRepo.findById(tenant.id);

        res.json({
            success: true,
            data: updated?.branding,
        });
    })
);

export default router;
