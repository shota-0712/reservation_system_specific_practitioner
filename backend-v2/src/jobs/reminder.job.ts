/**
 * Reminder Jobs (PostgreSQL版)
 * Cloud Scheduler で実行されるリマインダー送信ジョブ
 */

import { DatabaseService } from '../config/database.js';
import { createServiceMessageService } from '../services/service-message.service.js';
import { createCustomerRepository } from '../repositories/customer.repository.js';
import { createReservationRepository } from '../repositories/reservation.repository.js';
import { logger } from '../utils/logger.js';
// Types used by this module are inferred from repository return types
import { toZonedTime, format } from 'date-fns-tz';
import { addDays } from 'date-fns';

const TIMEZONE = 'Asia/Tokyo';

interface ReminderStats {
    total: number;
    sent: number;
    skipped: number;
    failed: number;
}

interface TenantRow {
    id: string;
    name: string;
}

/**
 * 前日リマインダー送信ジョブ
 * Cloud Scheduler で毎日 18:00 JST に実行
 */
export async function sendDayBeforeReminders(): Promise<ReminderStats> {
    // 日本時間で「明日」の日付を取得
    const now = new Date();
    const jstNow = toZonedTime(now, TIMEZONE);
    const tomorrow = addDays(jstNow, 1);
    const tomorrowStr = format(tomorrow, 'yyyy-MM-dd', { timeZone: TIMEZONE });

    logger.info('Starting day-before reminders', {
        serverTime: now.toISOString(),
        targetDate: tomorrowStr,
        timezone: TIMEZONE
    });

    const stats: ReminderStats = { total: 0, sent: 0, skipped: 0, failed: 0 };

    try {
        // アクティブな全テナントを取得
        const tenants = await DatabaseService.query<TenantRow>(
            `SELECT id, name
             FROM tenants WHERE status = 'active'`
        );

        for (const tenant of tenants) {
            try {
                const tenantStats = await sendRemindersForTenant(
                    tenant.id,
                    tomorrowStr,
                    'reminder_day_before'
                );

                stats.total += tenantStats.total;
                stats.sent += tenantStats.sent;
                stats.skipped += tenantStats.skipped;
                stats.failed += tenantStats.failed;

            } catch (error) {
                logger.error('Error sending reminders for tenant', {
                    tenantId: tenant.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        logger.info('Day-before reminders completed', { stats });
        return stats;

    } catch (error) {
        logger.error('Day-before reminders job failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}

/**
 * 当日リマインダー送信ジョブ
 * Cloud Scheduler で毎日 08:00 JST に実行
 */
export async function sendSameDayReminders(): Promise<ReminderStats> {
    // 日本時間で「今日」の日付を取得
    const now = new Date();
    const jstNow = toZonedTime(now, TIMEZONE);
    const todayStr = format(jstNow, 'yyyy-MM-dd', { timeZone: TIMEZONE });

    logger.info('Starting same-day reminders', {
        serverTime: now.toISOString(),
        targetDate: todayStr,
        timezone: TIMEZONE
    });

    const stats: ReminderStats = { total: 0, sent: 0, skipped: 0, failed: 0 };

    try {
        const tenants = await DatabaseService.query<TenantRow>(
            `SELECT id, name
             FROM tenants WHERE status = 'active'`
        );

        for (const tenant of tenants) {
            try {
                const tenantStats = await sendRemindersForTenant(
                    tenant.id,
                    todayStr,
                    'reminder_same_day'
                );

                stats.total += tenantStats.total;
                stats.sent += tenantStats.sent;
                stats.skipped += tenantStats.skipped;
                stats.failed += tenantStats.failed;

            } catch (error) {
                logger.error('Error sending same-day reminders for tenant', {
                    tenantId: tenant.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        logger.info('Same-day reminders completed', { stats });
        return stats;

    } catch (error) {
        logger.error('Same-day reminders job failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}

/**
 * 特定テナントのリマインダーを送信
 */
async function sendRemindersForTenant(
    tenantId: string,
    date: string,
    type: 'reminder_day_before' | 'reminder_same_day'
): Promise<ReminderStats> {
    const stats: ReminderStats = { total: 0, sent: 0, skipped: 0, failed: 0 };

    const reservationRepo = createReservationRepository(tenantId);
    const customerRepo = createCustomerRepository(tenantId);

    // 対象日の予約を取得
    const reservations = await reservationRepo.findWithFilters({
        date,
        status: ['confirmed', 'pending'],
    });

    stats.total = reservations.length;

    if (stats.total === 0) {
        return stats;
    }

    const messageService = createServiceMessageService(tenantId);

    for (const reservation of reservations) {
        try {
            // 顧客情報を取得
            const customer = await customerRepo.findById(reservation.customerId);

            if (!customer) {
                stats.skipped++;
                continue;
            }

            // 通知トークンがなければスキップ
            const notificationToken = customer.lineNotificationToken
                || customer.lineUserId
                || customer.notificationToken;

            if (!notificationToken) {
                logger.debug('No notification token for customer', {
                    tenantId,
                    customerId: reservation.customerId,
                });
                stats.skipped++;
                continue;
            }

            // 通知設定を確認
            if (customer.notificationSettings?.reminder === false) {
                logger.debug('Reminder disabled for customer', {
                    tenantId,
                    customerId: reservation.customerId,
                });
                stats.skipped++;
                continue;
            }

            // リマインダー送信
            const result = type === 'reminder_day_before'
                ? await messageService.sendDayBeforeReminder(notificationToken, reservation)
                : await messageService.sendSameDayReminder(notificationToken, reservation);

            if (result.success) {
                // 送信済みをマーク
                await reservationRepo.markReminderSent(reservation.id);
                stats.sent++;
            } else {
                stats.failed++;
            }

        } catch (error) {
            logger.error('Error sending reminder', {
                tenantId,
                reservationId: reservation.id,
                error: error instanceof Error ? error.message : String(error),
            });
            stats.failed++;
        }
    }

    logger.info('Tenant reminders completed', { tenantId, type, stats });
    return stats;
}

/**
 * HTTP エンドポイント用のハンドラ
 * Cloud Scheduler から直接呼び出される
 */
export async function handleDayBeforeReminderRequest(): Promise<{ success: boolean; stats: ReminderStats }> {
    const stats = await sendDayBeforeReminders();
    return { success: true, stats };
}

export async function handleSameDayReminderRequest(): Promise<{ success: boolean; stats: ReminderStats }> {
    const stats = await sendSameDayReminders();
    return { success: true, stats };
}
