/**
 * API Client
 * Backend API呼び出し用のヘルパー
 */

import { getIdToken } from './firebase';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const TENANT_ID_FALLBACK = process.env.NEXT_PUBLIC_TENANT_ID || 'default';
const TENANT_STORAGE_KEY = 'reservation_admin_tenant_key';
const STORE_STORAGE_KEY = 'reservation_admin_store_id';
export const STORE_CHANGED_EVENT = 'reserve:store-changed';
export const TENANT_CHANGED_EVENT = 'reserve:tenant-changed';

interface FetchOptions extends RequestInit {
    includeAuth?: boolean;
}

function isTenantKeyValid(value: string): boolean {
    return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(value);
}

function isStoreIdValid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readTenantKeyFromUrl(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }
    const params = new URLSearchParams(window.location.search);
    const key = params.get('tenant') || params.get('tenantKey');
    if (key && isTenantKeyValid(key)) {
        return key;
    }
    return null;
}

function readTenantKeyFromPath(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    const match = window.location.pathname.match(/^\/(?:t|tenant)\/([a-z0-9-]+)(?:\/|$)/i);
    const key = match?.[1]?.toLowerCase();
    if (key && isTenantKeyValid(key)) {
        return key;
    }
    return null;
}

function readTenantKeyFromStorage(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }
    const value = window.localStorage.getItem(TENANT_STORAGE_KEY);
    if (!value || !isTenantKeyValid(value)) {
        return null;
    }
    return value;
}

