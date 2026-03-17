import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let TenantNotificationSettingsRepository: typeof import('../../src/repositories/tenant-notification-settings.repository.js').TenantNotificationSettingsRepository;
let DEFAULT_TENANT_NOTIFICATION_SETTINGS: typeof import('../../src/repositories/tenant-notification-settings.repository.js').DEFAULT_TENANT_NOTIFICATION_SETTINGS;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }
    ({ TenantNotificationSettingsRepository, DEFAULT_TENANT_NOTIFICATION_SETTINGS } = await import('../../src/repositories/tenant-notification-settings.repository.js'));
    ({ DatabaseService } = await import('../../src/config/database.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('TenantNotificationSettingsRepository', () => {
    it('get returns defaults when no row exists', async () => {
        vi.spyOn(DatabaseService, 'queryOne').mockResolvedValue(null);

        const repository = new TenantNotificationSettingsRepository('tenant-a');
        const result = await repository.get();

        expect(result).toEqual(DEFAULT_TENANT_NOTIFICATION_SETTINGS);
        expect(DatabaseService.queryOne).toHaveBeenCalledTimes(1);
    });

    it('get maps DB row to camelCase response', async () => {
        vi.spyOn(DatabaseService, 'queryOne').mockResolvedValue({
            tenant_id: 'tenant-a',
            email_new_reservation: false,
            email_cancellation: true,
            email_daily_report: false,
            line_reminder: true,
            line_confirmation: false,
            line_review: true,
            push_new_reservation: false,
            push_cancellation: true,
            updated_at: new Date('2026-03-06T00:00:00.000Z'),
            updated_by: 'admin-uid',
        });

        const repository = new TenantNotificationSettingsRepository('tenant-a');
        const result = await repository.get();

        expect(result.emailNewReservation).toBe(false);
        expect(result.emailDailyReport).toBe(false);
        expect(result.lineConfirmation).toBe(false);
        expect(result.pushNewReservation).toBe(false);
        expect(result.updatedBy).toBe('admin-uid');
    });

    it('upsert merges current settings with patch and persists all fields', async () => {
        const selectRow = {
            tenant_id: 'tenant-a',
            email_new_reservation: true,
            email_cancellation: true,
            email_daily_report: false,
            line_reminder: true,
            line_confirmation: true,
            line_review: true,
            push_new_reservation: true,
            push_cancellation: false,
            updated_at: new Date('2026-03-06T00:00:00.000Z'),
            updated_by: 'before',
        };

        const upsertRow = {
            ...selectRow,
            email_new_reservation: false,
            line_confirmation: false,
            updated_at: new Date('2026-03-06T01:00:00.000Z'),
            updated_by: 'admin-uid',
        };

        const querySpy = vi.spyOn(DatabaseService, 'queryOne').mockImplementation(
            async (sql: string, params?: unknown[]) => {
                if (sql.includes('FROM tenant_notification_settings')) {
                    return selectRow as any;
                }
                if (sql.includes('INSERT INTO tenant_notification_settings')) {
                    expect(params?.[0]).toBe('tenant-a');
                    expect(params?.[1]).toBe(false); // emailNewReservation
                    expect(params?.[2]).toBe(true);  // emailCancellation (keep current)
                    expect(params?.[4]).toBe(true);  // lineReminder (keep current)
                    expect(params?.[5]).toBe(false); // lineConfirmation
                    expect(params?.[9]).toBe('admin-uid');
                    return upsertRow as any;
                }
                return null;
            }
        );

        const repository = new TenantNotificationSettingsRepository('tenant-a');
        const result = await repository.upsert(
            {
                emailNewReservation: false,
                lineConfirmation: false,
            },
            'admin-uid'
        );

        expect(result.emailNewReservation).toBe(false);
        expect(result.emailCancellation).toBe(true);
        expect(result.lineConfirmation).toBe(false);
        expect(result.pushCancellation).toBe(false);
        expect(result.updatedBy).toBe('admin-uid');
        expect(querySpy).toHaveBeenCalledTimes(2);
    });
});
