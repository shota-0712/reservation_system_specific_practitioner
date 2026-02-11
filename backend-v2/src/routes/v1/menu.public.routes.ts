import { Router, Request, Response } from 'express';
import { asyncHandler, validateParams, idParamSchema } from '../../middleware/index.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createMenuRepository } from '../../repositories/index.js';
import type { ApiResponse, Menu } from '../../types/index.js';

const router = Router();

router.get(
    '/',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const menuRepo = createMenuRepository(tenantId);
        const menus = await menuRepo.findAllActive();

        const response: ApiResponse<Menu[]> = { success: true, data: menus };
        res.json(response);
    })
);

router.get(
    '/categories',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const menuRepo = createMenuRepository(tenantId);
        const categories = await menuRepo.getCategories();

        const response: ApiResponse<string[]> = { success: true, data: categories };
        res.json(response);
    })
);

router.get(
    '/by-category/:category',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const menuRepo = createMenuRepository(tenantId);
        const category = decodeURIComponent(req.params.category as string);
        const menus = await menuRepo.findByCategory(category);

        const response: ApiResponse<Menu[]> = { success: true, data: menus };
        res.json(response);
    })
);

router.get(
    '/by-practitioner/:practitionerId',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const menuRepo = createMenuRepository(tenantId);
        const practitionerId = req.params.practitionerId as string;
        const menus = await menuRepo.findByPractitionerId(practitionerId);

        const response: ApiResponse<Menu[]> = { success: true, data: menus };
        res.json(response);
    })
);

router.get(
    '/:id',
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const menuRepo = createMenuRepository(tenantId);
        const menu = await menuRepo.findByIdOrFail(req.params.id as string);

        const response: ApiResponse<Menu> = { success: true, data: menu };
        res.json(response);
    })
);

export const menuPublicRoutes = router;
