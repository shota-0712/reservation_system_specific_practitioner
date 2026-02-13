/**
 * LINE Service Message Service
 * サービスメッセージ送信機能
 * Messaging API (Push Message) を使用して Flex Message を送信
 */

import { DatabaseService } from '../config/database.js';
import { TenantRepository } from '../repositories/tenant.repository.js';
import { createPractitionerRepository, createStoreRepository } from '../repositories/index.js';
import { decrypt } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { resolveLineConfigForTenant } from './line-config.service.js';
import type { Practitioner, Reservation, Store, Tenant } from '../types/index.js';

// メッセージタイプ
export type ServiceMessageType =
    | 'reservation_confirmation'
    | 'reminder_day_before'
    | 'reminder_same_day'
    | 'reservation_modified'
    | 'reservation_cancelled'
    | 'visit_completed';

// テンプレート引数
interface ServiceMessageTemplateArgs {
    title: string;
    store_name: string;
    date: string;
    time: string;
    menu: string;
    practitioner: string;
    duration: string;
    price: string;
    address?: string;
    note?: string;
    message?: string;
    change_type?: string;
    old_value?: string;
    new_value?: string;
    reason?: string;
    liffId?: string;
    reservationId?: string;
}

// 送信結果
interface SendResult {
    success: boolean;
    error?: string;
}

/**
 * サービスメッセージサービス
 */
export class ServiceMessageService {
    private tenantId: string;
    private tenantCache: Tenant | null = null;

    constructor(tenantId: string) {
        this.tenantId = tenantId;
    }

