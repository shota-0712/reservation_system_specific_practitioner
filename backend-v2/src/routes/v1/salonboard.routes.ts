import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createSalonboardService } from '../../services/salonboard.service.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import type { ApiResponse } from '../../types/index.js';

const router = Router();

const updateSalonboardSchema = z.object({
    isEnabled: z.boolean().optional(),
    syncDirection: z.enum(['inbound', 'outbound', 'both']).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    sessionCookie: z.string().min(1).optional(),
});

router.get(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createSalonboardService(tenantId);
        const status = await service.getStatus();

        const response: ApiResponse = {
            success: true,
            data: status,
        };

        res.json(response);
    })
);

router.put(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    validateBody(updateSalonboardSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createSalonboardService(tenantId);
        const updated = await service.updateSettings(req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'salonboard_integration',
            entityId: tenantId,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            newValues: updated as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse = {
            success: true,
            data: updated,
        };

        res.json(response);
    })
);

export default router;
