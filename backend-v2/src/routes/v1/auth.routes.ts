/**
 * Authentication Routes (v1)
 * LINE authentication for customers
 * Firebase authentication for admin
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/index.js';
import { getStoreId, getTenantId, getTenant } from '../../middleware/tenant.js';
import { createCustomerRepository, createPractitionerRepository, createStoreRepository } from '../../repositories/index.js';
import { createLineService } from '../../services/line.service.js';
import { resolveLineConfigForTenant } from '../../services/line-config.service.js';
import { DatabaseService } from '../../config/database.js';
import type { ApiResponse, Customer } from '../../types/index.js';

const router = Router();

// ============================================
// Validation Schemas
// ============================================

const lineAuthSchema = z.object({
    idToken: z.string().min(1, 'ID Token is required'),
    practitionerId: z.string().uuid().optional(),
    storeId: z.string().uuid().optional(),
    profile: z.object({
        userId: z.string().min(1),
        displayName: z.string().min(1),
        pictureUrl: z.string().url().optional(),
        statusMessage: z.string().optional(),
    }),
    notificationToken: z.string().optional(),
});

const lineSessionSchema = z.object({
    idToken: z.string().min(1, 'ID Token is required'),
    practitionerId: z.string().uuid().optional(),
    storeId: z.string().uuid().optional(),
    profile: z.object({
        userId: z.string().min(1),
        displayName: z.string().min(1),
        pictureUrl: z.string().url().optional(),
    }).optional(),
    notificationToken: z.string().optional(),
});

const practitionerQuerySchema = z.object({
    practitionerId: z.string().uuid().optional(),
    storeId: z.string().uuid().optional(),
});

function practitionerMatchesStore(practitionerStoreIds: string[] | undefined, storeId?: string | null): boolean {
    if (!storeId) {
        return true;
    }
    const ids = practitionerStoreIds ?? [];
    if (ids.length === 0) {
        return true;
    }
    return ids.includes(storeId);
}

// ============================================
// LINE Authentication (for Customer App)
// ============================================

/**
 * POST /auth/line
 * Authenticate LINE user and return Firebase Custom Token
 */
router.post('/line',
    validateBody(lineAuthSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const tenantId = getTenantId(req);
        const { idToken, profile, notificationToken, practitionerId, storeId } = req.body;

        const storeRepo = createStoreRepository(tenantId);
        const selectedStoreId = storeId ?? getStoreId(req);
        const selectedStore = selectedStoreId ? await storeRepo.findById(selectedStoreId) : null;
        if (selectedStoreId && (!selectedStore || selectedStore.status !== 'active')) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: '利用可能な店舗が見つかりません',
                },
            });
            return;
        }

        let practitioner = null;
        if (practitionerId) {
            const practitionerRepo = createPractitionerRepository(tenantId);
            practitioner = await practitionerRepo.findById(practitionerId);
            if (!practitioner || !practitioner.isActive || !practitionerMatchesStore(practitioner.storeIds, selectedStoreId)) {
                res.status(404).json({
                    success: false,
                    error: {
                        code: 'NOT_FOUND',
                        message: '利用可能なスタッフが見つかりません',
                    },
                });
                return;
            }
        }

        const resolvedLine = resolveLineConfigForTenant(tenant, selectedStore, practitioner);

        // Initialize LINE service
        const lineService = createLineService({
            ...tenant,
            lineConfig: resolvedLine.lineConfig,
        });

        // 1. Verify LINE ID Token
        const verifiedToken = await lineService.verifyIdToken(idToken);

        // Verify that the user ID matches
        if (verifiedToken.sub !== profile.userId) {
            res.status(401).json({
                success: false,
                error: {
                    code: 'AUTHENTICATION_ERROR',
                    message: 'User ID mismatch',
                },
            });
            return;
        }

        // 2. Get or create customer in PostgreSQL
        const customerRepo = createCustomerRepository(tenantId);
        let customer = await customerRepo.findByLineUserId(profile.userId);

        if (!customer) {
            // Create new customer
            customer = await customerRepo.create({
                lineUserId: profile.userId,
                lineDisplayName: profile.displayName,
                linePictureUrl: profile.pictureUrl,
                name: profile.displayName,
                imageUrl: profile.pictureUrl,
                tags: [],
                stats: {
                    visitCount: 0,
                    totalVisits: 0,
                    totalSpent: 0,
                    cancelCount: 0,
                    noShowCount: 0,
                },
                notificationSettings: {
                    lineMessage: true,
                    reminder: true,
                    promotion: false,
                },
                notificationToken,
                isActive: true,
            } as unknown as Omit<Customer, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>);
        } else {
            // Update existing customer
            const updates: Partial<Customer> = {
                lineDisplayName: profile.displayName,
                linePictureUrl: profile.pictureUrl,
                name: customer.name || profile.displayName,
            };

            // Update notification token if provided
            if (notificationToken) {
                updates.notificationToken = notificationToken;
            }

            customer = await customerRepo.update(customer.id, updates);
        }

        // 3. Create Firebase Custom Token
        const customToken = await lineService.createCustomToken(profile.userId, {
            customerId: customer.id,
            displayName: profile.displayName,
        });

        // 4. Return token and customer info
        const response: ApiResponse<{
            customToken: string;
            customer: Customer;
        }> = {
            success: true,
            data: {
                customToken,
                customer,
            },
        };

        res.json(response);
    })
);

