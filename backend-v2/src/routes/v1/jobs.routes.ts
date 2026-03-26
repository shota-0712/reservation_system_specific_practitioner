/**
 * Job Routes
 * Cloud Scheduler などから呼び出されるジョブ実行用エンドポイント
 * 認証は API Key または IP 制限などで行う（ここでは簡易的に Basic 認証またはヘッダーチェックを想定）
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error-handler.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { handleDayBeforeReminderRequest, handleSameDayReminderRequest } from '../../jobs/reminder.job.js';
import { handleDailyAnalyticsRequest } from '../../jobs/daily-analytics.job.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createGoogleCalendarSyncQueueService } from '../../services/google-calendar-sync-queue.service.js';
import { createSalonboardService } from '../../services/salonboard.service.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { AuthenticationError } from '../../utils/errors.js';
import { z } from 'zod';

const router = Router();

const reminderTypeQuerySchema = z.object({
    type: z.enum(['day-before', 'same-day']).default('same-day'),
});

const analyticsJobBodySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).default({});

const googleCalendarSyncBodySchema = z.object({
    limit: z.coerce.number().int().min(1).max(500).optional(),
}).default({});

/**
 * ジョブ実行権限チェックミドルウェア
 */
const requireJobSecret = (req: Request, _res: Response, next: (error?: unknown) => void) => {
    const authHeader = req.headers['x-job-secret'];

    // Cloud Scheduler からの実行を想定
    if (authHeader === env.JOB_SECRET || env.NODE_ENV === 'development') {
        next();
    } else {
        logger.warn('Unauthorized job execution attempt', { ip: req.ip });
        next(new AuthenticationError('ジョブ実行シークレットが不正です'));
    }
};

/**
 * 前日リマインダー送信
 * POST /api/v1/:tenantKey/jobs/reminders/day-before
 */
router.post(
    '/reminders/day-before',
    requireJobSecret,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        logger.info('Received job request: day-before reminders');
        const result = await handleDayBeforeReminderRequest(tenantId);
        res.json(result);
    })
);

/**
 * リマインダー送信（互換ルート）
 * GET /api/v1/:tenantKey/jobs/reminders?type=day-before|same-day
 */
router.get(
    '/reminders',
    requireJobSecret,
    validateQuery(reminderTypeQuerySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const { type } = req.query as unknown as z.infer<typeof reminderTypeQuerySchema>;
        if (type === 'day-before') {
            const result = await handleDayBeforeReminderRequest(tenantId);
            res.json(result);
            return;
        }
        const result = await handleSameDayReminderRequest(tenantId);
        res.json(result);
    })
);

/**
 * 当日リマインダー送信
 * POST /api/v1/:tenantKey/jobs/reminders/same-day
 */
router.post(
    '/reminders/same-day',
    requireJobSecret,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        logger.info('Received job request: same-day reminders');
        const result = await handleSameDayReminderRequest(tenantId);
        res.json(result);
    })
);

/**
 * 日次集計ジョブ
 * POST /api/v1/:tenantKey/jobs/analytics/daily
 */
router.post(
    '/analytics/daily',
    requireJobSecret,
    validateBody(analyticsJobBodySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const { date } = req.body as z.infer<typeof analyticsJobBodySchema>;
        logger.info('Received job request: daily analytics', { date: date ?? 'default(yesterday)' });
        const result = await handleDailyAnalyticsRequest(date, tenantId);
        res.json(result);
    })
);

/**
 * Google Calendar sync queue processing
 * POST /api/v1/:tenantKey/jobs/integrations/google-calendar/sync
 */
router.post(
    '/integrations/google-calendar/sync',
    requireJobSecret,
    validateBody(googleCalendarSyncBodySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const { limit } = req.body as z.infer<typeof googleCalendarSyncBodySchema>;
        logger.info('Received job request: google calendar sync queue', { limit: limit ?? 'default(50)' });

        const queue = createGoogleCalendarSyncQueueService(tenantId);
        const stats = await queue.processPending({ limit });
        res.json({ success: true, stats });
    })
);

/**
 * Salonboard sync job
 * POST /api/v1/:tenantKey/jobs/integrations/salonboard/sync
 */
router.post(
    '/integrations/salonboard/sync',
    requireJobSecret,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        logger.info('Received job request: salonboard sync');

        const service = createSalonboardService(tenantId);
        const stats = await service.sync('scheduler');
        res.json({ success: true, stats });
    })
);

export default router;
