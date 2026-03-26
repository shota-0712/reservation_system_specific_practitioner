import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let createGoogleCalendarService: typeof import('../../src/services/google-calendar.service.js').createGoogleCalendarService;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;

beforeAll(async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://example.com/oauth/callback';

    ({ createGoogleCalendarService } = await import('../../src/services/google-calendar.service.js'));
    ({ DatabaseService } = await import('../../src/config/database.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('google-calendar.service', () => {
    it('returns not connected when no oauth row exists', async () => {
        const queryOneSpy = vi.spyOn(DatabaseService, 'queryOne').mockResolvedValue(null as any);

        const service = createGoogleCalendarService('tenant-a');
        await expect(service.getStatus()).resolves.toEqual({
            connected: false,
            status: 'not_connected',
        });
        expect(queryOneSpy).toHaveBeenCalledWith(
            expect.stringContaining('FROM tenant_google_calendar_oauth'),
            ['tenant-a'],
            'tenant-a'
        );
    });

    it('stores refreshed oauth credentials and resolves the active status', async () => {
        const queryOneSpy = vi.spyOn(DatabaseService, 'queryOne').mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT tenant_id, refresh_token_encrypted, status, email, scope')) {
                return null;
            }
            if (sql.includes('SELECT status, email, scope, updated_at')) {
                return {
                    status: 'active',
                    email: 'owner@example.com',
                    scope: 'openid email profile https://www.googleapis.com/auth/calendar',
                    updated_at: new Date('2026-03-22T00:00:00.000Z'),
                } as any;
            }
            return null;
        });
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValue([] as any);

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                access_token: 'access-token-1',
                refresh_token: 'refresh-token-1',
                scope: 'openid email profile https://www.googleapis.com/auth/calendar',
                expires_in: 3600,
                token_type: 'Bearer',
            }),
            text: async () => '',
        } as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ email: 'owner@example.com' }),
            text: async () => '',
        } as any);

        const service = createGoogleCalendarService('tenant-a');
        const status = await service.exchangeCodeAndSave('auth-code-1');

        expect(status.connected).toBe(true);
        expect(status.status).toBe('active');
        expect(status.email).toBe('owner@example.com');
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(queryOneSpy).toHaveBeenCalledWith(
            expect.stringContaining('FROM tenant_google_calendar_oauth'),
            ['tenant-a'],
            'tenant-a'
        );
        expect(querySpy).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO tenant_google_calendar_oauth'),
            [
                'tenant-a',
                expect.any(String),
                'openid email profile https://www.googleapis.com/auth/calendar',
                'owner@example.com',
            ],
            'tenant-a'
        );
    });

    it('marks oauth rows revoked', async () => {
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValue([] as any);

        const service = createGoogleCalendarService('tenant-a');
        await service.revoke();

        expect(querySpy).toHaveBeenCalledWith(
            expect.stringContaining("SET status = 'revoked'"),
            ['tenant-a'],
            'tenant-a'
        );
    });

    it('reuses legacy plaintext refresh tokens during reconnect and re-encrypts them', async () => {
        const queryOneSpy = vi.spyOn(DatabaseService, 'queryOne').mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT tenant_id, refresh_token_encrypted, status, email, scope')) {
                return {
                    tenant_id: 'tenant-a',
                    refresh_token_encrypted: 'legacy-plain-refresh-token',
                    status: 'active',
                    email: 'owner@example.com',
                    scope: 'openid email profile https://www.googleapis.com/auth/calendar',
                } as any;
            }
            if (sql.includes('SELECT status, email, scope, updated_at')) {
                return {
                    status: 'active',
                    email: 'owner@example.com',
                    scope: 'openid email profile https://www.googleapis.com/auth/calendar',
                    updated_at: new Date('2026-03-22T00:00:00.000Z'),
                } as any;
            }
            return null;
        });
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValue([] as any);

        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                access_token: 'access-token-1',
                scope: 'openid email profile https://www.googleapis.com/auth/calendar',
                expires_in: 3600,
                token_type: 'Bearer',
            }),
            text: async () => '',
        } as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ email: 'owner@example.com' }),
            text: async () => '',
        } as any);

        const service = createGoogleCalendarService('tenant-a');
        const status = await service.exchangeCodeAndSave('auth-code-1');

        expect(status.connected).toBe(true);
        expect(queryOneSpy).toHaveBeenCalledWith(
            expect.stringContaining('FROM tenant_google_calendar_oauth'),
            ['tenant-a'],
            'tenant-a'
        );
        expect(querySpy).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE tenant_google_calendar_oauth'),
            [
                'tenant-a',
                expect.any(String),
                'openid email profile https://www.googleapis.com/auth/calendar',
                'owner@example.com',
            ],
            'tenant-a'
        );
    });
});
