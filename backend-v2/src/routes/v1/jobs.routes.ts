/**
 * Job Routes
 * Cloud Scheduler などから呼び出されるジョブ実行用エンドポイント
 * 認証は API Key または IP 制限などで行う（ここでは簡易的に Basic 認証またはヘッダーチェックを想定）
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error-handler.js';
import { handleDayBeforeReminderRequest, handleSameDayReminderRequest } from '../../jobs/reminder.job.js';
import { handleDailyAnalyticsRequest } from '../../jobs/daily-analytics.job.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createGoogleCalendarSyncQueueService } from '../../services/google-calendar-sync-queue.service.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';

const router = Router();

// ジョブ実行用シークレット（環境変数で設定）
// Cloud Scheduler の OIDC トークンを使用するのがベストだが、簡易化のためヘッダーチェック
const JOB_SECRET = process.env.JOB_SECRET || 'local-dev-job-secret';

/**
 * ジョブ実行権限チェックミドルウェア
 */
const requireJobSecret = (req: Request, res: Response, next: Function) => {
    const authHeader = req.headers['x-job-secret'];

    // Cloud Scheduler からの実行を想定
    if (authHeader === JOB_SECRET || env.NODE_ENV === 'development') {
        next();
    } else {
        logger.warn('Unauthorized job execution attempt', { ip: req.ip });
        res.status(401).json({ error: 'Unauthorized' });
    }
};

/**
 * 前日リマインダー送信
 * POST /api/v1/:tenantKey/jobs/reminders/day-before
 */
router.post(
    '/reminders/day-before',
    requireJobSecret,
    asyncHandler(async (_req: Request, res: Response): Promise<void> => {
        logger.info('Received job request: day-before reminders');
        const result = await handleDayBeforeReminderRequest();
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
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const type = (req.query.type as string) || 'same-day';
        if (type === 'day-before') {
            const result = await handleDayBeforeReminderRequest();
            res.json(result);
            return;
        }
        const result = await handleSameDayReminderRequest();
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
    asyncHandler(async (_req: Request, res: Response): Promise<void> => {
        logger.info('Received job request: same-day reminders');
        const result = await handleSameDayReminderRequest();
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
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const date = typeof req.body?.date === 'string' ? req.body.date : undefined;
        logger.info('Received job request: daily analytics', { date: date ?? 'default(yesterday)' });
        const result = await handleDailyAnalyticsRequest(date);
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
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const limit = typeof req.body?.limit === 'number' ? req.body.limit : undefined;
        logger.info('Received job request: google calendar sync queue', { limit: limit ?? 'default(50)' });

        const queue = createGoogleCalendarSyncQueueService(tenantId);
        const stats = await queue.processPending({ limit });
        res.json({ success: true, stats });
    })
);

export default router;
