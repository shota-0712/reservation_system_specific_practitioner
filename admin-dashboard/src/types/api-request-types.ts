// ============================================
// 予約
// ============================================

export type ReservationSource =
    | 'line' | 'phone' | 'walk_in' | 'salonboard' | 'hotpepper' | 'web' | 'admin' | 'google_calendar';

export interface CreateAdminReservationRequest {
    customerId?: string;
    customerName: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    practitionerId: string;
    menuIds: string[];
    optionIds?: string[];
    startsAt: string;    // ISO 8601 UTC datetime
    timezone: string;    // IANA timezone, e.g. "Asia/Tokyo"
    status?: 'pending' | 'confirmed';
    isNomination?: boolean;
    customerNote?: string | null;
    staffNote?: string | null;
    source?: ReservationSource;
    storeId?: string;
}

export type UpdateAdminReservationRequest = Partial<CreateAdminReservationRequest> & {
    status?: 'pending' | 'confirmed' | 'completed' | 'canceled' | 'no_show';
};

// ============================================
// 顧客
// ============================================

export interface UpdateCustomerRequest {
    name?: string | null;
    nameKana?: string | null;
    phone?: string | null;
    email?: string | null;
    birthDate?: string | null;
    gender?: 'male' | 'female' | 'other' | 'undisclosed';
    tags?: string[] | null;
    memo?: string | null;
}

// ============================================
// 施術者
// ============================================

export interface PractitionerSchedule {
    workDays: number[];
    workHours: { start: string; end: string };
    breakTime?: { start: string; end: string };
}

export interface PractitionerLineConfigRequest {
    liffId?: string | null;
    channelId?: string | null;
    channelAccessToken?: string | null;
    channelSecret?: string | null;
}

export interface CreatePractitionerRequest {
    name: string;
    nameKana?: string | null;
    role?: 'stylist' | 'assistant' | 'owner';
    phone?: string | null;
    email?: string | null;
    imageUrl?: string | null;
    color?: string | null;
    title?: string | null;
    description?: string | null;
    experience?: string | null;
    prTitle?: string | null;
    specialties?: string[] | null;
    snsInstagram?: string | null;
    snsTwitter?: string | null;
    nominationFee?: number | null;
    schedule?: PractitionerSchedule | null;
    availableMenuIds?: string[] | null;
    storeIds?: string[] | null;
    calendarId?: string | null;
    salonboardStaffId?: string | null;
    lineConfig?: PractitionerLineConfigRequest | null;
    displayOrder?: number;
    isActive?: boolean;
}

export type UpdatePractitionerRequest = Partial<CreatePractitionerRequest>;

// ============================================
// メニュー
// ============================================

export interface CreateMenuRequest {
    name: string;
    description?: string | null;
    category?: string | null;
    duration: number;
    price: number;
    imageUrl?: string | null;
    displayOrder?: number | null;
    isActive?: boolean | null;
}

export type UpdateMenuRequest = Partial<CreateMenuRequest>;

// ============================================
// オプション
// ============================================

export interface CreateOptionRequest {
    name: string;
    description?: string | null;
    duration: number;
    price: number;
    displayOrder?: number | null;
    isActive?: boolean | null;
}

export type UpdateOptionRequest = Partial<CreateOptionRequest>;

// ============================================
// 店舗
// ============================================

export interface BusinessHoursConfig {
    isOpen: boolean;
    openTime?: string;
    closeTime?: string;
}

export interface CreateStoreRequest {
    name: string;
    storeCode?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    timezone?: string | null;
    businessHours?: Record<string, BusinessHoursConfig> | null;
    regularHolidays?: number[] | null;
    slotDuration?: number | null;
    advanceBookingDays?: number | null;
    cancelDeadlineHours?: number | null;
}

export type UpdateStoreRequest = Partial<CreateStoreRequest>;

// ============================================
// カルテ
// ============================================

export interface CreateKarteRequest {
    customerId: string;
    reservationId?: string | null;
    storeId?: string | null;
    practitionerId: string;
    customerName?: string | null;
    customerPictureUrl?: string | null;
    visitDate: string;
    menuIds?: string[] | null;
    menuNames?: string[] | null;
    optionIds?: string[] | null;
    duration?: number | null;
    totalAmount?: number | null;
    treatmentDescription?: string | null;
    colorFormula?: string | null;
    productsUsed?: string[] | null;
    customerRequest?: string | null;
    conversationMemo?: string | null;
    nextVisitNote?: string | null;
    customFields?: Record<string, unknown> | null;
    photosBefore?: string[] | null;
    photosAfter?: string[] | null;
    photosOther?: Record<string, unknown>[] | null;
    status?: 'draft' | 'completed' | null;
    tags?: string[] | null;
}

export type UpdateKarteRequest = Partial<CreateKarteRequest>;

// ============================================
// カルテテンプレート
// ============================================

export interface CreateKarteTemplateRequest {
    name: string;
    description?: string | null;
    isDefault?: boolean | null;
    fields?: Record<string, unknown>[] | null;
    applicableMenuCategories?: string[] | null;
    isActive?: boolean | null;
    displayOrder?: number | null;
    // backward compatibility
    content?: string | null;
    tags?: string[] | null;
}

export type UpdateKarteTemplateRequest = Partial<CreateKarteTemplateRequest>;

// ============================================
// 設定
// ============================================

export interface UpdateProfileRequest {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
}

export interface UpdateBusinessRequest {
    storeName?: string | null;
    address?: string | null;
    phone?: string | null;
    timezone?: string | null;
    businessHours?: Record<string, BusinessHoursConfig> | null;
    regularHolidays?: number[] | null;
    slotDuration?: number | null;
    advanceBookingDays?: number | null;
    cancelDeadlineHours?: number | null;
}

export interface UpdateLineRequest {
    channelId?: string | null;
    channelSecret?: string | null;
    channelAccessToken?: string | null;
    liffId?: string | null;
    mode?: 'tenant' | 'store' | 'practitioner' | string | null;
}

export interface UpdateBrandingRequest {
    primaryColor?: string | null;
    logoUrl?: string | null;
}

export interface UploadBrandingLogoRequest {
    fileName: string;
    contentType: 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'image/webp';
    dataBase64: string;
}

export interface UpdateNotificationSettingsRequest {
    emailNewReservation?: boolean;
    emailCancellation?: boolean;
    emailDailyReport?: boolean;
    lineReminder?: boolean;
    lineConfirmation?: boolean;
    lineReview?: boolean;
    pushNewReservation?: boolean;
    pushCancellation?: boolean;
}
