/**
 * CRM-BE-002: RFM閾値設定 Admin Routes
 * GET  /api/v1/admin/settings/rfm-thresholds  – 現在の閾値取得
 * PUT  /api/v1/admin/settings/rfm-thresholds  – 閾値更新
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireFirebaseAuth, requireRole } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { validateBody } from '../../middleware/validation.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { getRfmThresholds, upsertRfmThresholds } from '../../services/rfm-thresholds.service.js';

const router = Router();

const rfmScoreAxisSchema = z.object({
    score5: z.number().int().positive(),
    score4: z.number().int().positive(),
    score3: z.number().int().positive(),
    score2: z.number().int().positive(),
});

// Ordering constraints are validated authoritatively in validateRfmThresholds() (rfm-thresholds.service.ts)
const updateRfmThresholdsSchema = z.object({
    recency: rfmScoreAxisSchema,
    frequency: rfmScoreAxisSchema,
    monetary: rfmScoreAxisSchema,
});

/**
 * GET /api/v1/admin/settings/rfm-thresholds
 * テナントのRFM閾値を取得する（未設定の場合はデフォルト値を返す）
 */
router.get(
    '/',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const thresholds = await getRfmThresholds(tenantId);
        res.json({ success: true, data: thresholds });
    })
);

/**
 * PUT /api/v1/admin/settings/rfm-thresholds
 * テナントのRFM閾値を更新する（owner のみ）
 */
router.put(
    '/',
    requireFirebaseAuth(),
    requireRole('owner'),
    validateBody(updateRfmThresholdsSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const adminEmail: string = (req as any).user?.email ?? 'unknown';
        const thresholds = await upsertRfmThresholds(tenantId, req.body, adminEmail);
        res.json({ success: true, data: thresholds });
    })
);

export const rfmSettingsAdminRoutes = router;
