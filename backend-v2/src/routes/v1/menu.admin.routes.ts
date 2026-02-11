import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody, validateParams, idParamSchema } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createMenuRepository } from '../../repositories/index.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import type { ApiResponse, Menu } from '../../types/index.js';

const router = Router();

const createMenuSchema = z.object({
    name: z.string().min(1, 'メニュー名は必須です').max(100),
    description: z.string().max(500).optional(),
    category: z.string().min(1, 'カテゴリは必須です').max(50),
    duration: z.number().int().min(5, '施術時間は5分以上必要です').max(480),
    price: z.number().int().min(0, '価格は0以上必要です'),
    imageUrl: z.string().url().optional(),
    availablePractitionerIds: z.array(z.string()).optional(),
    isActive: z.boolean().default(true),
    displayOrder: z.number().int().min(0).optional(),
});

const updateMenuSchema = createMenuSchema.partial();

const reorderMenusSchema = z.object({
    orders: z.array(z.object({
        id: z.string(),
        displayOrder: z.number().int().min(0),
    })),
});

router.get(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageMenus'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const menuRepo = createMenuRepository(tenantId);
        const menus = await menuRepo.findAll({ includeInactive: true });

        const response: ApiResponse<Menu[]> = { success: true, data: menus };
        res.json(response);
    })
);

router.post(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageMenus'),
    validateBody(createMenuSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const menuRepo = createMenuRepository(tenantId);
        const menu = await menuRepo.createMenu(req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'CREATE',
            entityType: 'menu',
            entityId: menu.id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            newValues: menu as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Menu> = { success: true, data: menu };
        res.status(201).json(response);
    })
);

router.put(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageMenus'),
    validateParams(idParamSchema),
    validateBody(updateMenuSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const id = req.params.id as string;
        const menuRepo = createMenuRepository(tenantId);

        const before = await menuRepo.findByIdOrFail(id);
        const menu = await menuRepo.updateMenu(id, req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'menu',
            entityId: id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: before as unknown as Record<string, unknown>,
            newValues: menu as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Menu> = { success: true, data: menu };
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
        const id = req.params.id as string;
        const menuRepo = createMenuRepository(tenantId);

        const before = await menuRepo.findByIdOrFail(id);
        await menuRepo.softDelete(id);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'DELETE',
            entityType: 'menu',
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

router.post(
    '/reorder',
    requireFirebaseAuth(),
    requirePermission('canManageMenus'),
    validateBody(reorderMenusSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const menuRepo = createMenuRepository(tenantId);
        await menuRepo.updateDisplayOrders(req.body.orders);

        const response: ApiResponse = { success: true };
        res.json(response);
    })
);

export const menuAdminRoutes = router;
