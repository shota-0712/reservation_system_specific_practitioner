import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody, validateParams, idParamSchema } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createKarteRepository } from '../../repositories/index.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import type { ApiResponse } from '../../types/index.js';

const router = Router();

const createKarteSchema = z.object({
    customerId: z.string().min(1),
    reservationId: z.string().optional(),
    storeId: z.string().optional(),
    practitionerId: z.string().min(1),
    customerName: z.string().optional(),
    customerPictureUrl: z.string().url().optional(),
    visitDate: z.string(),
    menuIds: z.array(z.string()).default([]),
    menuNames: z.array(z.string()).default([]),
    optionIds: z.array(z.string()).default([]),
    duration: z.number().int().optional(),
    totalAmount: z.number().int().optional(),
    treatmentDescription: z.string().optional(),
    colorFormula: z.string().optional(),
    productsUsed: z.array(z.string()).default([]),
    customerRequest: z.string().optional(),
    conversationMemo: z.string().optional(),
    nextVisitNote: z.string().optional(),
    customFields: z.record(z.unknown()).default({}),
    photosBefore: z.array(z.string()).default([]),
    photosAfter: z.array(z.string()).default([]),
    photosOther: z.array(z.record(z.unknown())).default([]),
    status: z.enum(['draft', 'completed']).default('draft'),
    tags: z.array(z.string()).default([]),
});

const updateKarteSchema = createKarteSchema.partial();

router.get(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageCustomers'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 500);
        const karteRepo = createKarteRepository(tenantId);
        const kartes = await karteRepo.findAll(limit);

        const response: ApiResponse = {
            success: true,
            data: kartes,
        };

        res.json(response);
    })
);

router.get(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageCustomers'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const karteRepo = createKarteRepository(tenantId);
        const karte = await karteRepo.findByIdOrFail(req.params.id as string);

        const response: ApiResponse = {
            success: true,
            data: karte,
        };

        res.json(response);
    })
);

router.post(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageCustomers'),
    validateBody(createKarteSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const karteRepo = createKarteRepository(tenantId);
        const karte = await karteRepo.create(req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'CREATE',
            entityType: 'karte',
            entityId: karte.id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            newValues: karte as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse = {
            success: true,
            data: karte,
        };

        res.status(201).json(response);
    })
);

router.put(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageCustomers'),
    validateParams(idParamSchema),
    validateBody(updateKarteSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const id = req.params.id as string;
        const karteRepo = createKarteRepository(tenantId);

        const before = await karteRepo.findByIdOrFail(id);
        const karte = await karteRepo.update(id, req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'karte',
            entityId: id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: before as unknown as Record<string, unknown>,
            newValues: karte as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse = {
            success: true,
            data: karte,
        };

        res.json(response);
    })
);

router.delete(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageCustomers'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const id = req.params.id as string;
        const karteRepo = createKarteRepository(tenantId);

        const before = await karteRepo.findByIdOrFail(id);
        await karteRepo.delete(id);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'DELETE',
            entityType: 'karte',
            entityId: id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: before as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse = { success: true };
        res.json(response);
    })
);

export const karteAdminRoutes = router;
