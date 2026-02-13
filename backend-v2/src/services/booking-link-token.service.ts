import { randomBytes } from 'crypto';
import { DatabaseService } from '../config/database.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { createPractitionerRepository, createStoreRepository, createTenantRepository } from '../repositories/index.js';
import { resolveLineConfigForTenant } from './line-config.service.js';
import type { LineConfigMode, Tenant } from '../types/index.js';

export type BookingLinkTokenStatus = 'active' | 'revoked';

export interface BookingLinkToken {
    id: string;
    tenantId: string;
    storeId?: string;
    practitionerId: string;
    token: string;
    status: BookingLinkTokenStatus;
    createdBy: string;
    createdAt: Date;
    lastUsedAt?: Date;
    expiresAt?: Date;
    storeName?: string;
    practitionerName?: string;
}

export interface ResolvedBookingLinkToken {
    tenantId: string;
    tenantKey: string;
    storeId?: string;
    practitionerId: string;
    lineMode: LineConfigMode;
    lineConfigSource: 'tenant' | 'store' | 'practitioner';
}

interface BookingLinkTokenRow {
    id: string;
    tenant_id: string;
    store_id: string | null;
    practitioner_id: string;
    token: string;
    status: BookingLinkTokenStatus;
    created_by: string;
    created_at: Date;
    last_used_at: Date | null;
    expires_at: Date | null;
    store_name?: string | null;
    practitioner_name?: string | null;
}

const TOKEN_ALPHABET_REGEX = /^[A-Za-z0-9_-]{16,128}$/;

function mapTokenRow(row: BookingLinkTokenRow): BookingLinkToken {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        storeId: row.store_id ?? undefined,
        practitionerId: row.practitioner_id,
        token: row.token,
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at ?? undefined,
        expiresAt: row.expires_at ?? undefined,
        storeName: row.store_name ?? undefined,
        practitionerName: row.practitioner_name ?? undefined,
    };
}

function normalizeToken(token: string): string {
    return token.trim();
}

async function generateUniqueToken(client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount?: number; rows: unknown[] }> }): Promise<string> {
    for (let i = 0; i < 10; i += 1) {
        const candidate = randomBytes(24).toString('base64url');
        const exists = await client.query(
            'SELECT id FROM booking_link_tokens WHERE token = $1 LIMIT 1',
            [candidate]
        );
        if ((exists.rowCount ?? 0) === 0) {
            return candidate;
        }
    }

    throw new Error('予約URLトークンの生成に失敗しました');
}

export class BookingLinkTokenService {
    constructor(private tenantId?: string) {}

    private requireTenantId(): string {
        if (!this.tenantId) {
            throw new Error('tenantId is required');
        }
        return this.tenantId;
    }

    async list(): Promise<BookingLinkToken[]> {
        const tenantId = this.requireTenantId();
        const rows = await DatabaseService.query<BookingLinkTokenRow>(
            `SELECT blt.*,
                    s.name AS store_name,
                    p.name AS practitioner_name
             FROM booking_link_tokens blt
             LEFT JOIN stores s
               ON s.id = blt.store_id
              AND s.tenant_id = blt.tenant_id
             LEFT JOIN practitioners p
               ON p.id = blt.practitioner_id
              AND p.tenant_id = blt.tenant_id
             WHERE blt.tenant_id = $1
             ORDER BY blt.created_at DESC`,
            [tenantId],
            tenantId
        );

        return rows.map(mapTokenRow);
    }

    async create(input: {
        practitionerId: string;
        storeId?: string;
        createdBy: string;
        expiresAt?: Date;
        reissue?: boolean;
    }): Promise<BookingLinkToken> {
        const tenantId = this.requireTenantId();

        const created = await DatabaseService.transaction<BookingLinkToken>(async (client) => {
            if (input.reissue ?? true) {
                await client.query(
                    `UPDATE booking_link_tokens
                     SET status = 'revoked'
                     WHERE tenant_id = $1
                       AND practitioner_id = $2
                       AND status = 'active'
                       AND (
                         (store_id IS NULL AND $3::uuid IS NULL)
                         OR store_id = $3::uuid
                       )`,
                    [tenantId, input.practitionerId, input.storeId ?? null]
                );
            }

            const token = await generateUniqueToken(client);
            const insert = await client.query<BookingLinkTokenRow>(
                `INSERT INTO booking_link_tokens (
                    tenant_id,
                    store_id,
                    practitioner_id,
                    token,
                    status,
                    created_by,
                    expires_at
                )
                VALUES ($1, $2, $3, $4, 'active', $5, $6)
                RETURNING *`,
                [
                    tenantId,
                    input.storeId ?? null,
                    input.practitionerId,
                    token,
                    input.createdBy,
                    input.expiresAt ?? null,
                ]
            );

            const row = insert.rows[0];
            if (!row) {
                throw new Error('予約URLトークンの作成に失敗しました');
            }
            return mapTokenRow(row);
        }, tenantId);

        return created;
    }

