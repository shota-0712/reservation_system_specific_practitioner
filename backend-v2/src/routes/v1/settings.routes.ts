/**
 * Settings Routes (PostgreSQL版)
 * 設定管理 API - Tenant & Store 設定
 */

import { Router, Request, Response } from 'express';
import { requireFirebaseAuth, requireRole } from '../../middleware/auth.js';
import { getStoreId, getTenant, getTenantId } from '../../middleware/tenant.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { TenantRepository, createStoreRepository } from '../../repositories/tenant.repository.js';
import { createPractitionerRepository } from '../../repositories/index.js';
import { resolveLineConfigForTenant } from '../../services/line-config.service.js';
import { sanitizeStoreForResponse } from '../../services/store-response.service.js';
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
    mode: z.enum(['tenant', 'store', 'practitioner']).optional(),
    channelId: z.string().optional(),
    liffId: z.string().optional(),
    channelAccessToken: z.string().optional(),
    channelSecret: z.string().optional(),
});
const lineResolvePreviewQuerySchema = z.object({
    storeId: z.string().uuid().optional(),
    practitionerId: z.string().uuid().optional(),
});

const updateBrandingSchema = z.object({
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    logoUrl: z.string().url().optional().nullable(),
});

async function resolveScopedStore(req: Request, tenantId: string) {
    const storeRepo = createStoreRepository(tenantId);
    const requestedStoreId = getStoreId(req);

    if (requestedStoreId) {
        const requestedStore = await storeRepo.findById(requestedStoreId);
        if (requestedStore?.status === 'active') {
            return {
                storeRepo,
                store: requestedStore,
            };
        }
    }

    const stores = await storeRepo.findAll();
    return {
        storeRepo,
        store: stores[0] ?? null,
    };
}

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
        const { store } = await resolveScopedStore(req, tenantId);

        // Sensitive情報をマスク
        const safeTenant = {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            plan: tenant.plan,
            status: tenant.status,
            branding: tenant.branding,
            lineConfig: tenant.lineConfig ? {
                mode: tenant.lineConfig.mode || 'tenant',
                channelId: tenant.lineConfig.channelId,
                liffId: tenant.lineConfig.liffId,
            } : undefined,
        };

        res.json({
            success: true,
            data: {
                tenant: safeTenant,
                store: store ? sanitizeStoreForResponse(store) : null,
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
        const { storeRepo, store } = await resolveScopedStore(req, tenantId);

        if (!store) {
            res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: '店舗が見つかりません' },
            });
            return;
        }

        const updated = sanitizeStoreForResponse(await storeRepo.update(store.id, req.body));

        res.json({
            success: true,
            data: updated,
        });
    })
);

/**
 * LINE設定の解決プレビューを返す
 * @route GET /v1/:storeCode/admin/settings/line/resolve-preview
 * @access Manager+
 */
router.get(
    '/line/resolve-preview',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    validateQuery(lineResolvePreviewQuerySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const tenantId = getTenantId(req);
        const query = req.query as z.infer<typeof lineResolvePreviewQuerySchema>;

        const storeRepo = createStoreRepository(tenantId);
        const practitionerRepo = createPractitionerRepository(tenantId);

        const candidateStoreId = query.storeId || getStoreId(req) || undefined;
        const store = candidateStoreId ? await storeRepo.findById(candidateStoreId) : null;
        if (candidateStoreId && (!store || store.status !== 'active')) {
            res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: '店舗が見つかりません' },
            });
            return;
        }

        const practitioner = query.practitionerId
            ? await practitionerRepo.findById(query.practitionerId)
            : null;
        if (query.practitionerId && (!practitioner || !practitioner.isActive)) {
            res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: '施術者が見つかりません' },
            });
            return;
        }

        if (store && practitioner && (practitioner.storeIds ?? []).length > 0 && !(practitioner.storeIds ?? []).includes(store.id)) {
            res.status(409).json({
                success: false,
                error: { code: 'CONFLICT', message: '選択した店舗に所属していない施術者です' },
            });
            return;
        }

        const resolved = resolveLineConfigForTenant(tenant, store, practitioner);
        res.json({
            success: true,
            data: {
                mode: resolved.mode,
                source: resolved.source,
                liffId: resolved.lineConfig.liffId || '',
                channelId: resolved.lineConfig.channelId || '',
                storeId: resolved.storeId ?? store?.id,
                practitionerId: resolved.practitionerId ?? practitioner?.id,
            },
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
        const { storeRepo, store } = await resolveScopedStore(req, tenantId);

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
        const tenantId = getTenantId(req);
        const tenantRepo = new TenantRepository();
        const payload = req.body as z.infer<typeof updateLineConfigSchema>;
        const mode = payload.mode ?? tenant.lineConfig?.mode ?? 'tenant';

        if (mode === 'store') {
            const { storeRepo, store } = await resolveScopedStore(req, tenantId);
            if (!store) {
                res.status(404).json({
                    success: false,
                    error: { code: 'NOT_FOUND', message: '店舗が見つかりません' },
                });
                return;
            }

            await tenantRepo.updateLineConfig(tenant.id, {
                mode: 'store',
            });
            await storeRepo.update(store.id, {
                lineConfig: {
                    liffId: payload.liffId,
                    channelId: payload.channelId,
                    channelAccessToken: payload.channelAccessToken,
                    channelSecret: payload.channelSecret,
                },
            });
        } else {
            await tenantRepo.updateLineConfig(tenant.id, {
                mode,
                channelId: payload.channelId,
                liffId: payload.liffId,
                channelAccessToken: payload.channelAccessToken,
                channelSecret: payload.channelSecret,
            });
        }

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
