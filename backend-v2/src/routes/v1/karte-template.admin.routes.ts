import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody, validateParams, idParamSchema } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createKarteTemplateRepository } from '../../repositories/index.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import type { ApiResponse } from '../../types/index.js';

const router = Router();

const createTemplateSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    isDefault: z.boolean().default(false),
    fields: z.array(z.record(z.unknown())).default([]),
    applicableMenuCategories: z.array(z.string()).default([]),
    isActive: z.boolean().default(true),
    displayOrder: z.number().int().min(0).default(0),
});

const updateTemplateSchema = createTemplateSchema.partial();

router.get(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageCustomers'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createKarteTemplateRepository(tenantId);
        const templates = await repo.findAll(true);

        const response: ApiResponse = { success: true, data: templates };
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
        const repo = createKarteTemplateRepository(tenantId);
        const template = await repo.findByIdOrFail(req.params.id as string);

        const response: ApiResponse = { success: true, data: template };
        res.json(response);
    })
);

router.post(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageCustomers'),
    validateBody(createTemplateSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createKarteTemplateRepository(tenantId);
        const template = await repo.create(req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'CREATE',
            entityType: 'karte_template',
            entityId: template.id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            newValues: template as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse = { success: true, data: template };
        res.status(201).json(response);
    })
);

router.put(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageCustomers'),
    validateParams(idParamSchema),
    validateBody(updateTemplateSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createKarteTemplateRepository(tenantId);
        const id = req.params.id as string;

        const before = await repo.findByIdOrFail(id);
        const template = await repo.update(id, req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'karte_template',
            entityId: id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: before as unknown as Record<string, unknown>,
            newValues: template as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse = { success: true, data: template };
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
        const repo = createKarteTemplateRepository(tenantId);
        const id = req.params.id as string;

        const before = await repo.findByIdOrFail(id);
        await repo.delete(id);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'DELETE',
            entityType: 'karte_template',
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

export const karteTemplateAdminRoutes = router;
