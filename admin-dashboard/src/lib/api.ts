/**
 * API Client
 * Backend API呼び出し用のヘルパー
 */

import { getIdToken } from './firebase';
import type {
    CreateAdminReservationRequest,
    UpdateAdminReservationRequest,
    UpdateCustomerRequest,
    CreatePractitionerRequest,
    UpdatePractitionerRequest,
    CreateMenuRequest,
    UpdateMenuRequest,
    CreateOptionRequest,
    UpdateOptionRequest,
    CreateStoreRequest,
    UpdateStoreRequest,
    CreateKarteRequest,
    UpdateKarteRequest,
    CreateKarteTemplateRequest,
    UpdateKarteTemplateRequest,
    UpdateProfileRequest,
    UpdateBusinessRequest,
    UpdateLineRequest,
    UpdateNotificationSettingsRequest,
} from '@/types/api-request-types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const STORE_STORAGE_KEY = 'reservation_admin_store_id';
export const STORE_CHANGED_EVENT = 'reserve:store-changed';
export const STORES_UPDATED_EVENT = 'reserve:stores-updated';

interface FetchOptions extends RequestInit {
    includeAuth?: boolean;
}

function isStoreIdValid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function setActiveStoreId(storeId: string | null): void {
    if (typeof window === 'undefined') {
        return;
    }
    if (!storeId) {
        const currentStoreId = window.localStorage.getItem(STORE_STORAGE_KEY);
        if (!currentStoreId) {
            return;
        }
        window.localStorage.removeItem(STORE_STORAGE_KEY);
        window.dispatchEvent(new CustomEvent(STORE_CHANGED_EVENT, { detail: { storeId: null } }));
        return;
    }
    if (!isStoreIdValid(storeId)) {
        throw new Error('Invalid store id');
    }
    const currentStoreId = window.localStorage.getItem(STORE_STORAGE_KEY);
    if (currentStoreId === storeId) {
        return;
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

function getAdminApiUrl(endpoint: string): string {
    // Normalize: strip leading /admin to avoid /api/v1/admin/admin/... double prefix
    const path = endpoint.startsWith('/admin') ? endpoint.slice(6) : endpoint;
    return `${API_BASE_URL}/api/v1/admin${path}`;
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
 * 認証付きAPIリクエスト（管理者用 /api/v1/admin/... に向く）
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

    const url = getAdminApiUrl(endpoint);
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

    const errorMessage = typeof json?.error?.message === 'string' ? json.error.message : '';
    const isStoreScopeForbidden =
        json?.error?.code === 'AUTHORIZATION_ERROR'
        && errorMessage.includes('店舗');

    // If the stored storeId becomes invalid (e.g. deleted store), retry once without store scope.
    if (!response.ok && activeStoreId && isStoreScopeForbidden) {
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
    createAdmin: (data: CreateAdminReservationRequest) =>
        apiClient('/admin/reservations', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: UpdateAdminReservationRequest) =>
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
    update: (id: string, data: UpdateCustomerRequest) =>
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
    get: (id: string) => apiClient(`/admin/practitioners/${id}`),
    create: (data: CreatePractitionerRequest) =>
        apiClient('/admin/practitioners', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: UpdatePractitionerRequest) =>
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
    listPublic: () => apiClient('/admin/menus'),
    get: (id: string) => apiClient(`/admin/menus/${id}`),
    create: (data: CreateMenuRequest) =>
        apiClient('/admin/menus', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: UpdateMenuRequest) =>
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
    listPublic: (menuId?: string) => apiClient(`/admin/options${buildQuery({ menuId })}`),
    create: (data: CreateOptionRequest) =>
        apiClient('/admin/options', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: UpdateOptionRequest) =>
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
    create: (data: CreateStoreRequest) =>
        apiClient('/admin/stores', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: UpdateStoreRequest) =>
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
    create: (data: CreateKarteRequest) =>
        apiClient('/admin/kartes', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: UpdateKarteRequest) =>
        apiClient(`/admin/kartes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    delete: (id: string) => apiClient(`/admin/kartes/${id}`, { method: 'DELETE' }),
};

export const karteTemplatesApi = {
    list: () => apiClient('/admin/karte-templates'),
    create: (data: CreateKarteTemplateRequest) =>
        apiClient('/admin/karte-templates', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: UpdateKarteTemplateRequest) =>
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

export type RfmScoreThresholds = {
    score5: number;
    score4: number;
    score3: number;
    score2: number;
};

export type RfmThresholdSettings = {
    recency: RfmScoreThresholds;
    frequency: RfmScoreThresholds;
    monetary: RfmScoreThresholds;
};

export type RfmRecalculateResult = {
    processed: number;
    updated: number;
    unchanged: number;
};

export type NotificationSettings = {
    emailNewReservation: boolean;
    emailCancellation: boolean;
    emailDailyReport: boolean;
    lineReminder: boolean;
    lineConfirmation: boolean;
    lineReview: boolean;
    pushNewReservation: boolean;
    pushCancellation: boolean;
    updatedAt?: string;
    updatedBy?: string;
};

export const settingsApi = {
    get: () => apiClient('/admin/settings'),
    getNotifications: () => apiClient<NotificationSettings>('/admin/settings/notifications'),
    updateProfile: (data: UpdateProfileRequest) =>
        apiClient('/admin/settings/profile', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    updateBusiness: (data: UpdateBusinessRequest) =>
        apiClient('/admin/settings/business', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    updateLine: (data: UpdateLineRequest) =>
        apiClient('/admin/settings/line', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    updateNotifications: (data: UpdateNotificationSettingsRequest) =>
        apiClient<NotificationSettings>('/admin/settings/notifications', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    resolveLinePreview: (params?: { storeId?: string; practitionerId?: string }) =>
        apiClient('/admin/settings/line/resolve-preview' + buildQuery(params || {})),
};

export const rfmSettingsApi = {
    get: () => apiClient<RfmThresholdSettings>('/admin/settings/rfm-thresholds'),
    update: (payload: RfmThresholdSettings) =>
        apiClient<RfmThresholdSettings>('/admin/settings/rfm-thresholds', {
            method: 'PUT',
            body: JSON.stringify(payload),
        }),
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
// CSV Export API
// ============================================

export const exportsApi = {
    create: (data: {
        exportType:
            | 'operations_reservations'
            | 'operations_customers'
            | 'analytics_store_daily_kpi'
            | 'analytics_menu_performance';
        storeId?: string;
        format?: 'csv';
        params?: Record<string, unknown>;
    }) =>
        apiClient('/admin/exports', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    list: (params?: { page?: number; limit?: number }) =>
        apiClient(`/admin/exports${buildQuery(params || {})}`),
    get: (id: string) =>
        apiClient(`/admin/exports/${id}`),
    downloadUrl: (id: string) => `${API_BASE_URL}/api/v1/admin/exports/${id}/download`,
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
    runRfmRecalculate: () =>
        apiClient<RfmRecalculateResult>('/admin/jobs/customers/rfm/recalculate', {
            method: 'POST',
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

export const platformAdminApi = {
    syncClaims: () =>
        platformApiClient<{ tenantId: string }>('/admin/claims/sync', { method: 'POST' }),
};

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
    get: () =>
        platformApiClient<AdminContextData>('/admin/context'),
    sync: async (): Promise<AdminContextData | null> => {
        if (typeof window === 'undefined') {
            return null;
        }

        if (!adminContextSyncPromise) {
            adminContextSyncPromise = (async () => {
                const response = await adminContextApi.get();
                if (!response.success || !response.data) {
                    return null;
                }

                const context = response.data;
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
