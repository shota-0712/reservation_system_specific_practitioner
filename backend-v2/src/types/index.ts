/**
 * Core Type Definitions for Multi-tenant Reservation System
 * Based on: docs/architecture/MULTI_TENANT_ARCHITECTURE.md
 */

export type Timestamp = Date;

// ============================================
// Base Types
// ============================================

export interface BaseEntity {
    id: string;
    tenantId: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export type ReservationStatus =
    | 'pending'      // 仮予約
    | 'confirmed'    // 確定
    | 'completed'    // 来店済み
    | 'canceled'     // キャンセル
    | 'no_show';     // 無断キャンセル

export type ReservationSource =
    | 'line'         // LINEミニアプリ
    | 'admin'        // 管理画面（代理予約）
    | 'hotpepper'    // ホットペッパー経由
    | 'phone'        // 電話予約
    | 'salonboard'   // サロンボード
    | 'walk_in'      // 来店
    | 'web'          // Web予約
    | 'google_calendar';

export type AdminRole =
    | 'owner'        // オーナー（全権限）
    | 'admin'        // 管理者
    | 'manager'      // マネージャー
    | 'staff';       // スタッフ

export type TenantOnboardingStatus =
    | 'pending'
    | 'in_progress'
    | 'completed';

// ============================================
// Tenant (企業)
// ============================================

export interface Tenant extends Omit<BaseEntity, 'tenantId'> {
    slug: string;
    name: string;
    plan: 'free' | 'trial' | 'basic' | 'pro' | 'enterprise';
    status: 'active' | 'trial' | 'suspended' | 'canceled';
    onboardingStatus?: TenantOnboardingStatus;
    onboardingCompletedAt?: Timestamp;
    onboardingPayload?: Record<string, unknown>;

    lineConfig?: {
        channelId?: string;
        channelSecret?: string;
        channelAccessToken?: string;
        liffId?: string;
    };

    branding?: {
        primaryColor?: string;
        logoUrl?: string;
        faviconUrl?: string;
    };

    stripeCustomerId?: string;
    subscriptionCurrentPeriodEnd?: Timestamp;
    maxStores?: number;
    maxPractitioners?: number;
}

export interface Store extends BaseEntity {
    storeCode: string;
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    timezone?: string;
    businessHours?: Record<string, { isOpen: boolean; openTime?: string; closeTime?: string }>;
    regularHolidays?: number[];
    temporaryHolidays?: string[];
    temporaryOpenDays?: string[];
    slotDuration?: number;
    advanceBookingDays?: number;
    cancelDeadlineHours?: number;
    requirePhone?: boolean;
    requireEmail?: boolean;
    status?: 'active' | 'inactive';
    displayOrder?: number;
}

export interface BusinessHour {
    dayOfWeek: number;           // 0=日曜, 1=月曜, ...
    isOpen: boolean;
    openTime: string;            // HH:mm
    closeTime: string;           // HH:mm
}

// ============================================
// Practitioner (施術者)
// ============================================

export interface Practitioner extends BaseEntity {
    name: string;
    nameKana?: string;
    role: 'stylist' | 'assistant' | 'owner';
    phone?: string;
    email?: string;
    imageUrl?: string;
    color: string;               // カレンダー表示用カラー
    title?: string;
    description?: string;
    experience?: string;
    prTitle?: string;
    specialties?: string[];
    snsInstagram?: string;
    snsTwitter?: string;
    nominationFee?: number;
    storeIds?: string[];

    // 勤務設定
    schedule: {
        workDays: number[];        // 出勤曜日 [0,1,2,3,4,5,6]
        workHours: {
            start: string;           // HH:mm
            end: string;             // HH:mm
        };
        breakTime?: {
            start: string;
            end: string;
        };
        // 曜日別詳細設定（v2.3）
        dayConfigs?: Record<string, {
            isWorking: boolean;
            startTime?: string;
            endTime?: string;
            breakStartTime?: string;
            breakEndTime?: string;
        }>;
    };

    // 対応メニュー制限
    availableMenuIds?: string[]; // 空の場合は全メニュー対応

    // Google Calendar連携
    calendarId?: string;

    // SalonBoard連携
    salonboardStaffId?: string;

    displayOrder: number;
    isActive: boolean;
}

// ============================================
// Menu (メニュー)
// ============================================

export interface Menu extends BaseEntity {
    name: string;
    description?: string;
    category: string;
    duration: number;            // 分
    price: number;               // 円（税込）
    imageUrl?: string;

    // 対応施術者（空の場合は全員対応）
    availablePractitionerIds?: string[];

    displayOrder: number;
    isActive: boolean;
}

// ============================================
// Option (オプションメニュー)
// ============================================

export interface Option extends BaseEntity {
    name: string;
    description?: string;
    duration: number;            // 追加時間（分）
    price: number;               // 追加料金（円）

