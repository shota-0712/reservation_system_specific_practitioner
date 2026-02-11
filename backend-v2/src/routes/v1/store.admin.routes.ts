import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody, validateParams, idParamSchema } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createStoreRepository } from '../../repositories/index.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import type { ApiResponse, Store } from '../../types/index.js';

const router = Router();

const dayConfigSchema = z.object({
    isOpen: z.boolean(),
    openTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    closeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

const createStoreSchema = z.object({
    storeCode: z.string().regex(/^[a-z0-9]{8,10}$/),
    name: z.string().min(1).max(100),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    timezone: z.string().default('Asia/Tokyo'),
    businessHours: z.record(dayConfigSchema).optional(),
    regularHolidays: z.array(z.number().int().min(0).max(6)).optional(),
    temporaryHolidays: z.array(z.string()).optional(),
    temporaryOpenDays: z.array(z.string()).optional(),
    slotDuration: z.number().int().min(5).max(120).optional(),
    advanceBookingDays: z.number().int().min(1).max(365).optional(),
    cancelDeadlineHours: z.number().int().min(0).max(168).optional(),
    requirePhone: z.boolean().optional(),
    requireEmail: z.boolean().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    displayOrder: z.number().int().min(0).optional(),
});

const updateStoreSchema = createStoreSchema.partial().omit({ storeCode: true });

router.get(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeRepo = createStoreRepository(tenantId);
        const stores = await storeRepo.findAll();

        const response: ApiResponse<Store[]> = {
            success: true,
            data: stores,
        };

        res.json(response);
    })
);

router.get(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeRepo = createStoreRepository(tenantId);
        const store = await storeRepo.findById(req.params.id as string);

        const response: ApiResponse<Store | null> = {
            success: true,
            data: store,
        };

        res.json(response);
    })
);

router.post(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    validateBody(createStoreSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeRepo = createStoreRepository(tenantId);
        const store = await storeRepo.create(req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'CREATE',
            entityType: 'store',
            entityId: store.id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            newValues: store as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Store> = {
            success: true,
            data: store,
        };

        res.status(201).json(response);
    })
);

router.put(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    validateParams(idParamSchema),
    validateBody(updateStoreSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeRepo = createStoreRepository(tenantId);
        const id = req.params.id as string;

        const before = await storeRepo.findById(id);
        const store = await storeRepo.update(id, req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'store',
            entityId: store.id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: (before as unknown as Record<string, unknown>) || undefined,
            newValues: store as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Store> = {
            success: true,
            data: store,
        };

        res.json(response);
    })
);

router.delete(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeRepo = createStoreRepository(tenantId);
        const id = req.params.id as string;

        const before = await storeRepo.findById(id);
        await storeRepo.softDelete(id);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'DELETE',
            entityType: 'store',
            entityId: id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: (before as unknown as Record<string, unknown>) || undefined,
            ...meta,
        });

        const response: ApiResponse = { success: true };
        res.json(response);
    })
);

export const storeAdminRoutes = router;
