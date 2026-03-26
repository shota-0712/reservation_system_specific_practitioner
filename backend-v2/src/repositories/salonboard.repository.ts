import { DatabaseService } from '../config/database.js';
import { decrypt, encrypt } from '../utils/crypto.js';

export type SalonboardSyncDirection = 'inbound' | 'outbound' | 'both';
export type SalonboardSyncStatus = 'success' | 'partial' | 'failed';

export interface SalonboardConfigRecord {
    tenantId: string;
    isEnabled: boolean;
    syncDirection: SalonboardSyncDirection;
    username?: string;
    password?: string;
    sessionCookie?: string;
    lastSyncAt?: Date;
    lastSyncStatus?: SalonboardSyncStatus;
    lastSyncError?: string;
    createdAt: Date;
    updatedAt: Date;
}

interface SalonboardConfigRow {
    tenant_id: string;
    username_encrypted: string | null;
    password_encrypted: string | null;
    session_cookie_encrypted: string | null;
    is_enabled: boolean | null;
    sync_direction: SalonboardSyncDirection | null;
    last_sync_at: Date | null;
    last_sync_status: SalonboardSyncStatus | null;
    last_sync_error: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface SalonboardConfigUpdateInput {
    isEnabled?: boolean;
    syncDirection?: SalonboardSyncDirection;
    username?: string;
    password?: string;
    sessionCookie?: string;
}

export interface SalonboardSyncOutcomeInput {
    lastSyncStatus: SalonboardSyncStatus;
    lastSyncError?: string | null;
    lastSyncAt?: Date;
}

function safeDecrypt(value: string | null): string | undefined {
    if (!value) {
        return undefined;
    }

    try {
        return decrypt(value);
    } catch {
        return value;
    }
}

function maybeEncrypt(value?: string): string | null {
    if (!value) {
        return null;
    }

    const parts = value.split(':');
    if (parts.length === 3) {
        return value;
    }

    return encrypt(value);
}

function mapSalonboardConfig(row: SalonboardConfigRow): SalonboardConfigRecord {
    return {
        tenantId: row.tenant_id,
        isEnabled: row.is_enabled ?? false,
        syncDirection: row.sync_direction ?? 'both',
        username: safeDecrypt(row.username_encrypted),
        password: safeDecrypt(row.password_encrypted),
        sessionCookie: safeDecrypt(row.session_cookie_encrypted),
        lastSyncAt: row.last_sync_at ?? undefined,
        lastSyncStatus: row.last_sync_status ?? undefined,
        lastSyncError: row.last_sync_error ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export class SalonboardConfigRepository {
    constructor(private readonly tenantId: string) {}

    async get(): Promise<SalonboardConfigRecord> {
        const row = await DatabaseService.queryOne<SalonboardConfigRow>(
            `SELECT tenant_id, username_encrypted, password_encrypted, session_cookie_encrypted,
                    is_enabled, sync_direction, last_sync_at, last_sync_status, last_sync_error,
                    created_at, updated_at
             FROM tenant_salonboard_config
             WHERE tenant_id = $1
             LIMIT 1`,
            [this.tenantId],
            this.tenantId
        );

        if (!row) {
            const now = new Date();
            return {
                tenantId: this.tenantId,
                isEnabled: false,
                syncDirection: 'both',
                createdAt: now,
                updatedAt: now,
            };
        }

        return mapSalonboardConfig(row);
    }

    async upsert(input: SalonboardConfigUpdateInput): Promise<SalonboardConfigRecord> {
        const current = await this.get();
        const row = await DatabaseService.queryOne<SalonboardConfigRow>(
            `INSERT INTO tenant_salonboard_config (
                tenant_id,
                username_encrypted,
                password_encrypted,
                session_cookie_encrypted,
                is_enabled,
                sync_direction,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (tenant_id) DO UPDATE SET
                username_encrypted = COALESCE(EXCLUDED.username_encrypted, tenant_salonboard_config.username_encrypted),
                password_encrypted = COALESCE(EXCLUDED.password_encrypted, tenant_salonboard_config.password_encrypted),
                session_cookie_encrypted = COALESCE(EXCLUDED.session_cookie_encrypted, tenant_salonboard_config.session_cookie_encrypted),
                is_enabled = EXCLUDED.is_enabled,
                sync_direction = EXCLUDED.sync_direction,
                updated_at = NOW()
            RETURNING tenant_id, username_encrypted, password_encrypted, session_cookie_encrypted,
                      is_enabled, sync_direction, last_sync_at, last_sync_status, last_sync_error,
                      created_at, updated_at`,
            [
                this.tenantId,
                maybeEncrypt(input.username),
                maybeEncrypt(input.password),
                maybeEncrypt(input.sessionCookie),
                input.isEnabled ?? current.isEnabled,
                input.syncDirection ?? current.syncDirection,
            ],
            this.tenantId
        );

        if (!row) {
            throw new Error('Salonboard設定の保存に失敗しました');
        }

        return mapSalonboardConfig(row);
    }

    async recordSyncOutcome(input: SalonboardSyncOutcomeInput): Promise<SalonboardConfigRecord> {
        const row = await DatabaseService.queryOne<SalonboardConfigRow>(
            `UPDATE tenant_salonboard_config
             SET last_sync_at = COALESCE($2, last_sync_at),
                 last_sync_status = $3,
                 last_sync_error = $4,
                 updated_at = NOW()
             WHERE tenant_id = $1
             RETURNING tenant_id, username_encrypted, password_encrypted, session_cookie_encrypted,
                       is_enabled, sync_direction, last_sync_at, last_sync_status, last_sync_error,
                       created_at, updated_at`,
            [
                this.tenantId,
                input.lastSyncAt ?? new Date(),
                input.lastSyncStatus,
                input.lastSyncError ?? null,
            ],
            this.tenantId
        );

        if (!row) {
            const current = await this.get();
            return {
                ...current,
                lastSyncAt: input.lastSyncAt ?? new Date(),
                lastSyncStatus: input.lastSyncStatus,
                lastSyncError: input.lastSyncError ?? undefined,
            };
        }

        return mapSalonboardConfig(row);
    }
}

export function createSalonboardConfigRepository(tenantId: string): SalonboardConfigRepository {
    return new SalonboardConfigRepository(tenantId);
}
