/**
 * API Client
 * Backend API呼び出し用のヘルパー
 */

import { getIdToken } from './firebase';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID || 'default';

interface FetchOptions extends RequestInit {
    includeAuth?: boolean;
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

    const url = `${API_BASE_URL}/api/v1/${TENANT_ID}${endpoint}`;
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
    startOAuth: () =>
        apiClient<{ authUrl: string }>('/admin/integrations/google-calendar/oauth/start', {
            method: 'POST',
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
};
