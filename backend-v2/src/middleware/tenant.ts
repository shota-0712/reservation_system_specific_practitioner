/**
 * Tenant Resolution Middleware (SQL)
 * Resolves tenant from URL path, store code, slug, or header
 */

import { Request, Response, NextFunction } from 'express';
import { DatabaseService } from '../config/database.js';
import { TenantNotFoundError, TenantInactiveError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { Tenant, AuthenticatedRequest } from '../types/index.js';

// Cache for tenant data (simple in-memory cache)
const tenantCache = new Map<string, { tenant: Tenant; expiresAt: number }>();
const storeCache = new Map<string, { tenant: Tenant; storeId: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const UUID_V4_LIKE_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidLike(value: string): boolean {
    return UUID_V4_LIKE_REGEX.test(value);
}

function mapTenantRow(row: Record<string, any>): Tenant {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        plan: row.plan,
        status: row.status,
        onboardingStatus: row.onboarding_status ?? undefined,
        onboardingCompletedAt: row.onboarding_completed_at ?? undefined,
        onboardingPayload: row.onboarding_payload ?? undefined,
        lineConfig: {
            channelId: row.line_channel_id ?? undefined,
            channelSecret: row.line_channel_secret_encrypted ?? undefined,
            channelAccessToken: row.line_channel_access_token_encrypted ?? undefined,
            liffId: row.line_liff_id ?? undefined,
        },
        branding: {
            primaryColor: row.branding_primary_color ?? undefined,
            logoUrl: row.branding_logo_url ?? undefined,
            faviconUrl: row.branding_favicon_url ?? undefined,
        },
        stripeCustomerId: row.stripe_customer_id ?? undefined,
        subscriptionCurrentPeriodEnd: row.subscription_current_period_end ?? undefined,
        maxStores: row.max_stores ?? undefined,
        maxPractitioners: row.max_practitioners ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

async function getTenantById(tenantId: string): Promise<Tenant | null> {
    const cached = tenantCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.tenant;
    }

    const row = await DatabaseService.queryOne(
        'SELECT * FROM tenants WHERE id = $1',
        [tenantId]
    );

    if (!row) {
        tenantCache.delete(tenantId);
        return null;
    }

    const tenant = mapTenantRow(row as Record<string, any>);
    tenantCache.set(tenantId, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });
    return tenant;
}

async function getTenantBySlug(slug: string): Promise<Tenant | null> {
    const row = await DatabaseService.queryOne(
        'SELECT * FROM tenants WHERE slug = $1',
        [slug]
    );
    if (!row) return null;
    const tenant = mapTenantRow(row as Record<string, any>);
    tenantCache.set(tenant.id, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });
    return tenant;
}

async function getTenantByStoreCode(storeCode: string): Promise<{ tenant: Tenant; storeId: string } | null> {
    const cached = storeCache.get(storeCode);
    if (cached && cached.expiresAt > Date.now()) {
        return { tenant: cached.tenant, storeId: cached.storeId };
    }

    const row = await DatabaseService.queryOne(
        `SELECT t.*, s.id AS store_id
         FROM stores s
         JOIN tenants t ON t.id = s.tenant_id
         WHERE s.store_code = $1
         LIMIT 1`,
        [storeCode]
    );

    if (!row) return null;

    const tenant = mapTenantRow(row as Record<string, any>);
    const storeId = (row as Record<string, any>).store_id as string;

    tenantCache.set(tenant.id, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });
    storeCache.set(storeCode, { tenant, storeId, expiresAt: Date.now() + CACHE_TTL_MS });

    return { tenant, storeId };
}

function extractTenantKey(req: Request): string | null {
    const params = req.params as Record<string, string | undefined>;
    const key = params.tenantKey || params.tenantId;
    if (key) return key;

    const headerTenant = req.headers['x-tenant-id'];
    if (typeof headerTenant === 'string' && headerTenant) {
        return headerTenant;
    }

    const host = req.headers.host || '';
    const subdomain = host.split('.')[0];
    if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
        return subdomain;
    }

    return null;
}

function extractStoreId(req: Request): string | null {
    const headerStore = req.headers['x-store-id'];
    if (typeof headerStore === 'string' && headerStore) {
        return headerStore;
    }

    const queryStore = req.query.storeId;
    if (typeof queryStore === 'string' && queryStore) {
        return queryStore;
    }

    return null;
}

export function resolveTenant(options: { required?: boolean; allowInactive?: boolean } = {}) {
    const { required = true, allowInactive = false } = options;

    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        const authenticatedReq = req as AuthenticatedRequest;

        try {
            const tenantKey = extractTenantKey(req);

            if (!tenantKey) {
                if (required) throw new TenantNotFoundError();
                return next();
            }

            let tenant: Tenant | null = null;
            let storeId: string | undefined;

            // 1) tenant id (UUID only)
            // Avoid "invalid input syntax for type uuid" when tenantKey is slug/store_code.
            if (isUuidLike(tenantKey)) {
                tenant = await getTenantById(tenantKey);
            }

            // 2) store_code
            if (!tenant) {
                const storeResult = await getTenantByStoreCode(tenantKey);
                if (storeResult) {
                    tenant = storeResult.tenant;
                    storeId = storeResult.storeId;
                }
            }

            // 3) slug
            if (!tenant) {
                tenant = await getTenantBySlug(tenantKey);
            }

            if (!tenant) {
                if (required) throw new TenantNotFoundError(tenantKey);
                return next();
            }

            // Active check
            if (!allowInactive && !['active', 'trial'].includes(tenant.status)) {
                throw new TenantInactiveError(tenant.id);
            }

            // Store ID from header/query has priority
            const requestedStoreId = extractStoreId(req);
            if (requestedStoreId) {
                const storeRow = await DatabaseService.queryOne(
                    'SELECT id FROM stores WHERE id = $1 AND tenant_id = $2',
                    [requestedStoreId, tenant.id],
                    tenant.id
                );
                if (!storeRow) {
                    throw new TenantNotFoundError(`store:${requestedStoreId}`);
                }
                storeId = requestedStoreId;
            }

            authenticatedReq.tenantId = tenant.id;
            if (storeId) authenticatedReq.storeId = storeId;

            if (authenticatedReq.user) {
                authenticatedReq.user.tenantId = tenant.id;
            }

            logger.debug(`Resolved tenant: ${tenant.name} (${tenant.id})`);
            next();
        } catch (error) {
            next(error);
        }
    };
}

export function clearTenantCache(tenantId?: string): void {
    if (tenantId) {
        tenantCache.delete(tenantId);
    } else {
        tenantCache.clear();
        storeCache.clear();
    }
}

export function getTenantId(req: Request): string {
    const authenticatedReq = req as AuthenticatedRequest;
    if (!authenticatedReq.tenantId) {
        throw new TenantNotFoundError();
    }
    return authenticatedReq.tenantId;
}

export function getStoreId(req: Request): string | null {
    const authenticatedReq = req as AuthenticatedRequest;
    return authenticatedReq.storeId || null;
}

export function getTenant(req: Request): Tenant {
    const authenticatedReq = req as AuthenticatedRequest;
    const tenantId = authenticatedReq.tenantId;

    if (!tenantId) {
        throw new TenantNotFoundError();
    }

    const cached = tenantCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.tenant;
    }

    throw new TenantNotFoundError(tenantId);
}
