/**
 * Tenant Notification Settings Repository (PostgreSQL + RLS)
 */

import { DatabaseService } from '../config/database.js';
import type { TenantNotificationSettings } from '../types/index.js';

interface TenantNotificationSettingsRow {
    tenant_id: string;
    email_new_reservation: boolean;
    email_cancellation: boolean;
    email_daily_report: boolean;
    line_reminder: boolean;
    line_confirmation: boolean;
    line_review: boolean;
    push_new_reservation: boolean;
    push_cancellation: boolean;
    updated_at: Date;
    updated_by: string | null;
}

export const DEFAULT_TENANT_NOTIFICATION_SETTINGS: Omit<TenantNotificationSettings, 'updatedAt' | 'updatedBy'> = {
    emailNewReservation: true,
    emailCancellation: true,
    emailDailyReport: true,
    lineReminder: true,
    lineConfirmation: true,
    lineReview: true,
    pushNewReservation: true,
    pushCancellation: true,
};

function mapNotificationSettings(row: TenantNotificationSettingsRow): TenantNotificationSettings {
    return {
        emailNewReservation: row.email_new_reservation,
        emailCancellation: row.email_cancellation,
        emailDailyReport: row.email_daily_report,
        lineReminder: row.line_reminder,
        lineConfirmation: row.line_confirmation,
        lineReview: row.line_review,
        pushNewReservation: row.push_new_reservation,
        pushCancellation: row.push_cancellation,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by ?? undefined,
    };
}

function normalizeSettings(
    current: TenantNotificationSettings,
    patch: Partial<TenantNotificationSettings>
): Omit<TenantNotificationSettings, 'updatedAt' | 'updatedBy'> {
    return {
        emailNewReservation: patch.emailNewReservation ?? current.emailNewReservation,
        emailCancellation: patch.emailCancellation ?? current.emailCancellation,
        emailDailyReport: patch.emailDailyReport ?? current.emailDailyReport,
        lineReminder: patch.lineReminder ?? current.lineReminder,
        lineConfirmation: patch.lineConfirmation ?? current.lineConfirmation,
        lineReview: patch.lineReview ?? current.lineReview,
        pushNewReservation: patch.pushNewReservation ?? current.pushNewReservation,
        pushCancellation: patch.pushCancellation ?? current.pushCancellation,
    };
}

export class TenantNotificationSettingsRepository {
    constructor(private readonly tenantId: string) {}

    async get(): Promise<TenantNotificationSettings> {
        const row = await DatabaseService.queryOne<TenantNotificationSettingsRow>(
            `SELECT tenant_id, email_new_reservation, email_cancellation, email_daily_report,
                    line_reminder, line_confirmation, line_review,
                    push_new_reservation, push_cancellation,
                    updated_at, updated_by
             FROM tenant_notification_settings
             WHERE tenant_id = $1`,
            [this.tenantId],
            this.tenantId
        );

        if (!row) {
            return { ...DEFAULT_TENANT_NOTIFICATION_SETTINGS };
        }

        return mapNotificationSettings(row);
    }

    async upsert(
        patch: Partial<TenantNotificationSettings>,
        updatedBy: string
    ): Promise<TenantNotificationSettings> {
        const current = await this.get();
        const normalized = normalizeSettings(current, patch);
        const row = await DatabaseService.queryOne<TenantNotificationSettingsRow>(
            `INSERT INTO tenant_notification_settings (
                tenant_id,
                email_new_reservation, email_cancellation, email_daily_report,
                line_reminder, line_confirmation, line_review,
                push_new_reservation, push_cancellation,
                updated_at, updated_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10
            )
            ON CONFLICT (tenant_id) DO UPDATE SET
                email_new_reservation = EXCLUDED.email_new_reservation,
                email_cancellation = EXCLUDED.email_cancellation,
                email_daily_report = EXCLUDED.email_daily_report,
                line_reminder = EXCLUDED.line_reminder,
                line_confirmation = EXCLUDED.line_confirmation,
                line_review = EXCLUDED.line_review,
                push_new_reservation = EXCLUDED.push_new_reservation,
                push_cancellation = EXCLUDED.push_cancellation,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
            RETURNING tenant_id, email_new_reservation, email_cancellation, email_daily_report,
                      line_reminder, line_confirmation, line_review,
                      push_new_reservation, push_cancellation,
                      updated_at, updated_by`,
            [
                this.tenantId,
                normalized.emailNewReservation,
                normalized.emailCancellation,
                normalized.emailDailyReport,
                normalized.lineReminder,
                normalized.lineConfirmation,
                normalized.lineReview,
                normalized.pushNewReservation,
                normalized.pushCancellation,
                updatedBy,
            ],
            this.tenantId
        );

        if (!row) {
            throw new Error('通知設定の保存に失敗しました');
        }

        return mapNotificationSettings(row);
    }
}

export function createTenantNotificationSettingsRepository(tenantId: string): TenantNotificationSettingsRepository {
    return new TenantNotificationSettingsRepository(tenantId);
}