    /**
     * サービスメッセージを送信 (Messaging API Push Message)
     */
    async send(
        notificationToken: string, // ここでは LINE User ID (sub) を指定
        type: ServiceMessageType,
        reservation: Reservation,
        additionalData?: Record<string, string>
    ): Promise<SendResult> {
        try {
            const {
                tenant,
                store,
                line,
            } = await this.resolveLineConfigContext(reservation);
            let channelAccessToken = line.lineConfig.channelAccessToken;
            const liffId = line.lineConfig.liffId;

            if (!channelAccessToken) {
                logger.warn('No LINE channel access token configured', {
                    tenantId: this.tenantId,
                    reservationId: reservation.id,
                    mode: line.mode,
                    source: line.source,
                    storeId: line.storeId ?? reservation.storeId,
                    practitionerId: line.practitionerId ?? reservation.practitionerId,
                });
                return { success: false, error: 'No channel access token' };
            }
            try {
                channelAccessToken = decrypt(channelAccessToken);
            } catch {
                // already plain (dev)
            }

            // Flex Message を構築
            const templateArgs = this.buildTemplateArgs(type, reservation, tenant, store, additionalData, liffId);
            const flexMessage = this.buildFlexMessage(type, templateArgs);

            // Messaging API Push Message
            const response = await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${channelAccessToken}`,
                },
                body: JSON.stringify({
                    to: notificationToken,
                    messages: [flexMessage]
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = `LINE API error: ${response.status} ${JSON.stringify(errorData)}`;

                // エラーログ保存
                await this.logMessage(type, reservation.id, 'failed', errorMessage);

                logger.error('Failed to send service message', {
                    tenantId: this.tenantId,
                    reservationId: reservation.id,
                    type,
                    error: errorMessage,
                    lineMode: line.mode,
                    lineSource: line.source,
                    lineStoreId: line.storeId,
                    linePractitionerId: line.practitionerId,
                });

                return { success: false, error: errorMessage };
            }

            // 成功ログ保存
            await this.logMessage(type, reservation.id, 'success');

            logger.info('Service message sent successfully', {
                tenantId: this.tenantId,
                reservationId: reservation.id,
                type,
                lineMode: line.mode,
                lineSource: line.source,
                lineStoreId: line.storeId,
                linePractitionerId: line.practitionerId,
            });

            return { success: true };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            await this.logMessage(type, reservation.id, 'failed', errorMessage);

            logger.error('Service message send error', {
                tenantId: this.tenantId,
                reservationId: reservation.id,
                type,
                error: errorMessage,
            });

            return { success: false, error: errorMessage };
        }
    }

    /**
     * 各種通知メソッド
     */
    async sendConfirmation(token: string, res: Reservation) {
        return this.send(token, 'reservation_confirmation', res);
    }

    async sendDayBeforeReminder(token: string, res: Reservation) {
        return this.send(token, 'reminder_day_before', res);
    }

    async sendSameDayReminder(token: string, res: Reservation) {
        return this.send(token, 'reminder_same_day', res);
    }

    async sendModificationNotice(token: string, res: Reservation, changeType: string, oldValue: string, newValue: string) {
        return this.send(token, 'reservation_modified', res, { changeType, oldValue, newValue });
    }

    async sendCancellationNotice(token: string, res: Reservation, reason?: string) {
        return this.send(token, 'reservation_cancelled', res, { reason: reason ?? '' });
    }

    async sendVisitCompletedNotice(token: string, res: Reservation) {
        return this.send(token, 'visit_completed', res);
    }

    /**
     * Flex Message オブジェクトの構築
     */
    private buildFlexMessage(type: ServiceMessageType, args: ServiceMessageTemplateArgs): any {
        const headerColor = '#E11D48'; // Primary Color

        let title = args.title;
        let altText = args.title;
        let contents: any[] = [];

        // 共通行作成ヘルパー
        const row = (label: string, value: string) => ({
            type: 'box',
            layout: 'baseline',
            margin: 'md',
            contents: [
                { type: 'text', text: label, color: '#aaaaaa', size: 'sm', flex: 2 },
                { type: 'text', text: value, wrap: true, color: '#666666', size: 'sm', flex: 5 }
            ]
        });

        // 共通フッター作成
        const footerButton = (label: string, uri: string) => ({
            type: 'button',
            style: 'link',
            height: 'sm',
            action: { type: 'uri', label: label, uri: uri }
        });

        // 本文構築
        contents.push(row('日時', `${args.date} ${args.time}`));
        contents.push(row('メニュー', args.menu));
        contents.push(row('担当', args.practitioner));
        contents.push(row('料金', args.price));

        if (args.duration) contents.push(row('所要時間', `${args.duration}分`));
        if (args.address) contents.push(row('場所', args.address));

        // タイプ別の追加情報
        if (type === 'reservation_modified') {
            contents.push({ type: 'separator', margin: 'lg' });
            contents.push(row('変更種別', args.change_type || ''));
            contents.push(row('変更前', args.old_value || ''));
            contents.push(row('変更後', args.new_value || ''));
        }

        if (type === 'reservation_cancelled' && args.reason) {
            contents.push({ type: 'separator', margin: 'lg' });
            contents.push(row('理由', args.reason));
        }

        if (args.note) {
            contents.push({ type: 'separator', margin: 'lg' });
            contents.push({
                type: 'text', text: args.note, wrap: true, margin: 'md', size: 'xs', color: '#aaaaaa'
            });
        }

        if (args.message) {
            contents.push({ type: 'separator', margin: 'lg' });
            contents.push({
                type: 'text', text: args.message, wrap: true, margin: 'md', size: 'sm', color: '#666666'
            });
        }

        // アクションボタン
        let footerContents = [];
        const liffBaseUrl = args.liffId ? `https://miniapp.line.me/${args.liffId}` : undefined;
        const reservationUrl = liffBaseUrl && args.reservationId
            ? `${liffBaseUrl}/reservations/${args.reservationId}`
            : liffBaseUrl;

        if (liffBaseUrl) {
            if (type === 'visit_completed') {
                footerContents.push(footerButton('次回の予約をする', liffBaseUrl));
            } else if (type !== 'reservation_cancelled' && reservationUrl) {
                footerContents.push(footerButton('予約詳細を確認', reservationUrl));
            } else if (type === 'reservation_cancelled') {
                footerContents.push(footerButton('新しく予約する', liffBaseUrl));
            }
        }

        const bubble: Record<string, any> = {
            type: 'bubble',
            header: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    { type: 'text', text: title, weight: 'bold', color: '#ffffff', wrap: true }
                ],
                backgroundColor: headerColor
            },
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    { type: 'text', text: args.store_name, weight: 'bold', size: 'lg', margin: 'md' },
                    { type: 'separator', margin: 'md' },
                    ...contents
                ]
            },
        };

        if (footerContents.length > 0) {
            bubble.footer = {
                type: 'box',
                layout: 'vertical',
                contents: footerContents,
            };
        }

        return {
            type: 'flex',
            altText: altText,
            contents: bubble,
        };
    }

    /**
     * テンプレート引数を構築
     */
    private buildTemplateArgs(
        type: ServiceMessageType,
        reservation: Reservation,
        tenant: Tenant,
        store: Store | null,
        additionalData?: Record<string, string>,
        liffId?: string
    ): ServiceMessageTemplateArgs {
        const baseArgs: ServiceMessageTemplateArgs = {
            title: '',
            store_name: store?.name || tenant.name,
            date: this.formatDate(reservation.date),
            time: reservation.startTime,
            menu: reservation.menuNames?.join('、') ?? '',
            practitioner: reservation.practitionerName ?? '',
            duration: String(reservation.duration ?? 0),
            price: this.formatPrice(reservation.totalPrice ?? 0),
            address: store?.address ?? '',
            liffId: liffId,
            reservationId: reservation.id
        };

        switch (type) {
            case 'reservation_confirmation':
                baseArgs.title = 'ご予約承りました';
                baseArgs.note = 'ご来店をお待ちしております';
                break;
            case 'reminder_day_before':
                baseArgs.title = '【明日のご予約】';
                baseArgs.note = 'ご来店をお待ちしております！';
                break;
            case 'reminder_same_day':
                baseArgs.title = '【本日のご予約】';
                baseArgs.note = '本日お会いできるのを楽しみにしております！';
                break;
            case 'reservation_modified':
                baseArgs.title = '予約変更のお知らせ';
                baseArgs.change_type = additionalData?.changeType;
                baseArgs.old_value = additionalData?.oldValue;
                baseArgs.new_value = additionalData?.newValue;
                break;
            case 'reservation_cancelled':
                baseArgs.title = 'キャンセルのお知らせ';
                baseArgs.reason = additionalData?.reason;
                break;
            case 'visit_completed':
                baseArgs.title = 'ご来店ありがとうございました';
                baseArgs.message = 'またのご利用をお待ちしております。';
                break;
        }
        return baseArgs;
    }

    /**
     * テナント情報を取得（キャッシュ付き）
     */
    private async getTenant(): Promise<Tenant> {
        if (this.tenantCache) {
            return this.tenantCache;
        }

        const tenantRepo = new TenantRepository();
        const tenant = await tenantRepo.findById(this.tenantId);
        if (!tenant) {
            throw new Error(`Tenant not found: ${this.tenantId}`);
        }
        this.tenantCache = tenant;
        return this.tenantCache;
    }

    private async resolveLineConfigContext(
        reservation: Reservation
    ): Promise<{
        tenant: Tenant;
        store: Store | null;
        practitioner: Practitioner | null;
        line: ReturnType<typeof resolveLineConfigForTenant>;
    }> {
        const tenant = await this.getTenant();
        const storeRepo = createStoreRepository(this.tenantId);
        const practitionerRepo = createPractitionerRepository(this.tenantId);

        const store = reservation.storeId ? await storeRepo.findById(reservation.storeId) : null;
        const practitioner = reservation.practitionerId
            ? await practitionerRepo.findById(reservation.practitionerId)
            : null;
        const line = resolveLineConfigForTenant(tenant, store, practitioner);

        return {
            tenant,
            store,
            practitioner,
            line,
        };
    }

    /**
     * 送信ログを保存
     */
    private async logMessage(
        type: ServiceMessageType,
        reservationId: string,
        status: 'success' | 'failed',
        error?: string
    ): Promise<void> {
        try {
            await DatabaseService.query(
                `INSERT INTO service_message_logs (
                    tenant_id, reservation_id, message_type, status, error, sent_at
                ) VALUES ($1, $2, $3, $4, $5, NOW())`,
                [this.tenantId, reservationId, type, status, error ?? null],
                this.tenantId
            );
        } catch (logError) {
            logger.error('Failed to save service message log', {
                tenantId: this.tenantId,
                reservationId,
                error: logError,
            });
        }
    }

    /**
     * 日付をフォーマット
     */
    private formatDate(dateStr: string): string {
        try {
            const date = new Date(dateStr);
            const days = ['日', '月', '火', '水', '木', '金', '土'];
            return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${days[date.getDay()]}）`;
        } catch {
            return dateStr;
        }
    }

    /**
     * 価格をフォーマット
     */
    private formatPrice(price: number): string {
        return new Intl.NumberFormat('ja-JP').format(price);
    }
}

/**
 * サービスメッセージサービスのファクトリ関数
 */
export function createServiceMessageService(tenantId: string): ServiceMessageService {
    return new ServiceMessageService(tenantId);
}