function normalizeTenantUrl(path: string, tenantKey: string): string {
    if (!tenantKey || !isTenantKeyValid(tenantKey)) {
        return path;
    }

    const [pathAndQuery, hash = ""] = path.split("#", 2);
    const [pathname, query = ""] = pathAndQuery.split("?", 2);
    const params = new URLSearchParams(query);
    params.set("tenant", tenantKey);
    params.delete("tenantKey");
    const nextQuery = params.toString();
    return `${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
}

function resolveTenantKey(): string | null {
    return readTenantKeyFromUrl()
        || readTenantKeyFromPath()
        || readTenantKeyFromStorage()
        || null;
}

export function withTenantQuery(path: string, tenantKey?: string): string {
    const resolvedTenant = tenantKey && isTenantKeyValid(tenantKey)
        ? tenantKey
        : resolveTenantKey();
    if (!resolvedTenant) {
        return path;
    }
    return normalizeTenantUrl(path, resolvedTenant);
}

export function syncTenantQueryInCurrentUrl(tenantKey: string): void {
    if (typeof window === "undefined") {
        return;
    }
    if (!isTenantKeyValid(tenantKey)) {
        return;
    }
    const nextUrl = normalizeTenantUrl(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
        tenantKey
    );
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
        window.history.replaceState({}, "", nextUrl);
    }
}

export function setTenantKey(tenantKey: string): void {
    if (typeof window === 'undefined') {
        return;
    }
    if (!isTenantKeyValid(tenantKey)) {
        throw new Error('Invalid tenant key');
    }
    window.localStorage.setItem(TENANT_STORAGE_KEY, tenantKey);
    window.dispatchEvent(new CustomEvent(TENANT_CHANGED_EVENT, { detail: { tenantKey } }));
}

export function setActiveStoreId(storeId: string | null): void {
    if (typeof window === 'undefined') {
        return;
    }
    if (!storeId) {
        window.localStorage.removeItem(STORE_STORAGE_KEY);
        window.dispatchEvent(new CustomEvent(STORE_CHANGED_EVENT, { detail: { storeId: null } }));
        return;
    }
    if (!isStoreIdValid(storeId)) {
        throw new Error('Invalid store id');
    }
    window.localStorage.setItem(STORE_STORAGE_KEY, storeId);
    window.dispatchEvent(new CustomEvent(STORE_CHANGED_EVENT, { detail: { storeId } }));
}

export function getActiveStoreId(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }
    const value = window.localStorage.getItem(STORE_STORAGE_KEY);
    if (!value || !isStoreIdValid(value)) {
        return null;
    }
    return value;
}

export function getTenantKey(): string {
    const resolvedTenant = resolveTenantKey();
    if (resolvedTenant) {
        setTenantKey(resolvedTenant);
        return resolvedTenant;
    }

    return TENANT_ID_FALLBACK;
}

export function getTenantKeyOrNull(): string | null {
    const resolvedTenant = resolveTenantKey();
    if (resolvedTenant) {
        setTenantKey(resolvedTenant);
        return resolvedTenant;
    }
    return null;
}

function getTenantApiUrl(endpoint: string): string {
    return `${API_BASE_URL}/api/v1/${getTenantKey()}${endpoint}`;
}

function getPlatformApiUrl(endpoint: string): string {
    return `${API_BASE_URL}/api/platform/v1${endpoint}`;
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        query.set(key, String(value));
    }
    const text = query.toString();
    return text ? `?${text}` : '';
}

/**
 * 認証付きAPIリクエスト
 */
export async function apiClient<T = unknown>(
    endpoint: string,
    options: FetchOptions = {}
): Promise<{ success: boolean; data?: T; error?: { code: string; message: string }; meta?: any }> {
    const { includeAuth = true, ...fetchOptions } = options;

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
    };

    if (includeAuth) {
        const token = await getIdToken();
        if (token) {
            (headers as Record<string, string>).Authorization = `Bearer ${token}`;
        }
    }

    const url = getTenantApiUrl(endpoint);
    const activeStoreId = getActiveStoreId();

    const executeRequest = async (storeId: string | null) => {
        const requestHeaders: HeadersInit = {
            ...(headers as Record<string, string>),
        };
        if (storeId) {
            (requestHeaders as Record<string, string>)['x-store-id'] = storeId;
        }

        const response = await fetch(url, {
            ...fetchOptions,
            headers: requestHeaders,
        });

        const text = await response.text();
        let json: any = {};
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            json = {};
        }

        return { response, json };
    };

    let { response, json } = await executeRequest(activeStoreId);

    const isTenantNotFound = json?.error?.code === 'TENANT_NOT_FOUND';
    const errorMessage = typeof json?.error?.message === 'string' ? json.error.message : '';
    const isStoreScopeForbidden =
        json?.error?.code === 'AUTHORIZATION_ERROR'
        && errorMessage.includes('店舗');

    // If the stored storeId becomes invalid (e.g. deleted store / tenant switch), retry once without store scope.
    if (!response.ok && activeStoreId && (isTenantNotFound || isStoreScopeForbidden)) {
        setActiveStoreId(null);
        ({ response, json } = await executeRequest(null));
    }

    if (!response.ok) {
        return {
            success: false,
            error: json.error || { code: 'UNKNOWN_ERROR', message: `HTTP ${response.status}` },
        };
    }

    return {
        success: true,
        // Some endpoints (jobs/*) return { success, stats } instead of ApiResponse { data }.
        // Keep compatibility by treating the raw payload as data when "data" is missing.
        data: json.data !== undefined ? json.data : (json.stats !== undefined ? json : undefined),
        meta: json.meta ?? json.pagination,
    };
}

export async function platformApiClient<T = unknown>(
    endpoint: string,
    options: FetchOptions = {}
): Promise<{ success: boolean; data?: T; error?: { code: string; message: string }; meta?: any }> {
    const { includeAuth = true, ...fetchOptions } = options;

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
    };

    if (includeAuth) {
        const token = await getIdToken();
        if (token) {
            (headers as Record<string, string>).Authorization = `Bearer ${token}`;
        }
    }

    const url = getPlatformApiUrl(endpoint);
    const response = await fetch(url, {
        ...fetchOptions,
        headers,
    });

    const text = await response.text();
    let json: any = {};
    try {
        json = text ? JSON.parse(text) : {};
    } catch {
        json = {};
    }

    if (!response.ok) {
        return {
            success: false,
            error: json.error || { code: 'UNKNOWN_ERROR', message: `HTTP ${response.status}` },
        };
    }

    return {
        success: true,
        // Some endpoints (jobs/*) return { success, stats } instead of ApiResponse { data }.
        // Keep compatibility by treating the raw payload as data when "data" is missing.
        data: json.data !== undefined ? json.data : (json.stats !== undefined ? json : undefined),
        meta: json.meta ?? json.pagination,
    };
}

export type AdminContextRole = 'owner' | 'admin' | 'manager' | 'staff';
export type AdminContextTenant = {
    tenantKey: string;
    tenantId: string;
    tenantName: string;
    adminRole: AdminContextRole;
    storeIds: string[];
};

export type AdminContextData = {
    tenantKey: string;
    tenantId: string;
    adminRole: AdminContextRole;
    storeIds: string[];
    availableTenants: AdminContextTenant[];
};

let adminContextSyncPromise: Promise<AdminContextData | null> | null = null;

// ============================================
// 予約 API
// ============================================

export const reservationsApi = {
    list: (params?: {
        page?: number;
        limit?: number;
        status?: string;
        practitionerId?: string;
        customerId?: string;
        date?: string;
        dateFrom?: string;
        dateTo?: string;
    }) => apiClient(`/admin/reservations${buildQuery(params || {})}`),
    get: (id: string) => apiClient(`/admin/reservations/${id}`),
    getToday: () => apiClient('/admin/reservations/today'),
    createAdmin: (data: Record<string, unknown>) =>
        apiClient('/admin/reservations', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: Record<string, unknown>) =>
        apiClient(`/admin/reservations/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    updateStatus: (id: string, status: string, reason?: string) =>
        apiClient(`/admin/reservations/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status, reason }),
        }),
};

// ============================================
// 顧客 API
// ============================================

export const customersApi = {
    list: (params?: { page?: number; limit?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' }) =>
        apiClient(`/admin/customers${buildQuery(params || {})}`),
    get: (id: string) => apiClient(`/admin/customers/${id}`),
    update: (id: string, data: Record<string, unknown>) =>
        apiClient(`/admin/customers/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    getReservations: (id: string) => apiClient(`/admin/customers/${id}/reservations`),
};

// ============================================
// 施術者 API
// ============================================

export const practitionersApi = {
    list: () => apiClient('/admin/practitioners'),
    listAll: () => apiClient('/admin/practitioners'),
    get: (id: string) => apiClient(`/practitioners/${id}`, { includeAuth: false }),
    create: (data: Record<string, unknown>) =>
        apiClient('/admin/practitioners', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: Record<string, unknown>) =>
        apiClient(`/admin/practitioners/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    delete: (id: string) =>
        apiClient(`/admin/practitioners/${id}`, { method: 'DELETE' }),
    reorder: (orders: Array<{ id: string; displayOrder: number }>) =>
        apiClient('/admin/practitioners/reorder', {
            method: 'POST',
            body: JSON.stringify({ orders }),
        }),
};

// ============================================
// メニュー API
// ============================================

export const menusApi = {
    list: () => apiClient('/admin/menus'),
    listAll: () => apiClient('/admin/menus'),
    listPublic: () => apiClient('/menus', { includeAuth: false }),
    get: (id: string) => apiClient(`/menus/${id}`, { includeAuth: false }),
    create: (data: Record<string, unknown>) =>
        apiClient('/admin/menus', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: Record<string, unknown>) =>
        apiClient(`/admin/menus/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    delete: (id: string) =>
        apiClient(`/admin/menus/${id}`, { method: 'DELETE' }),
    reorder: (orders: Array<{ id: string; displayOrder: number }>) =>
        apiClient('/admin/menus/reorder', {
            method: 'POST',
            body: JSON.stringify({ orders }),
        }),
};

// ============================================
// オプション API
// ============================================

export const optionsApi = {
    list: () => apiClient('/admin/options'),
    listPublic: (menuId?: string) => apiClient(`/options${buildQuery({ menuId })}`, { includeAuth: false }),
    create: (data: Record<string, unknown>) =>
        apiClient('/admin/options', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: Record<string, unknown>) =>
        apiClient(`/admin/options/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    delete: (id: string) =>
        apiClient(`/admin/options/${id}`, { method: 'DELETE' }),
};

// ============================================
// 店舗 API
// ============================================

export const storesApi = {
    list: () => apiClient('/admin/stores'),
    create: (data: Record<string, unknown>) =>
        apiClient('/admin/stores', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: Record<string, unknown>) =>
        apiClient(`/admin/stores/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    delete: (id: string) => apiClient(`/admin/stores/${id}`, { method: 'DELETE' }),
};

// ============================================
// カルテ API
// ============================================

export const kartesApi = {
    list: (params?: { customerId?: string; practitionerId?: string; dateFrom?: string; dateTo?: string; limit?: number }) =>
        apiClient(`/admin/kartes${buildQuery(params || {})}`),
    create: (data: Record<string, unknown>) =>
        apiClient('/admin/kartes', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: Record<string, unknown>) =>
        apiClient(`/admin/kartes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    delete: (id: string) => apiClient(`/admin/kartes/${id}`, { method: 'DELETE' }),
};

export const karteTemplatesApi = {
    list: () => apiClient('/admin/karte-templates'),
    create: (data: Record<string, unknown>) =>
        apiClient('/admin/karte-templates', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: Record<string, unknown>) =>
        apiClient(`/admin/karte-templates/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    delete: (id: string) => apiClient(`/admin/karte-templates/${id}`, { method: 'DELETE' }),
};

// ============================================
// Google Calendar 連携 API
// ============================================

export const googleCalendarApi = {
    getStatus: () => apiClient('/admin/integrations/google-calendar'),
    revoke: () =>
        apiClient('/admin/integrations/google-calendar', {
            method: 'PUT',
            body: JSON.stringify({ status: 'revoked' }),
        }),
    startOAuth: (redirectTo?: string) =>
        apiClient<{ authUrl: string }>('/admin/integrations/google-calendar/oauth/start', {
            method: 'POST',
            body: JSON.stringify(redirectTo ? { redirectTo } : {}),
        }),
};

// ============================================
// 設定 API
// ============================================

export const settingsApi = {
    get: () => apiClient('/admin/settings'),
    updateProfile: (data: Record<string, unknown>) =>
        apiClient('/admin/settings/profile', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    updateBusiness: (data: Record<string, unknown>) =>
        apiClient('/admin/settings/business', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    updateLine: (data: Record<string, unknown>) =>
        apiClient('/admin/settings/line', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    resolveLinePreview: (params?: { storeId?: string; practitionerId?: string }) =>
        apiClient('/admin/settings/line/resolve-preview' + buildQuery(params || {})),
};

// ============================================
// 予約URLトークン API
// ============================================

export const bookingLinksApi = {
    list: (params?: {
        status?: 'active' | 'revoked';
        practitionerId?: string;
        limit?: number;
    }) =>
        apiClient('/admin/booking-links' + buildQuery(params || {})),
    create: (data: {
        practitionerId: string;
        storeId?: string;
        expiresAt?: string;
        reissue?: boolean;
    }) =>
        apiClient('/admin/booking-links', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    revoke: (id: string) =>
        apiClient(`/admin/booking-links/${id}`, {
            method: 'DELETE',
        }),
};

// ============================================
// ダッシュボード API
// ============================================

export const dashboardApi = {
    getKpi: () => apiClient('/admin/dashboard/kpi'),
    getToday: () => apiClient('/admin/dashboard/today'),
    getStaffUtilization: () => apiClient('/admin/dashboard/staff-utilization'),
    getWeeklySummary: () => apiClient('/admin/dashboard/weekly-summary'),
    getActivity: (limit?: number) =>
        apiClient(`/admin/dashboard/activity${buildQuery({ limit })}`),
};

// ============================================
// レポート API
// ============================================

export const reportsApi = {
    getSummary: (period?: string) =>
        apiClient(`/admin/reports/summary${buildQuery({ period })}`),
    getRevenue: (startDate?: string, endDate?: string) =>
        apiClient(`/admin/reports/revenue${buildQuery({ startDate, endDate })}`),
    getMenuRanking: (period?: string) =>
        apiClient(`/admin/reports/menu-ranking${buildQuery({ period })}`),
    getPractitionerRevenue: (period?: string) =>
        apiClient(`/admin/reports/practitioner-revenue${buildQuery({ period })}`),
};

// ============================================
// 管理ジョブ API
// ============================================

export const adminJobsApi = {
    runDayBeforeReminder: () =>
        apiClient('/admin/jobs/reminders/day-before', {
            method: 'POST',
        }),
    runSameDayReminder: () =>
        apiClient('/admin/jobs/reminders/same-day', {
            method: 'POST',
        }),
    runDailyAnalytics: (date?: string) =>
        apiClient('/admin/jobs/analytics/daily', {
            method: 'POST',
            body: JSON.stringify(date ? { date } : {}),
        }),
    runGoogleCalendarSync: (limit?: number) =>
        apiClient('/admin/jobs/integrations/google-calendar/sync', {
            method: 'POST',
            body: JSON.stringify(limit ? { limit } : {}),
        }),
    runGoogleCalendarRetry: (limit?: number, includeFailed = false) =>
        apiClient('/admin/jobs/integrations/google-calendar/retry', {
            method: 'POST',
            body: JSON.stringify({
                ...(limit ? { limit } : {}),
                includeFailed,
            }),
        }),
};

// ============================================
// オンボーディング API
// ============================================

export const onboardingApi = {
    getStatus: () => apiClient<{
        onboardingStatus: 'pending' | 'in_progress' | 'completed';
        completed: boolean;
        onboardingCompletedAt?: string;
        onboardingPayload?: Record<string, unknown>;
    }>('/admin/onboarding/status'),
    updateStatus: (data: {
        status?: 'pending' | 'in_progress' | 'completed';
        onboardingPayload?: Record<string, unknown>;
        applySetup?: boolean;
        applySetupPayload?: Record<string, unknown>;
    }) =>
        apiClient('/admin/onboarding/status', {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),
};

// ============================================
// 公開セルフ登録 API
// ============================================

export const platformOnboardingApi = {
    getRegistrationConfig: () =>
        platformApiClient<{
            enabled: boolean;
            tenantKeyPolicy?: 'auto_generated';
            supportsManualTenantKey?: boolean;
        }>('/onboarding/registration-config', {
            includeAuth: false,
        }),
    registerTenant: (data: {
        idToken: string;
        tenantName: string;
        ownerName?: string;
        storeName?: string;
        timezone?: string;
        address?: string;
        phone?: string;
    }) =>
        platformApiClient<{
            tenantId: string;
            tenantKey: string;
            storeId: string;
            adminId: string;
        }>('/onboarding/register', {
            method: 'POST',
            includeAuth: false,
            body: JSON.stringify(data),
        }),
};

// ============================================
// 管理コンテキスト API
// ============================================

export const adminContextApi = {
    get: (tenantKey?: string) =>
        platformApiClient<AdminContextData>('/admin/context' + buildQuery({ tenantKey })),
    sync: async (tenantKey?: string): Promise<AdminContextData | null> => {
        if (typeof window === 'undefined') {
            return null;
        }

        if (!adminContextSyncPromise) {
            adminContextSyncPromise = (async () => {
                const requestedTenantKey = tenantKey && isTenantKeyValid(tenantKey)
                    ? tenantKey
                    : resolveTenantKey() ?? undefined;

                const tryResolveContext = async (key?: string): Promise<AdminContextData | null> => {
                    const response = await adminContextApi.get(key);
                    if (!response.success || !response.data) {
                        return null;
                    }
                    return response.data;
                };

                let context = await tryResolveContext(requestedTenantKey);
                if (!context && requestedTenantKey) {
                    // URL/localStorage mismatch recovery: resolve to an accessible tenant.
                    context = await tryResolveContext(undefined);
                }
                if (!context) {
                    return null;
                }

                if (isTenantKeyValid(context.tenantKey)) {
                    setTenantKey(context.tenantKey);
                    syncTenantQueryInCurrentUrl(context.tenantKey);
                }

                const validStoreIds = (context.storeIds || []).filter((id) => isStoreIdValid(id));
                const currentStoreId = getActiveStoreId();

                if (!currentStoreId || (validStoreIds.length > 0 && !validStoreIds.includes(currentStoreId))) {
                    setActiveStoreId(validStoreIds[0] || null);
                }

                if (!Array.isArray(context.availableTenants)) {
                    context.availableTenants = [{
                        tenantKey: context.tenantKey,
                        tenantId: context.tenantId,
                        tenantName: context.tenantKey,
                        adminRole: context.adminRole,
                        storeIds: validStoreIds,
                    }];
                }

                return context;
            })()
                .finally(() => {
                    adminContextSyncPromise = null;
                });
        }

        return adminContextSyncPromise;
    },
};
