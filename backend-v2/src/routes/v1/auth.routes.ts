/**
 * Authentication Routes (v1)
 * LINE authentication for customers
 * Firebase authentication for admin
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/index.js';
import { getTenantId, getTenant } from '../../middleware/tenant.js';
import { createCustomerRepository, createStoreRepository } from '../../repositories/index.js';
import { createLineService } from '../../services/line.service.js';
import { DatabaseService } from '../../config/database.js';
import type { ApiResponse, Customer } from '../../types/index.js';

const router = Router();

// ============================================
// Validation Schemas
// ============================================

const lineAuthSchema = z.object({
    idToken: z.string().min(1, 'ID Token is required'),
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
    profile: z.object({
        userId: z.string().min(1),
        displayName: z.string().min(1),
        pictureUrl: z.string().url().optional(),
    }).optional(),
    notificationToken: z.string().optional(),
});

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
        const { idToken, profile, notificationToken } = req.body;

        // Initialize LINE service
        const lineService = createLineService(tenant);

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
        const stores = await storeRepo.findAll();
        const store = stores[0];

        // Return LIFF configuration (public data only)
        const response: ApiResponse<{
            liffId: string;
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
                liffId: tenant.lineConfig?.liffId || '',
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
            'SELECT COUNT(*)::int AS count FROM admins WHERE tenant_id = $1',
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
        const { idToken, profile, notificationToken } = req.body;

        const lineService = createLineService(tenant);
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
