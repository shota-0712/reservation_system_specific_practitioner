import type { PoolClient } from 'pg';
import { DatabaseService } from '../config/database.js';
import { ConflictError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const STORE_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const STORE_CODE_LENGTH = 8;
const SLUG_MIN_LENGTH = 3;
const SLUG_MAX_LENGTH = 40;
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

interface RegistrationInput {
    firebaseUid: string;
    email: string;
    ownerName: string;
    tenantName: string;
    storeName: string;
    timezone: string;
    phone?: string;
    address?: string;
}

export interface RegistrationResult {
    tenantId: string;
    tenantSlug: string;
    storeId: string;
    adminId: string;
}

interface TenantInsertRow {
    id: string;
    slug: string;
}

interface StoreInsertRow {
    id: string;
}

interface AdminInsertRow {
    id: string;
}

function normalizeSlug(slug: string): string {
    return slug.trim().toLowerCase();
}

function validateSlug(slug: string): void {
    if (!SLUG_REGEX.test(slug)) {
        throw new ValidationError('slug は英小文字・数字・ハイフンのみ、3〜40文字で指定してください');
    }
}

function deriveSlugBase(tenantName: string): string {
    const normalized = tenantName
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    const base = normalized || 'salon';
    const trimmed = base.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '');
    if (trimmed.length >= SLUG_MIN_LENGTH) {
        return trimmed;
    }

    return 'salon';
}

function buildSlugCandidate(base: string, attempt: number): string {
    if (attempt === 0) {
        return base;
    }

    const suffix = `-${attempt}`;
    const maxBaseLength = Math.max(1, SLUG_MAX_LENGTH - suffix.length);
    let candidateBase = base.slice(0, maxBaseLength).replace(/-+$/g, '');
    if (candidateBase.length === 0) {
        candidateBase = 'salon'.slice(0, maxBaseLength);
    }

    return `${candidateBase}${suffix}`;
}

function buildDefaultPermissions() {
    return {
        canManageReservations: true,
        canViewReports: true,
        canManageCustomers: true,
        canManagePractitioners: true,
        canManageMenus: true,
        canManageSettings: true,
        canManageAdmins: true,
    };
}

function randomStoreCode(): string {
    let code = '';
    for (let i = 0; i < STORE_CODE_LENGTH; i += 1) {
        const index = Math.floor(Math.random() * STORE_CODE_ALPHABET.length);
        code += STORE_CODE_ALPHABET[index];
    }
    return code;
}

async function generateUniqueStoreCode(client: PoolClient): Promise<string> {
    for (let attempts = 0; attempts < 30; attempts += 1) {
        const code = randomStoreCode();
        const exists = await client.query<{ id: string }>(
            'SELECT id FROM stores WHERE store_code = $1 LIMIT 1',
            [code]
        );
        if (exists.rowCount === 0) {
            return code;
        }
    }

    throw new Error('店舗コード生成に失敗しました');
}

async function generateUniqueTenantSlug(client: PoolClient, tenantName: string): Promise<string> {
    const base = deriveSlugBase(tenantName);

    for (let attempts = 0; attempts < 1000; attempts += 1) {
        const candidate = buildSlugCandidate(base, attempts);
        if (candidate.length < SLUG_MIN_LENGTH || candidate.length > SLUG_MAX_LENGTH) {
            continue;
        }

        validateSlug(candidate);

        const exists = await client.query<{ id: string }>(
            'SELECT id FROM tenants WHERE slug = $1 LIMIT 1',
            [candidate]
        );
        if ((exists.rowCount ?? 0) === 0) {
            return candidate;
        }
    }

    throw new Error('テナント識別子の生成に失敗しました');
}

export class OnboardingService {
    async isSlugAvailable(slug: string): Promise<boolean> {
        const normalized = normalizeSlug(slug);
        validateSlug(normalized);

        const row = await DatabaseService.queryOne<{ id: string }>(
            'SELECT id FROM tenants WHERE slug = $1 LIMIT 1',
            [normalized]
        );
        return !row;
    }

    async register(input: RegistrationInput): Promise<RegistrationResult> {
        const payload = {
            registeredAt: new Date().toISOString(),
            ownerName: input.ownerName,
            ownerEmail: input.email,
            storeName: input.storeName,
            timezone: input.timezone,
        };

        try {
            return await DatabaseService.transaction<RegistrationResult>(async (client) => {
                const adminExists = await client.query<{ id: string }>(
                    'SELECT id FROM admins WHERE firebase_uid = $1 LIMIT 1',
                    [input.firebaseUid]
                );
                if ((adminExists.rowCount ?? 0) > 0) {
                    throw new ConflictError('このFirebaseユーザーは既に管理者登録されています');
                }

                const generatedSlug = await generateUniqueTenantSlug(client, input.tenantName);

                const tenantInsert = await client.query<TenantInsertRow>(
                    `INSERT INTO tenants (
                        slug,
                        name,
                        plan,
                        status,
                        onboarding_status,
                        onboarding_payload
                    )
                    VALUES ($1, $2, 'trial', 'active', 'pending', $3::jsonb)
                    RETURNING id, slug`,
                    [generatedSlug, input.tenantName, JSON.stringify(payload)]
                );

                const tenant = tenantInsert.rows[0];
                if (!tenant) {
                    throw new Error('テナント作成に失敗しました');
                }

                await client.query('SELECT set_tenant($1)', [tenant.id]);
                const storeCode = await generateUniqueStoreCode(client);

                const storeInsert = await client.query<StoreInsertRow>(
                    `INSERT INTO stores (
                        tenant_id,
                        store_code,
                        name,
                        address,
                        phone,
                        timezone,
                        status,
                        display_order
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, 'active', 0)
                    RETURNING id`,
                    [
                        tenant.id,
                        storeCode,
                        input.storeName,
                        input.address ?? null,
                        input.phone ?? null,
                        input.timezone,
                    ]
                );

                const store = storeInsert.rows[0];
                if (!store) {
                    throw new Error('店舗作成に失敗しました');
                }

                const adminInsert = await client.query<AdminInsertRow>(
                    `INSERT INTO admins (
                        tenant_id,
                        firebase_uid,
                        email,
                        name,
                        role,
                        permissions,
                        is_active,
                        store_ids
                    )
                    VALUES ($1, $2, $3, $4, 'owner', $5::jsonb, true, ARRAY[$6]::uuid[])
                    RETURNING id`,
                    [
                        tenant.id,
                        input.firebaseUid,
                        input.email,
                        input.ownerName,
                        JSON.stringify(buildDefaultPermissions()),
                        store.id,
                    ]
                );

                const admin = adminInsert.rows[0];
                if (!admin) {
                    throw new Error('管理者作成に失敗しました');
                }

                return {
                    tenantId: tenant.id,
                    tenantSlug: tenant.slug,
                    storeId: store.id,
                    adminId: admin.id,
                };
            });
        } catch (error) {
            const typed = error as { code?: string };
            if (typed.code === '23505') {
                throw new ConflictError('初期登録が競合しました。再度お試しください');
            }

            logger.error('Onboarding register failed', {
                tenantName: input.tenantName,
                firebaseUid: input.firebaseUid,
                error,
            });
            throw error;
        }
    }
}

export function createOnboardingService(): OnboardingService {
    return new OnboardingService();
}
