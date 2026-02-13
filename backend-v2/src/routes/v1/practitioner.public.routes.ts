import { Router, Request, Response } from 'express';
import { asyncHandler, validateParams, idParamSchema } from '../../middleware/index.js';
import { getStoreId, getTenantId } from '../../middleware/tenant.js';
import { createPractitionerRepository } from '../../repositories/index.js';
import { sanitizePractitionerForResponse, sanitizePractitionersForResponse } from '../../services/practitioner-response.service.js';
import type { ApiResponse, Practitioner } from '../../types/index.js';

const router = Router();

function practitionerMatchesStore(practitioner: Practitioner, storeId?: string): boolean {
    if (!storeId) {
        return true;
    }
    const storeIds = practitioner.storeIds ?? [];
    if (storeIds.length === 0) {
        return true;
    }
    return storeIds.includes(storeId);
}

router.get(
    '/',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeId = getStoreId(req) ?? undefined;
        const repo = createPractitionerRepository(tenantId);
        const practitioners = await repo.findAllActiveScoped(storeId);
        const safePractitioners = sanitizePractitionersForResponse(practitioners);

        const response: ApiResponse<Practitioner[]> = { success: true, data: safePractitioners };
        res.json(response);
    })
);

router.get(
    '/by-role/:role',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeId = getStoreId(req) ?? undefined;
        const repo = createPractitionerRepository(tenantId);
        const role = req.params.role as Practitioner['role'];
        const practitioners = await repo.findByRoleScoped(role, storeId);
        const safePractitioners = sanitizePractitionersForResponse(practitioners);

        const response: ApiResponse<Practitioner[]> = { success: true, data: safePractitioners };
        res.json(response);
    })
);

router.get(
    '/by-menu/:menuId',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeId = getStoreId(req) ?? undefined;
        const repo = createPractitionerRepository(tenantId);
        const practitioners = await repo.findByMenuIdScoped(req.params.menuId as string, storeId);
        const safePractitioners = sanitizePractitionersForResponse(practitioners);

        const response: ApiResponse<Practitioner[]> = { success: true, data: safePractitioners };
        res.json(response);
    })
);

router.get(
    '/by-day/:dayOfWeek',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeId = getStoreId(req) ?? undefined;
        const repo = createPractitionerRepository(tenantId);
        const dayOfWeek = parseInt(req.params.dayOfWeek as string, 10);
        const practitioners = await repo.findByWorkDayScoped(dayOfWeek, storeId);
        const safePractitioners = sanitizePractitionersForResponse(practitioners);

        const response: ApiResponse<Practitioner[]> = { success: true, data: safePractitioners };
        res.json(response);
    })
);

router.get(
    '/:id',
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const storeId = getStoreId(req) ?? undefined;
        const repo = createPractitionerRepository(tenantId);
        const practitioner = await repo.findByIdOrFail(req.params.id as string);
        if (!practitioner.isActive || !practitionerMatchesStore(practitioner, storeId)) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'スタッフが見つかりません',
                },
            });
            return;
        }
        const safePractitioner = sanitizePractitionerForResponse(practitioner);

        const response: ApiResponse<Practitioner> = { success: true, data: safePractitioner };
        res.json(response);
    })
);

export const practitionerPublicRoutes = router;
