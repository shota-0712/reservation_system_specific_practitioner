/**
 * Admin Job Routes
 * 管理画面からの手動ジョブ実行
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireFirebaseAuth, requireRole } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { validateBody } from '../../middleware/index.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { handleDayBeforeReminderRequest, handleSameDayReminderRequest } from '../../jobs/reminder.job.js';
import { handleDailyAnalyticsRequest } from '../../jobs/daily-analytics.job.js';
import { createGoogleCalendarSyncQueueService } from '../../services/google-calendar-sync-queue.service.js';
import { recalculateRfmForTenant } from '../../services/rfm-thresholds.service.js';
import { createSalonboardService } from '../../services/salonboard.service.js';

const router = Router();
const retryGoogleSyncSchema = z.object({
    limit: z.number().int().min(1).max(500).optional(),
    includeFailed: z.boolean().optional(),
});

/**
 * 前日リマインダー手動実行
 * POST /api/v1/admin/jobs/reminders/day-before
 */
router.post(
    '/reminders/day-before',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const result = await handleDayBeforeReminderRequest(tenantId);
        res.json(result);
    })
);

/**
 * 当日リマインダー手動実行
 * POST /api/v1/admin/jobs/reminders/same-day
 */
router.post(
    '/reminders/same-day',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const result = await handleSameDayReminderRequest(tenantId);
        res.json(result);
    })
);

/**
 * 日次集計手動実行
 * POST /api/v1/admin/jobs/analytics/daily
 */
router.post(
    '/analytics/daily',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const date = typeof req.body?.date === 'string' ? req.body.date : undefined;
        const result = await handleDailyAnalyticsRequest(date, tenantId);
        res.json(result);
    })
);

/**
 * Google Calendar sync queue processing (manual)
 * POST /api/v1/admin/jobs/integrations/google-calendar/sync
 */
router.post(
    '/integrations/google-calendar/sync',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const limit = typeof req.body?.limit === 'number' ? req.body.limit : undefined;

        const queue = createGoogleCalendarSyncQueueService(tenantId);
        const stats = await queue.processPending({ limit });
        res.json({ success: true, stats });
    })
);

/**
 * Salonboard sync (manual)
 * POST /api/v1/admin/jobs/integrations/salonboard/sync
 */
router.post(
    '/integrations/salonboard/sync',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createSalonboardService(tenantId);
        const stats = await service.sync('manual');
        res.json({ success: true, stats });
    })
);

/**
 * Google Calendar dead/failed queue retry (manual)
 * POST /api/v1/admin/jobs/integrations/google-calendar/retry
 */
router.post(
    '/integrations/google-calendar/retry',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    validateBody(retryGoogleSyncSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const limit = typeof req.body?.limit === 'number' ? req.body.limit : undefined;
        const includeFailed = req.body?.includeFailed === true;

        const queue = createGoogleCalendarSyncQueueService(tenantId);
        const stats = await queue.retryDeadTasks({ limit, includeFailed });
        res.json({ success: true, stats });
    })
);

/**
 * CRM-BE-003: RFMセグメント一括再計算
 * POST /api/v1/admin/jobs/customers/rfm/recalculate
 */
router.post(
    '/customers/rfm/recalculate',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const result = await recalculateRfmForTenant(tenantId);
        res.json({ success: true, data: result });
    })
);

export default router;
