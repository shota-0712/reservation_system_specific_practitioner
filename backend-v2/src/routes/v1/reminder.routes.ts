/**
 * Reminder Routes
 * リマインダー管理 API
 */

import { Router, Request, Response } from 'express';
import { requireFirebaseAuth, requireRole } from '../../middleware/auth.js';
import { getTenant } from '../../middleware/tenant.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { createServiceMessageService } from '../../services/service-message.service.js';
import { createReservationRepository, createCustomerRepository } from '../../repositories/index.js';
import { DatabaseService } from '../../config/database.js';

const router = Router();

/**
 * リマインダー手動送信（個別予約）
 * @route POST /v1/:storeCode/admin/reminders/send-single
 * @access Manager+
 */
router.post(
    '/send-single',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const { reservationId, type } = req.body;

        if (!reservationId || !type) {
            res.status(400).json({ success: false, error: 'Missing reservationId or type' });
            return;
        }

        const validTypes = ['reminder_day_before', 'reminder_same_day'];
        if (!validTypes.includes(type)) {
            res.status(400).json({ success: false, error: 'Invalid reminder type' });
            return;
        }

        const reservationRepo = createReservationRepository(tenant.id);
        const customerRepo = createCustomerRepository(tenant.id);

        const reservation = await reservationRepo.findById(reservationId);
        if (!reservation) {
            res.status(404).json({ success: false, error: 'Reservation not found' });
            return;
        }

        const customer = await customerRepo.findById(reservation.customerId);
        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' });
            return;
        }

        const notificationToken = customer.lineNotificationToken
            || customer.lineUserId
            || customer.notificationToken;

        if (!notificationToken) {
            res.status(400).json({ success: false, error: 'Customer has no notification token' });
            return;
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
            res.status(500).json({ success: false, error: result.error });
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
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const limit = parseInt(req.query.limit as string) || 20;

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
