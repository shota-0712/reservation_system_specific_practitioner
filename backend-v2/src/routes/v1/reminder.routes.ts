/**
 * Reminder Routes
 * リマインダー管理 API
 */

import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { getTenant } from '../../middleware/tenant.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { createServiceMessageService } from '../../services/service-message.service.js';
import { createReservationRepository, createCustomerRepository } from '../../repositories/index.js';
import { DatabaseService } from '../../config/database.js';
import { z } from 'zod';
import { ExternalServiceError, NotFoundError, ValidationError } from '../../utils/errors.js';

const router = Router();

const sendSingleReminderBodySchema = z.object({
    reservationId: z.string().uuid(),
    type: z.enum(['reminder_day_before', 'reminder_same_day']),
});

const reminderLogsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * リマインダー手動送信（個別予約）
 * @route POST /v1/:storeCode/admin/reminders/send-single
 * @access Manager+
 */
router.post(
    '/send-single',
    requireRole('manager', 'owner'),
    validateBody(sendSingleReminderBodySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const { reservationId, type } = req.body as z.infer<typeof sendSingleReminderBodySchema>;

        const reservationRepo = createReservationRepository(tenant.id);
        const customerRepo = createCustomerRepository(tenant.id);

        const reservation = await reservationRepo.findById(reservationId);
        if (!reservation) {
            throw new NotFoundError('予約', reservationId);
        }

        const customer = await customerRepo.findById(reservation.customerId);
        if (!customer) {
            throw new NotFoundError('顧客', reservation.customerId);
        }

        const notificationToken = customer.lineNotificationToken
            || customer.lineUserId
            || customer.notificationToken;

        if (!notificationToken) {
            throw new ValidationError('顧客に通知トークンが設定されていません');
        }

        const messageService = createServiceMessageService(tenant.id);

        let result;
        if (type === 'reminder_day_before') {
            result = await messageService.sendDayBeforeReminder(notificationToken, reservation);
        } else {
            result = await messageService.sendSameDayReminder(notificationToken, reservation);
        }

        if (result.success) {
            res.json({ success: true, message: 'Reminder sent successfully' });
        } else {
            throw new ExternalServiceError('LINE', new Error(result.error || 'reminder send failed'));
        }
    })
);

/**
 * サービスメッセージログ取得
 * @route GET /v1/:storeCode/admin/reminders/logs
 * @access Manager+
 */
router.get(
    '/logs',
    requireRole('manager', 'owner'),
    validateQuery(reminderLogsQuerySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const { limit } = reminderLogsQuerySchema.parse(req.query);

        const logs = await DatabaseService.query(
            `SELECT id, reservation_id, message_type, status, error, sent_at
             FROM service_message_logs
             WHERE tenant_id = $1
             ORDER BY sent_at DESC
             LIMIT $2`,
            [tenant.id, limit],
            tenant.id
        );

        res.json({
            success: true,
            data: logs,
        });
    })
);

export default router;
