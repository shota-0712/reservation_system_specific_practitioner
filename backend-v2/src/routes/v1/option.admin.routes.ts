import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody, validateParams, idParamSchema } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createOptionRepository } from '../../repositories/index.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import type { ApiResponse, Option } from '../../types/index.js';

const router = Router();

const createOptionSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    duration: z.number().int().min(0).max(480).default(0),
    price: z.number().int().min(0).default(0),
    applicableMenuIds: z.array(z.string()).optional(),
    isActive: z.boolean().default(true),
    displayOrder: z.number().int().min(0).optional(),
});

const updateOptionSchema = createOptionSchema.partial();

router.get(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageMenus'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const optionRepo = createOptionRepository(tenantId);

        const options = await optionRepo.findAll({ includeInactive: true });
        const response: ApiResponse<Option[]> = { success: true, data: options };
        res.json(response);
    })
);

router.post(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageMenus'),
    validateBody(createOptionSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const optionRepo = createOptionRepository(tenantId);

        const option = await optionRepo.create(req.body);
        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'CREATE',
            entityType: 'option',
            entityId: option.id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            newValues: option as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Option> = { success: true, data: option };
        res.status(201).json(response);
    })
);

router.put(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageMenus'),
    validateParams(idParamSchema),
    validateBody(updateOptionSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const optionRepo = createOptionRepository(tenantId);
        const id = req.params.id as string;

        const before = await optionRepo.findByIdOrFail(id);
        const option = await optionRepo.update(id, req.body);
        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'option',
            entityId: id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: before as unknown as Record<string, unknown>,
            newValues: option as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Option> = { success: true, data: option };
        res.json(response);
    })
);

router.delete(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageMenus'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const optionRepo = createOptionRepository(tenantId);
        const id = req.params.id as string;

        const before = await optionRepo.findByIdOrFail(id);
        await optionRepo.softDelete(id);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'DELETE',
            entityType: 'option',
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

export const optionAdminRoutes = router;