    // 適用可能なメニュー（空の場合は全メニュー）
    applicableMenuIds?: string[];

    displayOrder: number;
    isActive: boolean;
}

// ============================================
// Reservation (予約)
// ============================================

export interface Reservation extends BaseEntity {
    storeId?: string;
    customerId: string;
    customerName?: string;       // 非正規化（表示用）
    customerPhone?: string;      // 非正規化（連絡用）
    practitionerId: string;
    practitionerName: string;    // 非正規化（表示用）

    menuIds: string[];
    menuNames: string[];         // 非正規化
    optionIds: string[];
    optionNames: string[];       // 非正規化

    date: string;                // YYYY-MM-DD
    startTime: string;           // HH:mm
    endTime: string;             // HH:mm
    duration: number;            // 合計時間（分）

    totalPrice: number;
    subtotal?: number;
    optionTotal?: number;
    nominationFee?: number;
    discount?: number;
    status: ReservationStatus;
    source: ReservationSource;

    customerNote?: string;       // 顧客からの備考
    staffNote?: string;          // スタッフメモ

    // 外部連携
    googleCalendarId?: string;
    googleCalendarEventId?: string;
    salonboardReservationId?: string;
    hotpepperReservationId?: string;

    // キャンセル情報
    canceledAt?: Timestamp;
    cancelReason?: string;

    // リマインド履歴
    reminderSentAt?: Timestamp;

    // 内部ポリシー評価結果（APIレスポンスには含めない）
    policyValidationResult?: {
        checkedAt: Timestamp;
        timezone: string;
        advanceBookingPassed?: boolean;
        cancelDeadlinePassed?: boolean;
    };
}

// ============================================
// Customer (顧客)
// ============================================

export interface Customer extends BaseEntity {
    lineUserId?: string;
    lineDisplayName?: string;
    linePictureUrl?: string;

    // 基本情報
    name: string;
    nameKana?: string;
    phone?: string;
    email?: string;
    imageUrl?: string;
    birthDate?: string;          // YYYY-MM-DD
    gender?: 'male' | 'female' | 'other' | 'undisclosed';

    // 集計値
    totalVisits?: number;
    totalSpend?: number;
    averageSpend?: number;
    lastVisitAt?: string;
    firstVisitAt?: string;
    rfmSegment?: string;

    tags?: string[];
    memo?: string;

    notificationSettings?: {
        reminder?: boolean;
        marketing?: boolean;
    };

    lineNotificationToken?: string;
    lineNotificationTokenExpiresAt?: Timestamp;
    notificationToken?: string;  // deprecated alias
    lastAccessAt?: Timestamp;
    isActive: boolean;
}

// ============================================
// Admin (管理者)
// ============================================

export interface Admin extends BaseEntity {
    firebaseUid: string;         // Firebase Auth UID
    email: string;
    name: string;
    role: AdminRole;

    // 権限
    permissions: {
        canManageReservations: boolean;
        canManageCustomers: boolean;
        canManageMenus: boolean;
        canManagePractitioners: boolean;
        canManageSettings: boolean;
        canViewReports: boolean;
        canManageAdmins: boolean;
    };

    // 通知設定
    notificationSettings?: {
        emailNewReservation?: boolean;
        emailCancellation?: boolean;
        pushNewReservation?: boolean;
        pushCancellation?: boolean;
    };

    // Push通知用
    pushSubscriptions?: PushSubscription[];

    storeIds?: string[];
    lastLoginAt?: Timestamp;
    isActive: boolean;
}

export interface PushSubscription {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
    deviceType: 'desktop' | 'mobile';
    createdAt: Timestamp;
}

// ============================================
// Karte (カルテ)
// ============================================

export interface Karte extends BaseEntity {
    customerId: string;
    reservationId?: string;
    practitionerId: string;
    practitionerName: string;

    date: string;                // YYYY-MM-DD
    menuName: string;

    // 施術内容
    content: string;

    // 写真
    images: {
        url: string;
        thumbnailUrl?: string;
        caption?: string;
        createdAt: Timestamp;
    }[];

    // タグ
    tags: string[];
}

// ============================================
// API Request/Response Types
// ============================================

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
    meta?: {
        page?: number;
        limit?: number;
        total?: number;
        hasMore?: boolean;
    };
}

export interface PaginationParams {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

// ============================================
// Auth Types
// ============================================

export interface AuthenticatedRequest extends Express.Request {
    user?: {
        uid: string;
        tenantId: string;
        role?: AdminRole;
        permissions?: Admin['permissions'];
        name?: string;
        picture?: string;
    };
    tenantId?: string;
    storeId?: string;
}

export interface DecodedLineToken {
    iss: string;
    sub: string;                 // LINE User ID
    aud: string;                 // Channel ID
    exp: number;
    iat: number;
    name?: string;
    picture?: string;
    email?: string;
}
export * from './service-message.js';
