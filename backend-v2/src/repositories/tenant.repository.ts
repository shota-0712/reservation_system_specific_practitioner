/**
 * Tenant Repository (PostgreSQL)
 * CRUD operations for tenants and stores
 */

import { DatabaseService } from '../config/database.js';
import { encrypt } from '../utils/crypto.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import type { Tenant, Store } from '../types/index.js';

interface TenantRow {
    id: string;
    slug: string;
    name: string;
    plan: string;
    status: string;
    onboarding_status?: Tenant['onboardingStatus'];
    onboarding_completed_at?: Date;
    onboarding_payload?: Record<string, unknown>;
    line_mode?: Tenant['lineConfig'] extends { mode?: infer M } ? M : string;
    line_liff_id?: string;
    line_channel_id?: string;
    line_channel_access_token_encrypted?: string;
    line_channel_secret_encrypted?: string;
    branding_primary_color?: string;
    branding_logo_url?: string;
    branding_favicon_url?: string;
    stripe_customer_id?: string;
    subscription_current_period_end?: Date;
    max_stores?: number;
    max_practitioners?: number;
    created_at: Date;
    updated_at: Date;
}

function mapTenant(row: TenantRow): Tenant {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        plan: row.plan as Tenant['plan'],
        status: row.status as Tenant['status'],
        onboardingStatus: row.onboarding_status,
        onboardingCompletedAt: row.onboarding_completed_at,
        onboardingPayload: row.onboarding_payload,
        lineConfig: (row.line_channel_id || row.line_liff_id || row.line_mode) ? {
            mode: (row.line_mode as Tenant['lineConfig'] extends { mode?: infer M } ? M : never) ?? 'tenant',
            channelId: row.line_channel_id,
            channelSecret: row.line_channel_secret_encrypted ?? undefined,
            channelAccessToken: row.line_channel_access_token_encrypted ?? undefined,
            liffId: row.line_liff_id,
        } : undefined,
        branding: {
            primaryColor: row.branding_primary_color ?? '#4F46E5',
            logoUrl: row.branding_logo_url,
            faviconUrl: row.branding_favicon_url,
        },
        stripeCustomerId: row.stripe_customer_id,
        subscriptionCurrentPeriodEnd: row.subscription_current_period_end,
        maxStores: row.max_stores ?? 1,
        maxPractitioners: row.max_practitioners ?? 5,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapStore(row: Record<string, any>): Store {
    const lineConfig = (row.line_channel_id || row.line_liff_id || row.line_channel_access_token_encrypted || row.line_channel_secret_encrypted)
        ? {
            channelId: row.line_channel_id ?? undefined,
            channelSecret: row.line_channel_secret_encrypted ?? undefined,
            channelAccessToken: row.line_channel_access_token_encrypted ?? undefined,
            liffId: row.line_liff_id ?? undefined,
        }
        : undefined;

    return {
        id: row.id,
        tenantId: row.tenant_id,
        storeCode: row.store_code,
        name: row.name,
        address: row.address ?? undefined,
        phone: row.phone ?? undefined,
        email: row.email ?? undefined,
        timezone: row.timezone ?? 'Asia/Tokyo',
        businessHours: row.business_hours ?? undefined,
        regularHolidays: row.regular_holidays ?? [],
        temporaryHolidays: row.temporary_holidays ?? [],
        temporaryOpenDays: row.temporary_open_days ?? [],
        slotDuration: row.slot_duration ?? 30,
        advanceBookingDays: row.advance_booking_days ?? 30,
        cancelDeadlineHours: row.cancel_deadline_hours ?? 24,
        requirePhone: row.require_phone ?? true,
        requireEmail: row.require_email ?? false,
        status: row.status ?? 'active',
        displayOrder: row.display_order ?? 0,
        lineConfig,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function maybeEncrypt(value?: string): string | null {
    if (!value) return null;
    const parts = value.split(':');
    if (parts.length === 3) return value;
    return encrypt(value);
}

/**
 * Tenant Repository
 * Note: Tenants are stored at the root level, not under RLS
 */
export class TenantRepository {
    /**
     * Find tenant by ID
     */
    async findById(id: string): Promise<Tenant | null> {
        const row = await DatabaseService.queryOne<TenantRow>(
            'SELECT * FROM tenants WHERE id = $1',
            [id]
        );
        return row ? mapTenant(row) : null;
    }

    /**
     * Find tenant by ID or throw
     */
    async findByIdOrFail(id: string): Promise<Tenant> {
        const tenant = await this.findById(id);
        if (!tenant) {
            throw new NotFoundError('テナント', id);
        }
        return tenant;
    }

    /**
     * Find tenant by slug
     */
    async findBySlug(slug: string): Promise<Tenant | null> {
        const row = await DatabaseService.queryOne<TenantRow>(
            'SELECT * FROM tenants WHERE slug = $1',
            [slug]
        );
        return row ? mapTenant(row) : null;
    }

    /**
     * Find tenant by store code (via stores table)
     */
    async findByStoreCode(storeCode: string): Promise<Tenant | null> {
        const row = await DatabaseService.queryOne<TenantRow>(
            `SELECT t.* FROM tenants t
             INNER JOIN stores s ON s.tenant_id = t.id
             WHERE s.store_code = $1`,
            [storeCode]
        );
        return row ? mapTenant(row) : null;
    }

    /**
     * Find all tenants
     */
    async findAll(options: {
        onlyActive?: boolean;
        limit?: number;
    } = {}): Promise<Tenant[]> {
        let sql = 'SELECT * FROM tenants WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;

        if (options.onlyActive !== false) {
            sql += ` AND status = 'active'`;
        }

        sql += ' ORDER BY name ASC';

        if (options.limit) {
            sql += ` LIMIT $${paramIndex}`;
            params.push(options.limit);
        }

        const rows = await DatabaseService.query<TenantRow>(sql, params);
        return rows.map(mapTenant);
    }

    /**
     * Create new tenant
     */
    async create(data: {
        slug: string;
        name: string;
        lineConfig?: Tenant['lineConfig'];
        branding?: Partial<Tenant['branding']>;
        plan?: Tenant['plan'];
        status?: Tenant['status'];
        onboardingStatus?: Tenant['onboardingStatus'];
        onboardingPayload?: Record<string, unknown>;
    }): Promise<Tenant> {
        // Check slug uniqueness
        const existing = await this.findBySlug(data.slug);
        if (existing) {
            throw new ConflictError(`スラッグ "${data.slug}" は既に使用されています`);
        }

        const row = await DatabaseService.queryOne<TenantRow>(
            `INSERT INTO tenants (
                slug, name, plan, status,
                onboarding_status, onboarding_payload,
                line_mode,
                line_liff_id, line_channel_id,
                branding_primary_color, branding_logo_url
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
            RETURNING *`,
            [
                data.slug,
                data.name,
                data.plan ?? 'trial',
                data.status ?? 'trial',
                data.onboardingStatus ?? 'pending',
                JSON.stringify(data.onboardingPayload ?? {}),
                data.lineConfig?.mode ?? 'tenant',
                data.lineConfig?.liffId ?? null,
                data.lineConfig?.channelId ?? null,
                data.branding?.primaryColor ?? '#4F46E5',
                data.branding?.logoUrl ?? null,
            ]
        );

        if (!row) {
            throw new Error('テナントの作成に失敗しました');
        }

        return mapTenant(row);
    }

    /**
     * Update tenant
     */
    async update(
        id: string,
        data: Partial<Omit<Tenant, 'id' | 'slug' | 'createdAt' | 'updatedAt'>>
    ): Promise<Tenant> {
        const row = await DatabaseService.queryOne<TenantRow>(
            `UPDATE tenants SET
                name = COALESCE($2, name),
                plan = COALESCE($3, plan),
                status = COALESCE($4, status),
                line_liff_id = COALESCE($5, line_liff_id),
                line_channel_id = COALESCE($6, line_channel_id),
                line_mode = COALESCE($7, line_mode),
                branding_primary_color = COALESCE($8, branding_primary_color),
                branding_logo_url = COALESCE($9, branding_logo_url),
                max_stores = COALESCE($10, max_stores),
                max_practitioners = COALESCE($11, max_practitioners),
                onboarding_status = COALESCE($12, onboarding_status),
                onboarding_payload = COALESCE($13::jsonb, onboarding_payload),
                onboarding_completed_at = CASE
                    WHEN $12 = 'completed' THEN NOW()
                    WHEN $12 IS NULL THEN onboarding_completed_at
                    ELSE NULL
                END,
                updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
                id,
                data.name ?? null,
                data.plan ?? null,
                data.status ?? null,
                data.lineConfig?.liffId ?? null,
                data.lineConfig?.channelId ?? null,
                data.lineConfig?.mode ?? null,
                data.branding?.primaryColor ?? null,
                data.branding?.logoUrl ?? null,
                data.maxStores ?? null,
                data.maxPractitioners ?? null,
                data.onboardingStatus ?? null,
                data.onboardingPayload ? JSON.stringify(data.onboardingPayload) : null,
            ]
        );

        if (!row) {
            throw new NotFoundError('テナント', id);
        }

        return mapTenant(row);
    }

    /**
     * Update LINE config
     */
    async updateLineConfig(
        id: string,
        config: Partial<Tenant['lineConfig']>
    ): Promise<Tenant> {
        const maybeEncrypt = (value?: string): string | null => {
            if (!value) return null;
            const parts = value.split(':');
            if (parts.length === 3) return value;
            return encrypt(value);
        };

        const row = await DatabaseService.queryOne<TenantRow>(
            `UPDATE tenants SET
                line_liff_id = COALESCE($2, line_liff_id),
                line_channel_id = COALESCE($3, line_channel_id),
                line_channel_access_token_encrypted = COALESCE($4, line_channel_access_token_encrypted),
                line_channel_secret_encrypted = COALESCE($5, line_channel_secret_encrypted),
                line_mode = COALESCE($6, line_mode),
                updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
                id,
                config?.liffId ?? null,
                config?.channelId ?? null,
                maybeEncrypt(config?.channelAccessToken) ?? null,
                maybeEncrypt(config?.channelSecret) ?? null,
                config?.mode ?? null,
            ]
        );

        if (!row) {
            throw new NotFoundError('テナント', id);
        }

        return mapTenant(row);
    }

    /**
     * Activate tenant
     */
    async activate(id: string): Promise<Tenant> {
        return this.update(id, { status: 'active' });
    }

    /**
     * Deactivate tenant
     */
    async deactivate(id: string): Promise<Tenant> {
        return this.update(id, { status: 'suspended' });
    }

    /**
     * Check if slug is available
     */
    async isSlugAvailable(slug: string): Promise<boolean> {
        const existing = await this.findBySlug(slug);
        return existing === null;
    }

    async getOnboardingStatus(tenantId: string): Promise<{
        onboardingStatus: Tenant['onboardingStatus'];
        onboardingCompletedAt?: Date;
        onboardingPayload?: Record<string, unknown>;
    } | null> {
        const row = await DatabaseService.queryOne<{
            onboarding_status: Tenant['onboardingStatus'];
            onboarding_completed_at?: Date;
            onboarding_payload?: Record<string, unknown>;
        }>(
            `SELECT onboarding_status, onboarding_completed_at, onboarding_payload
             FROM tenants
             WHERE id = $1`,
            [tenantId]
        );

        if (!row) {
            return null;
        }

        return {
            onboardingStatus: row.onboarding_status,
            onboardingCompletedAt: row.onboarding_completed_at,
            onboardingPayload: row.onboarding_payload,
        };
    }

    async updateOnboarding(
        tenantId: string,
        payload: {
            status?: Tenant['onboardingStatus'];
            onboardingPayload?: Record<string, unknown>;
        }
    ): Promise<Tenant> {
        const row = await DatabaseService.queryOne<TenantRow>(
            `UPDATE tenants
             SET onboarding_status = COALESCE($2, onboarding_status),
                 onboarding_payload = COALESCE($3::jsonb, onboarding_payload),
                 onboarding_completed_at = CASE
                     WHEN $2 = 'completed' THEN NOW()
                     WHEN $2 IS NULL THEN onboarding_completed_at
                     ELSE NULL
                 END,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
                tenantId,
                payload.status ?? null,
                payload.onboardingPayload ? JSON.stringify(payload.onboardingPayload) : null,
            ]
        );

        if (!row) {
            throw new NotFoundError('テナント', tenantId);
        }

        return mapTenant(row);
    }
}

/**
 * Store Repository
 */
export class StoreRepository {
    constructor(private tenantId: string) {}

    /**
     * Find store by ID
     */
    async findById(id: string): Promise<Store | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM stores WHERE id = $1 AND tenant_id = $2',
            [id, this.tenantId],
            this.tenantId
        );
        return row ? mapStore(row as Record<string, any>) : null;
    }

    /**
     * Find store by store code
     */
    async findByStoreCode(storeCode: string): Promise<Store | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM stores WHERE store_code = $1 AND tenant_id = $2',
            [storeCode, this.tenantId],
            this.tenantId
        );
        return row ? mapStore(row as Record<string, any>) : null;
    }

    /**
     * Find all stores for tenant
     */
    async findAll(options: { includeInactive?: boolean } = {}): Promise<Store[]> {
        const includeInactive = options.includeInactive ?? false;
        let sql = `SELECT * FROM stores WHERE tenant_id = $1`;
        if (!includeInactive) {
            sql += ` AND status = 'active'`;
        }
        sql += ' ORDER BY display_order ASC, created_at ASC';

        const rows = await DatabaseService.query(
            sql,
            [this.tenantId],
            this.tenantId
        );
        return rows.map(r => mapStore(r as Record<string, any>));
    }

    /**
     * Create store
     */
    async create(data: Partial<Store>): Promise<Store> {
        // Check store code uniqueness
        const existingRow = await DatabaseService.queryOne(
            'SELECT id FROM stores WHERE store_code = $1',
            [data.storeCode]
        );
        if (existingRow) {
            throw new ConflictError(`店舗コード "${data.storeCode}" は既に使用されています`);
        }

        const row = await DatabaseService.queryOne(
            `INSERT INTO stores (
                tenant_id, store_code, name, address, phone, email, timezone,
                business_hours, regular_holidays, slot_duration, advance_booking_days,
                cancel_deadline_hours, require_phone, require_email, status, display_order,
                line_liff_id, line_channel_id, line_channel_access_token_encrypted, line_channel_secret_encrypted
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING *`,
            [
                this.tenantId,
                data.storeCode,
                data.name,
                data.address ?? null,
                data.phone ?? null,
                data.email ?? null,
                data.timezone ?? 'Asia/Tokyo',
                JSON.stringify(data.businessHours ?? {}),
                data.regularHolidays ?? [],
                data.slotDuration ?? 30,
                data.advanceBookingDays ?? 30,
                data.cancelDeadlineHours ?? 24,
                data.requirePhone ?? true,
                data.requireEmail ?? false,
                data.status ?? 'active',
                data.displayOrder ?? 0,
                data.lineConfig?.liffId ?? null,
                data.lineConfig?.channelId ?? null,
                maybeEncrypt(data.lineConfig?.channelAccessToken),
                maybeEncrypt(data.lineConfig?.channelSecret),
            ],
            this.tenantId
        );

        return mapStore(row as Record<string, any>);
    }

    /**
     * Update store
     */
    async update(id: string, data: Partial<Store>): Promise<Store> {
        const row = await DatabaseService.queryOne(
            `UPDATE stores SET
                name = COALESCE($3, name),
                address = COALESCE($4, address),
                phone = COALESCE($5, phone),
                email = COALESCE($6, email),
                timezone = COALESCE($7, timezone),
                business_hours = COALESCE($8, business_hours),
                regular_holidays = COALESCE($9, regular_holidays),
                slot_duration = COALESCE($10, slot_duration),
                advance_booking_days = COALESCE($11, advance_booking_days),
                cancel_deadline_hours = COALESCE($12, cancel_deadline_hours),
                require_phone = COALESCE($13, require_phone),
                require_email = COALESCE($14, require_email),
                status = COALESCE($15, status),
                display_order = COALESCE($16, display_order),
                line_liff_id = COALESCE($17, line_liff_id),
                line_channel_id = COALESCE($18, line_channel_id),
                line_channel_access_token_encrypted = COALESCE($19, line_channel_access_token_encrypted),
                line_channel_secret_encrypted = COALESCE($20, line_channel_secret_encrypted),
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [
                id,
                this.tenantId,
                data.name ?? null,
                data.address ?? null,
                data.phone ?? null,
                data.email ?? null,
                data.timezone ?? null,
                data.businessHours ? JSON.stringify(data.businessHours) : null,
                data.regularHolidays ?? null,
                data.slotDuration ?? null,
                data.advanceBookingDays ?? null,
                data.cancelDeadlineHours ?? null,
                data.requirePhone ?? null,
                data.requireEmail ?? null,
                data.status ?? null,
                data.displayOrder ?? null,
                data.lineConfig?.liffId ?? null,
                data.lineConfig?.channelId ?? null,
                maybeEncrypt(data.lineConfig?.channelAccessToken),
                maybeEncrypt(data.lineConfig?.channelSecret),
            ],
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('店舗', id);
        }

        return mapStore(row as Record<string, any>);
    }

    /**
     * Delete store (soft delete)
     */
    async softDelete(id: string): Promise<void> {
        await DatabaseService.query(
            `UPDATE stores SET status = 'inactive', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
            [id, this.tenantId],
            this.tenantId
        );
    }
}

// Factory functions
export function createTenantRepository(): TenantRepository {
    return new TenantRepository();
}

export function createStoreRepository(tenantId: string): StoreRepository {
    return new StoreRepository(tenantId);
}