    async revoke(id: string): Promise<void> {
        const tenantId = this.requireTenantId();
        const row = await DatabaseService.queryOne<{ id: string }>(
            `UPDATE booking_link_tokens
             SET status = 'revoked'
             WHERE id = $1
               AND tenant_id = $2
             RETURNING id`,
            [id, tenantId],
            tenantId
        );

        if (!row) {
            throw new NotFoundError('予約URLトークン', id);
        }
    }

    async resolve(token: string): Promise<ResolvedBookingLinkToken | null> {
        const normalizedToken = normalizeToken(token);
        if (!TOKEN_ALPHABET_REGEX.test(normalizedToken)) {
            return null;
        }

        const row = await DatabaseService.queryOne<BookingLinkTokenRow>(
            `SELECT *
             FROM booking_link_tokens
             WHERE token = $1
               AND status = 'active'
               AND (expires_at IS NULL OR expires_at > NOW())
             LIMIT 1`,
            [normalizedToken]
        );
        if (!row) return null;

        const tenantRepo = createTenantRepository();
        const tenant = await tenantRepo.findById(row.tenant_id);
        if (!tenant || !['active', 'trial'].includes(tenant.status)) {
            return null;
        }

        const storeRepo = createStoreRepository(tenant.id);
        const practitionerRepo = createPractitionerRepository(tenant.id);

        const practitioner = await practitionerRepo.findById(row.practitioner_id);
        if (!practitioner || !practitioner.isActive) {
            return null;
        }

        let store = null;
        if (row.store_id) {
            store = await storeRepo.findById(row.store_id);
            if (!store || store.status !== 'active') {
                return null;
            }
        }

        const resolvedLine = resolveLineConfigForTenant(tenant as Tenant, store, practitioner);

        await DatabaseService.query(
            'UPDATE booking_link_tokens SET last_used_at = NOW() WHERE id = $1',
            [row.id]
        );

        return {
            tenantId: tenant.id,
            tenantKey: tenant.slug,
            storeId: store?.id,
            practitionerId: practitioner.id,
            lineMode: resolvedLine.mode,
            lineConfigSource: resolvedLine.source,
        };
    }

    async ensureActivePractitioner(practitionerId: string): Promise<void> {
        const tenantId = this.requireTenantId();
        const practitionerRepo = createPractitionerRepository(tenantId);
        const practitioner = await practitionerRepo.findById(practitionerId);
        if (!practitioner || !practitioner.isActive) {
            throw new NotFoundError('施術者', practitionerId);
        }
    }

    async ensureActiveStore(storeId: string): Promise<void> {
        const tenantId = this.requireTenantId();
        const storeRepo = createStoreRepository(tenantId);
        const store = await storeRepo.findById(storeId);
        if (!store || store.status !== 'active') {
            throw new NotFoundError('店舗', storeId);
        }
    }

    async ensureStorePractitionerRelation(storeId: string | undefined, practitionerId: string): Promise<void> {
        if (!storeId) return;

        const tenantId = this.requireTenantId();
        const practitionerRepo = createPractitionerRepository(tenantId);
        const practitioner = await practitionerRepo.findById(practitionerId);
        if (!practitioner || !practitioner.isActive) {
            throw new NotFoundError('施術者', practitionerId);
        }

        if ((practitioner.storeIds ?? []).length > 0 && !(practitioner.storeIds ?? []).includes(storeId)) {
            throw new ConflictError('選択した店舗に所属していない施術者です');
        }
    }
}

export function createBookingLinkTokenService(tenantId?: string): BookingLinkTokenService {
    return new BookingLinkTokenService(tenantId);
}
