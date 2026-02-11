/**
 * LINE Service
 * Handles LINE authentication and messaging
 */

import { getAuth } from 'firebase-admin/auth';
import { logger } from '../utils/logger.js';
import { AuthenticationError } from '../utils/errors.js';
import { decrypt } from '../utils/crypto.js';
import type { Tenant } from '../types/index.js';

interface LINEProfile {
    userId: string;
    displayName: string;
    pictureUrl?: string;
    statusMessage?: string;
}

interface LINETokenVerifyResponse {
    iss: string;
    sub: string;
    aud: string;
    exp: number;
    iat: number;
    nonce?: string;
    amr: string[];
    name?: string;
    picture?: string;
    email?: string;
}

interface ServiceMessagePayload {
    notificationToken: string;
    templateName: string;
    templateArgs: Record<string, string>;
}

export class LineService {
    private tenant: Tenant;
    private channelAccessToken: string;
    private channelId: string;

    constructor(tenant: Tenant) {
        this.tenant = tenant;

        // Decrypt sensitive tokens
        if (tenant.lineConfig?.channelAccessToken) {
            try {
                this.channelAccessToken = decrypt(tenant.lineConfig.channelAccessToken);
            } catch {
                // Fallback: maybe not encrypted in dev
                this.channelAccessToken = tenant.lineConfig.channelAccessToken;
            }
        } else {
            this.channelAccessToken = '';
        }

        this.channelId = tenant.lineConfig?.channelId || '';
    }

    /**
     * Verify LINE ID Token
     */
    async verifyIdToken(idToken: string): Promise<LINETokenVerifyResponse> {
        if (!this.channelId) {
            throw new AuthenticationError('LINE channel not configured for this tenant');
        }

        const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                id_token: idToken,
                client_id: this.channelId,
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            logger.error('LINE token verification failed', { error });
            throw new AuthenticationError('Invalid LINE token');
        }

        return response.json() as Promise<LINETokenVerifyResponse>;
    }

    /**
     * Get LINE profile using access token
     */
    async getProfile(accessToken: string): Promise<LINEProfile> {
        const response = await fetch('https://api.line.me/v2/profile', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new AuthenticationError('Failed to get LINE profile');
        }

        return response.json() as Promise<LINEProfile>;
    }

    /**
     * Create Firebase Custom Token for LINE user
     */
    async createCustomToken(
        lineUserId: string,
        additionalClaims?: Record<string, unknown>
    ): Promise<string> {
        const auth = getAuth();

        // Create unique UID that includes tenant context
        const uid = `line:${this.tenant.id}:${lineUserId}`;

        const claims = {
            tenantId: this.tenant.id,
            lineUserId,
            authProvider: 'line',
            ...additionalClaims,
        };

        return auth.createCustomToken(uid, claims);
    }

    /**
     * Send push message using Messaging API
     */
    async sendPushMessage(
        lineUserId: string,
        messages: unknown[]
    ): Promise<void> {
        if (!this.channelAccessToken) {
            logger.warn('LINE messaging not configured for tenant', {
                tenantId: this.tenant.id
            });
            return;
        }

        const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.channelAccessToken}`,
            },
            body: JSON.stringify({
                to: lineUserId,
                messages,
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            logger.error('Failed to send LINE message', { error, lineUserId });
            throw new Error('Failed to send LINE message');
        }

        logger.info('LINE message sent', {
            tenantId: this.tenant.id,
            lineUserId
        });
    }

    /**
     * Send service message (LINE Mini App only)
     * This is for reservation confirmations, reminders, etc.
     */
    async sendServiceMessage(payload: ServiceMessagePayload): Promise<void> {
        if (!this.channelAccessToken) {
            logger.warn('LINE messaging not configured for tenant', {
                tenantId: this.tenant.id
            });
            return;
        }

        const response = await fetch('https://api.line.me/message/v3/notifier/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.channelAccessToken}`,
            },
            body: JSON.stringify({
                notificationToken: payload.notificationToken,
                templateName: payload.templateName,
                templateArgs: payload.templateArgs,
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            logger.error('Failed to send service message', { error });
            throw new Error('Failed to send service message');
        }

        logger.info('Service message sent', {
            tenantId: this.tenant.id,
            templateName: payload.templateName,
        });
    }

    /**
     * Send reservation confirmation
     */
    async sendReservationConfirmation(
        notificationToken: string,
        reservation: {
            date: string;
            startTime: string;
            menuName: string;
            practitionerName: string;
            storeName: string;
        }
    ): Promise<void> {
        await this.sendServiceMessage({
            notificationToken,
            templateName: 'reservation_confirmation',
            templateArgs: {
                title: 'ご予約を承りました',
                body: `${reservation.date} ${reservation.startTime}\n${reservation.menuName}\n担当: ${reservation.practitionerName}`,
                subText: reservation.storeName,
            },
        });
    }

    /**
     * Send reservation reminder
     */
    async sendReservationReminder(
        notificationToken: string,
        reservation: {
            date: string;
            startTime: string;
            menuName: string;
            practitionerName: string;
            storeName: string;
        }
    ): Promise<void> {
        await this.sendServiceMessage({
            notificationToken,
            templateName: 'reservation_reminder',
            templateArgs: {
                title: '【明日のご予約】',
                body: `${reservation.date} ${reservation.startTime}\n${reservation.menuName}\n担当: ${reservation.practitionerName}`,
                subText: `${reservation.storeName}\nお待ちしております！`,
            },
        });
    }

    /**
     * Send cancellation notification
     */
    async sendCancellationNotification(
        lineUserId: string,
        reservation: {
            date: string;
            startTime: string;
            menuName: string;
        }
    ): Promise<void> {
        await this.sendPushMessage(lineUserId, [
            {
                type: 'text',
                text: `ご予約をキャンセルしました。\n\n${reservation.date} ${reservation.startTime}\n${reservation.menuName}\n\nまたのご利用をお待ちしております。`,
            },
        ]);
    }
}

/**
 * Create LineService for a tenant
 */
export function createLineService(tenant: Tenant): LineService {
    return new LineService(tenant);
}
