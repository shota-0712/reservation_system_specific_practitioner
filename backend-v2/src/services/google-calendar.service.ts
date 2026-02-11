import { fromZonedTime } from 'date-fns-tz';
import { env } from '../config/env.js';
import { DatabaseService } from '../config/database.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { ExternalServiceError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { Reservation } from '../types/index.js';

interface OAuthRow {
    tenant_id: string;
    refresh_token_encrypted: string;
    status: 'active' | 'expired' | 'revoked';
    email?: string;
    scope: string;
}

interface OAuthTokenResponse {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
    token_type: string;
    id_token?: string;
}

export interface GoogleIntegrationStatus {
    connected: boolean;
    status: 'active' | 'expired' | 'revoked' | 'not_connected';
    email?: string;
    scope?: string;
    updatedAt?: string;
}

export class GoogleCalendarService {
    constructor(private tenantId: string) {}

    static isConfigured(): boolean {
        return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI);
    }

    ensureConfigured(): void {
        if (!GoogleCalendarService.isConfigured()) {
            throw new ValidationError('Google OAuth が設定されていません');
        }
    }

    buildAuthUrl(state: string): string {
        this.ensureConfigured();

        const params = new URLSearchParams({
            client_id: env.GOOGLE_OAUTH_CLIENT_ID || '',
            redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI || '',
            response_type: 'code',
            access_type: 'offline',
            prompt: 'consent',
            scope: env.GOOGLE_OAUTH_SCOPES.join(' '),
            state,
        });

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    async getStatus(): Promise<GoogleIntegrationStatus> {
        const row = await DatabaseService.queryOne<Record<string, unknown>>(
            `SELECT status, email, scope, updated_at
             FROM tenant_google_calendar_oauth
             WHERE tenant_id = $1
             LIMIT 1`,
            [this.tenantId]
        );

        if (!row) {
            return { connected: false, status: 'not_connected' };
        }

        return {
            connected: row.status === 'active',
            status: (row.status as GoogleIntegrationStatus['status']) || 'not_connected',
            email: (row.email as string | undefined) || undefined,
            scope: (row.scope as string | undefined) || undefined,
            updatedAt: row.updated_at ? String(row.updated_at) : undefined,
        };
    }

    async exchangeCodeAndSave(code: string): Promise<GoogleIntegrationStatus> {
        this.ensureConfigured();

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                code,
                client_id: env.GOOGLE_OAUTH_CLIENT_ID || '',
                client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET || '',
                redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI || '',
                grant_type: 'authorization_code',
            }),
        });

        if (!tokenResponse.ok) {
            const body = await tokenResponse.text();
            throw new ExternalServiceError('google-oauth', new Error(body));
        }

        const token = await tokenResponse.json() as OAuthTokenResponse;

        const existing = await DatabaseService.queryOne<OAuthRow>(
            `SELECT tenant_id, refresh_token_encrypted, status, email, scope
             FROM tenant_google_calendar_oauth
             WHERE tenant_id = $1
             LIMIT 1`,
            [this.tenantId]
        );

        const rawRefreshToken = token.refresh_token || (existing ? decrypt(existing.refresh_token_encrypted) : null);
        if (!rawRefreshToken) {
            throw new ValidationError('Google refresh token の取得に失敗しました。再連携してください');
        }

        const encryptedRefreshToken = encrypt(rawRefreshToken);

        const email = await this.resolveGoogleEmail(token.access_token).catch(() => undefined);

        if (existing) {
            await DatabaseService.query(
                `UPDATE tenant_google_calendar_oauth
                 SET refresh_token_encrypted = $2,
                     scope = $3,
                     email = COALESCE($4, email),
                     status = 'active',
                     updated_at = NOW(),
                     expired_at = NULL
                 WHERE tenant_id = $1`,
                [this.tenantId, encryptedRefreshToken, token.scope, email || null]
            );
        } else {
            await DatabaseService.query(
                `INSERT INTO tenant_google_calendar_oauth (
                    tenant_id, refresh_token_encrypted, scope, email, status
                ) VALUES ($1, $2, $3, $4, 'active')`,
                [this.tenantId, encryptedRefreshToken, token.scope, email || null]
            );
        }

        return this.getStatus();
    }

    async revoke(): Promise<void> {
        await DatabaseService.query(
            `UPDATE tenant_google_calendar_oauth
             SET status = 'revoked', updated_at = NOW(), expired_at = NOW()
             WHERE tenant_id = $1`,
            [this.tenantId]
        );
    }

    async syncCreateEvent(calendarId: string, reservation: Reservation, timezone = 'Asia/Tokyo'): Promise<string | null> {
        const accessToken = await this.getAccessToken();
        if (!accessToken) return null;

        const start = this.toIso(reservation.date, reservation.startTime, timezone);
        const end = this.toIso(reservation.date, reservation.endTime, timezone);

        const body = {
            summary: `予約: ${reservation.customerName || 'ゲスト'} / ${reservation.menuNames.join('、')}`,
            description: [
                `予約ID: ${reservation.id}`,
                `担当: ${reservation.practitionerName}`,
                `顧客: ${reservation.customerName || 'ゲスト'}`,
                `メニュー: ${reservation.menuNames.join('、')}`,
                `合計: ¥${reservation.totalPrice}`,
            ].join('\n'),
            start: { dateTime: start, timeZone: timezone },
            end: { dateTime: end, timeZone: timezone },
        };

        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const message = await response.text();
            logger.error('Google Calendar create event failed', { tenantId: this.tenantId, message });
            throw new ExternalServiceError('google-calendar', new Error(message));
        }

        const data = await response.json() as { id?: string };
        return data.id || null;
    }

    async syncUpdateEvent(
        calendarId: string,
        eventId: string,
        reservation: Reservation,
        timezone = 'Asia/Tokyo'
    ): Promise<void> {
        const accessToken = await this.getAccessToken();
        if (!accessToken) return;

        const start = this.toIso(reservation.date, reservation.startTime, timezone);
        const end = this.toIso(reservation.date, reservation.endTime, timezone);

        const body = {
            summary: `予約: ${reservation.customerName || 'ゲスト'} / ${reservation.menuNames.join('、')}`,
            description: [
                `予約ID: ${reservation.id}`,
                `担当: ${reservation.practitionerName}`,
                `顧客: ${reservation.customerName || 'ゲスト'}`,
                `メニュー: ${reservation.menuNames.join('、')}`,
                `合計: ¥${reservation.totalPrice}`,
            ].join('\n'),
            start: { dateTime: start, timeZone: timezone },
            end: { dateTime: end, timeZone: timezone },
        };

        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            }
        );

        if (!response.ok) {
            const message = await response.text();
            logger.error('Google Calendar update event failed', { tenantId: this.tenantId, message });
            throw new ExternalServiceError('google-calendar', new Error(message));
        }
    }

    async syncDeleteEvent(calendarId: string, eventId: string): Promise<void> {
        const accessToken = await this.getAccessToken();
        if (!accessToken) return;

        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        if (!response.ok && response.status !== 404) {
            const message = await response.text();
            logger.error('Google Calendar delete event failed', { tenantId: this.tenantId, message });
            throw new ExternalServiceError('google-calendar', new Error(message));
        }
    }

    private async getAccessToken(): Promise<string | null> {
        if (!GoogleCalendarService.isConfigured()) return null;

        const oauth = await DatabaseService.queryOne<OAuthRow>(
            `SELECT tenant_id, refresh_token_encrypted, status, email, scope
             FROM tenant_google_calendar_oauth
             WHERE tenant_id = $1
             LIMIT 1`,
            [this.tenantId]
        );

        if (!oauth || oauth.status !== 'active') {
            return null;
        }

        let refreshToken: string;
        try {
            refreshToken = decrypt(oauth.refresh_token_encrypted);
        } catch {
            refreshToken = oauth.refresh_token_encrypted;
        }

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: env.GOOGLE_OAUTH_CLIENT_ID || '',
                client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET || '',
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
        });

        if (!tokenResponse.ok) {
            const body = await tokenResponse.text();
            logger.error('Google refresh token failed', { tenantId: this.tenantId, body });
            await DatabaseService.query(
                `UPDATE tenant_google_calendar_oauth
                 SET status = 'expired', updated_at = NOW(), expired_at = NOW()
                 WHERE tenant_id = $1`,
                [this.tenantId]
            );
            return null;
        }

        const token = await tokenResponse.json() as OAuthTokenResponse;
        return token.access_token;
    }

    private toIso(date: string, time: string, timezone: string): string {
        return fromZonedTime(`${date}T${time}:00`, timezone).toISOString();
    }

    private async resolveGoogleEmail(accessToken: string): Promise<string | undefined> {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            return undefined;
        }

        const data = await response.json() as { email?: string };
        return data.email;
    }
}

export function createGoogleCalendarService(tenantId: string): GoogleCalendarService {
    return new GoogleCalendarService(tenantId);
}