/**
 * GET /auth/config
 * Get tenant configuration for LIFF initialization
 * This is a PUBLIC endpoint (no auth required)
 */
router.get('/config',
    asyncHandler(async (req: Request, res: Response) => {
        const tenant = getTenant(req);
        const tenantId = getTenantId(req);
        const storeRepo = createStoreRepository(tenantId);
        const query = practitionerQuerySchema.safeParse(req.query);
        const practitionerId = query.success ? query.data.practitionerId : undefined;
        const queryStoreId = query.success ? query.data.storeId : undefined;
        const selectedStoreId = queryStoreId ?? getStoreId(req);

        let store = null;
        if (selectedStoreId) {
            store = await storeRepo.findById(selectedStoreId);
            if (!store || store.status !== 'active') {
                res.status(404).json({
                    success: false,
                    error: {
                        code: 'NOT_FOUND',
                        message: '利用可能な店舗が見つかりません',
                    },
                });
                return;
            }
        }
        if (!store) {
            const stores = await storeRepo.findAll();
            store = stores[0] ?? null;
        }

        let practitioner = null;
        if (practitionerId) {
            const practitionerRepo = createPractitionerRepository(tenantId);
            practitioner = await practitionerRepo.findById(practitionerId);
            if (!practitioner || !practitioner.isActive || !practitionerMatchesStore(practitioner.storeIds, selectedStoreId)) {
                res.status(404).json({
                    success: false,
                    error: {
                        code: 'NOT_FOUND',
                        message: '利用可能なスタッフが見つかりません',
                    },
                });
                return;
            }
        }
        const resolvedLine = resolveLineConfigForTenant(tenant, store, practitioner);

        // Return LIFF configuration (public data only)
        const response: ApiResponse<{
            liffId: string;
            lineMode: 'tenant' | 'store' | 'practitioner';
            lineConfigSource: 'tenant' | 'store' | 'practitioner';
            storeId?: string;
            practitionerId?: string;
            tenantName: string;
            branding: {
                primaryColor: string;
                logoUrl?: string;
            };
            store?: {
                id: string;
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
            };
        }> = {
            success: true,
            data: {
                liffId: resolvedLine.lineConfig.liffId || '',
                lineMode: resolvedLine.mode,
                lineConfigSource: resolvedLine.source,
                storeId: resolvedLine.storeId ?? store?.id,
                practitionerId: resolvedLine.practitionerId,
                tenantName: tenant.name,
                branding: {
                    primaryColor: tenant.branding?.primaryColor || '#3b82f6',
                    logoUrl: tenant.branding?.logoUrl,
                },
                store: store ? {
                    id: store.id,
                    name: store.name,
                    address: store.address,
                    phone: store.phone,
                    email: store.email,
                    timezone: store.timezone,
                    businessHours: store.businessHours,
                    regularHolidays: store.regularHolidays,
                    temporaryHolidays: store.temporaryHolidays,
                    temporaryOpenDays: store.temporaryOpenDays,
                    slotDuration: store.slotDuration,
                    advanceBookingDays: store.advanceBookingDays,
                    cancelDeadlineHours: store.cancelDeadlineHours,
                    requirePhone: store.requirePhone,
                    requireEmail: store.requireEmail,
                } : undefined,
            },
        };

        res.json(response);
    })
);

