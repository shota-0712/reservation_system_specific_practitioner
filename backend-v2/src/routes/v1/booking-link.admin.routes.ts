import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody, validateQuery } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createBookingLinkTokenService } from '../../services/booking-link-token.service.js';
import { createPractitionerRepository } from '../../repositories/index.js';
import { NotFoundError } from '../../utils/errors.js';
import type { ApiResponse } from '../../types/index.js';

const router = Router();

const createBookingLinkSchema = z.object({
    practitionerId: z.string().uuid(),
    storeId: z.string().uuid().optional(),
    expiresAt: z.string().datetime().optional(),
    reissue: z.boolean().optional().default(true),
});

const listBookingLinkQuerySchema = z.object({
    status: z.enum(['active', 'revoked']).optional(),
});

router.get(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManagePractitioners'),
    validateQuery(listBookingLinkQuerySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createBookingLinkTokenService(tenantId);
        const links = await service.list();

        const status = req.query.status as 'active' | 'revoked' | undefined;
        const filtered = status ? links.filter((link) => link.status === status) : links;

        const response: ApiResponse = {
            success: true,
            data: filtered,
        };
        res.json(response);
    })
);

router.post(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManagePractitioners'),
    validateBody(createBookingLinkSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const payload = req.body as z.infer<typeof createBookingLinkSchema>;
        const service = createBookingLinkTokenService(tenantId);
        const practitionerRepo = createPractitionerRepository(tenantId);

        const practitioner = await practitionerRepo.findById(payload.practitionerId);
        if (!practitioner || !practitioner.isActive) {
            throw new NotFoundError('施術者', payload.practitionerId);
        }

        if (payload.storeId) {
            await service.ensureActiveStore(payload.storeId);
            await service.ensureStorePractitionerRelation(payload.storeId, payload.practitionerId);
        }

        const created = await service.create({
            practitionerId: payload.practitionerId,
            storeId: payload.storeId,
            createdBy: (req as { user?: { uid?: string } }).user?.uid ?? 'unknown',
            expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : undefined,
            reissue: payload.reissue,
        });

        const response: ApiResponse = {
            success: true,
            data: created,
        };
        res.status(201).json(response);
    })
);

router.delete(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManagePractitioners'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createBookingLinkTokenService(tenantId);
        await service.revoke(req.params.id as string);

        const response: ApiResponse = {
            success: true,
        };
        res.json(response);
    })
);

export const bookingLinkAdminRoutes = router;
