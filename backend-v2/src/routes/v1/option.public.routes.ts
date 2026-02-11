import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateQuery, validateParams, idParamSchema } from '../../middleware/index.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createOptionRepository } from '../../repositories/index.js';
import type { ApiResponse, Option } from '../../types/index.js';

const router = Router();

const optionQuerySchema = z.object({
    menuId: z.string().optional(),
});

router.get(
    '/',
    validateQuery(optionQuerySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const { menuId } = req.query as { menuId?: string };
        const optionRepo = createOptionRepository(tenantId);

        const options = menuId
            ? await optionRepo.findByMenuId(menuId)
            : await optionRepo.findAllActive();

        const response: ApiResponse<Option[]> = {
            success: true,
            data: options,
        };

        res.json(response);
    })
);

router.get(
    '/:id',
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const optionRepo = createOptionRepository(tenantId);
        const option = await optionRepo.findByIdOrFail(req.params.id as string);

        const response: ApiResponse<Option> = {
            success: true,
            data: option,
        };

        res.json(response);
    })
);

export const optionPublicRoutes = router;