/**
 * GET /auth/admin/bootstrap-status
 * Returns whether the tenant can create the first admin account.
 * Public endpoint for admin signup screen.
 */
router.get('/admin/bootstrap-status',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const row = await DatabaseService.queryOne<{ count: number }>(
            'SELECT COUNT(*)::int AS count FROM admins WHERE tenant_id = $1 AND is_active = true',
            [tenantId],
            tenantId
        );

        const adminCount = Number(row?.count ?? 0);
        const response: ApiResponse<{
            canRegister: boolean;
            adminCount: number;
        }> = {
            success: true,
            data: {
                canRegister: adminCount === 0,
                adminCount,
            },
        };

        res.json(response);
    })
);

/**
 * POST /auth/session
 * Establish session from LINE ID token and upsert customer + notification token
 */
router.post('/session',
    validateBody(lineSessionSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const tenantId = getTenantId(req);
        const { idToken, profile, notificationToken, practitionerId, storeId } = req.body;

        const storeRepo = createStoreRepository(tenantId);
        const selectedStoreId = storeId ?? getStoreId(req);
        const selectedStore = selectedStoreId ? await storeRepo.findById(selectedStoreId) : null;
        if (selectedStoreId && (!selectedStore || selectedStore.status !== 'active')) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: '利用可能な店舗が見つかりません',
                },
            });
            return;
        }

        let practitioner = null;
        if (practitionerId) {
            const practitionerRepo = createPractitionerRepository(tenantId);
            practitioner = await practitionerRepo.findById(practitionerId);
            if (!practitioner || !practitioner.isActive || !practitionerMatchesStore(practitioner.storeIds, selectedStoreId)) {
                res.status(404).json({
                    success: false,
                    error: {
                        code: 'NOT_FOUND',
                        message: '利用可能なスタッフが見つかりません',
                    },
                });
                return;
            }
        }

        const resolvedLine = resolveLineConfigForTenant(tenant, selectedStore, practitioner);

        const lineService = createLineService({
            ...tenant,
            lineConfig: resolvedLine.lineConfig,
        });
        const verifiedToken = await lineService.verifyIdToken(idToken);
        const lineUserId = verifiedToken.sub;

        if (profile?.userId && profile.userId !== lineUserId) {
            res.status(401).json({
                success: false,
                error: {
                    code: 'AUTHENTICATION_ERROR',
                    message: 'User ID mismatch',
                },
            });
            return;
        }

        const customerRepo = createCustomerRepository(tenantId);
        const existing = await customerRepo.findByLineUserId(lineUserId);
        const displayName = profile?.displayName || verifiedToken.name || existing?.name || 'ゲスト';
        const pictureUrl = profile?.pictureUrl || verifiedToken.picture;

        let customer: Customer;
        if (!existing) {
            customer = await customerRepo.create({
                lineUserId,
                lineDisplayName: displayName,
                linePictureUrl: pictureUrl,
                name: displayName,
                imageUrl: pictureUrl,
                lineNotificationToken: notificationToken,
                tags: [],
                isActive: true,
            });
        } else {
            customer = await customerRepo.update(existing.id, {
                lineDisplayName: displayName,
                linePictureUrl: pictureUrl,
                name: existing.name || displayName,
                lineNotificationToken: notificationToken ?? existing.lineNotificationToken,
            });
        }

        const response: ApiResponse<{
            customer: Customer;
            lineUserId: string;
        }> = {
            success: true,
            data: {
                customer,
                lineUserId,
            },
        };

        res.json(response);
    })
);

export const authRoutes = router;
