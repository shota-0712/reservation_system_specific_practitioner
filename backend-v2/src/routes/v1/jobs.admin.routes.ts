/**
 * Admin Job Routes
 * 管理画面からの手動ジョブ実行
 */

import { Router, Request, Response } from 'express';
import { requireFirebaseAuth, requireRole } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { handleDayBeforeReminderRequest, handleSameDayReminderRequest } from '../../jobs/reminder.job.js';
import { handleDailyAnalyticsRequest } from '../../jobs/daily-analytics.job.js';
import { createGoogleCalendarSyncQueueService } from '../../services/google-calendar-sync-queue.service.js';

const router = Router();

/**
 * 前日リマインダー手動実行
 * POST /api/v1/:tenantKey/admin/jobs/reminders/day-before
 */
router.post(
    '/reminders/day-before',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (_req: Request, res: Response): Promise<void> => {
        const result = await handleDayBeforeReminderRequest();
        res.json(result);
    })
);

/**
 * 当日リマインダー手動実行
 * POST /api/v1/:tenantKey/admin/jobs/reminders/same-day
 */
router.post(
    '/reminders/same-day',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (_req: Request, res: Response): Promise<void> => {
        const result = await handleSameDayReminderRequest();
        res.json(result);
    })
);

/**
 * 日次集計手動実行
 * POST /api/v1/:tenantKey/admin/jobs/analytics/daily
 */
router.post(
    '/analytics/daily',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const date = typeof req.body?.date === 'string' ? req.body.date : undefined;
        const result = await handleDailyAnalyticsRequest(date);
        res.json(result);
    })
);

/**
 * Google Calendar sync queue processing (manual)
 * POST /api/v1/:tenantKey/admin/jobs/integrations/google-calendar/sync
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

export default router;
