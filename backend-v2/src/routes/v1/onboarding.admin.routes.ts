import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createTenantRepository } from '../../repositories/index.js';
import { createOnboardingAdminSetupService } from '../../services/onboarding-admin-setup.service.js';
import { ValidationError } from '../../utils/errors.js';
import type { ApiResponse, TenantOnboardingStatus } from '../../types/index.js';

const router = Router();
const tenantRepository = createTenantRepository();
const onboardingAdminSetupService = createOnboardingAdminSetupService();

const updateSchema = z.object({
    status: z.enum(['pending', 'in_progress', 'completed']).optional(),
    onboardingPayload: z.record(z.unknown()).optional(),
    applySetup: z.boolean().optional(),
    applySetupPayload: z.record(z.unknown()).optional(),
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
        const {
            status,
            onboardingPayload,
            applySetup,
            applySetupPayload,
        } = req.body as z.infer<typeof updateSchema>;

        let setupResult:
            | {
                  tenantUpdated: boolean;
                  storeUpdated: boolean;
                  menuApplied: boolean;
                  practitionerApplied: boolean;
              }
            | undefined;

        if (applySetup) {
            const payloadForApply = applySetupPayload ?? onboardingPayload;
            if (!payloadForApply) {
                throw new ValidationError('applySetupPayload または onboardingPayload が必要です');
            }

            setupResult = await onboardingAdminSetupService.apply(
                tenantId,
                payloadForApply
            );
        }

        const updated = await tenantRepository.updateOnboarding(tenantId, {
            status,
            onboardingPayload,
        });

        const response: ApiResponse<{
            onboardingStatus: TenantOnboardingStatus;
            completed: boolean;
            onboardingCompletedAt?: Date;
            onboardingPayload?: Record<string, unknown>;
            setupResult?: {
                tenantUpdated: boolean;
                storeUpdated: boolean;
                menuApplied: boolean;
                practitionerApplied: boolean;
            };
        }> = {
            success: true,
            data: {
                onboardingStatus: updated.onboardingStatus ?? 'pending',
                completed: updated.onboardingStatus === 'completed',
                onboardingCompletedAt: updated.onboardingCompletedAt,
                onboardingPayload: updated.onboardingPayload,
                ...(setupResult ? { setupResult } : {}),
            },
        };

        res.json(response);
    })
);

export const onboardingAdminRoutes = router;
