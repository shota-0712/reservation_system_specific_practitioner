import { Router, Request, Response } from 'express';
import { asyncHandler, validateParams, idParamSchema } from '../../middleware/index.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createPractitionerRepository } from '../../repositories/index.js';
import type { ApiResponse, Practitioner } from '../../types/index.js';

const router = Router();

router.get(
    '/',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createPractitionerRepository(tenantId);
        const practitioners = await repo.findAllActive();

        const response: ApiResponse<Practitioner[]> = { success: true, data: practitioners };
        res.json(response);
    })
);

router.get(
    '/by-role/:role',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createPractitionerRepository(tenantId);
        const role = req.params.role as Practitioner['role'];
        const practitioners = await repo.findByRole(role);

        const response: ApiResponse<Practitioner[]> = { success: true, data: practitioners };
        res.json(response);
    })
);

router.get(
    '/by-menu/:menuId',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createPractitionerRepository(tenantId);
        const practitioners = await repo.findByMenuId(req.params.menuId as string);

        const response: ApiResponse<Practitioner[]> = { success: true, data: practitioners };
        res.json(response);
    })
);

router.get(
    '/by-day/:dayOfWeek',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createPractitionerRepository(tenantId);
        const dayOfWeek = parseInt(req.params.dayOfWeek as string, 10);
        const practitioners = await repo.findByWorkDay(dayOfWeek);

        const response: ApiResponse<Practitioner[]> = { success: true, data: practitioners };
        res.json(response);
    })
);

router.get(
    '/:id',
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createPractitionerRepository(tenantId);
        const practitioner = await repo.findByIdOrFail(req.params.id as string);

        const response: ApiResponse<Practitioner> = { success: true, data: practitioner };
        res.json(response);
    })
);

export const practitionerPublicRoutes = router;
