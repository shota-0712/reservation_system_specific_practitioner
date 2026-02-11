import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createTenantRepository } from '../../repositories/index.js';
import type { ApiResponse, TenantOnboardingStatus } from '../../types/index.js';

const router = Router();
const tenantRepository = createTenantRepository();

const updateSchema = z.object({
    status: z.enum(['pending', 'in_progress', 'completed']).optional(),
    onboardingPayload: z.record(z.unknown()).optional(),
});

router.get(
    '/status',
    requireFirebaseAuth(),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const status = await tenantRepository.getOnboardingStatus(tenantId);

        const response: ApiResponse<{
            onboardingStatus: TenantOnboardingStatus;
            completed: boolean;
            onboardingCompletedAt?: Date;
            onboardingPayload?: Record<string, unknown>;
        }> = {
            success: true,
            data: {
                onboardingStatus: status?.onboardingStatus ?? 'pending',
                completed: status?.onboardingStatus === 'completed',
                onboardingCompletedAt: status?.onboardingCompletedAt,
                onboardingPayload: status?.onboardingPayload,
            },
        };

        res.json(response);
    })
);

router.patch(
    '/status',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    validateBody(updateSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const { status, onboardingPayload } = req.body as z.infer<typeof updateSchema>;

        const updated = await tenantRepository.updateOnboarding(tenantId, {
            status,
            onboardingPayload,
        });

        const response: ApiResponse<{
            onboardingStatus: TenantOnboardingStatus;
            completed: boolean;
            onboardingCompletedAt?: Date;
            onboardingPayload?: Record<string, unknown>;
        }> = {
            success: true,
            data: {
                onboardingStatus: updated.onboardingStatus ?? 'pending',
                completed: updated.onboardingStatus === 'completed',
                onboardingCompletedAt: updated.onboardingCompletedAt,
                onboardingPayload: updated.onboardingPayload,
            },
        };

        res.json(response);
    })
);

export const onboardingAdminRoutes = router;
