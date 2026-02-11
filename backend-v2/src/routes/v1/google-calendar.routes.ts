import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createGoogleCalendarService } from '../../services/google-calendar.service.js';
import { createGoogleCalendarSyncQueueService } from '../../services/google-calendar-sync-queue.service.js';
import { decodeGoogleOAuthState, encodeGoogleOAuthState } from '../../services/google-oauth-state.service.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import { ValidationError } from '../../utils/errors.js';
import type { ApiResponse } from '../../types/index.js';

const adminRouter = Router();
const callbackRouter = Router();

const updateSchema = z.object({
    status: z.enum(['active', 'revoked']),
});
const startOAuthSchema = z.object({
    redirectTo: z.string().url().optional(),
});

adminRouter.get(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createGoogleCalendarService(tenantId);
        const status = await service.getStatus();
        const queue = createGoogleCalendarSyncQueueService(tenantId);
        const summary = await queue.getSummary();

        const response: ApiResponse = {
            success: true,
            data: { ...status, queue: summary },
        };

        res.json(response);
    })
);

adminRouter.put(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    validateBody(updateSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createGoogleCalendarService(tenantId);

        if (req.body.status === 'revoked') {
            await service.revoke();
        }

        const status = await service.getStatus();

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'google_calendar_integration',
            entityId: tenantId,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            newValues: { ...status },
            ...meta,
        });

        const response: ApiResponse = {
            success: true,
            data: status,
        };

        res.json(response);
    })
);

adminRouter.post(
    '/oauth/start',
    requireFirebaseAuth(),
    requirePermission('canManageSettings'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createGoogleCalendarService(tenantId);
        const parsed = startOAuthSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            throw new ValidationError('redirectTo の形式が不正です');
        }

        const state = encodeGoogleOAuthState({
            tenantId,
            issuedAt: Date.now(),
            redirectTo: parsed.data.redirectTo,
        });
        const authUrl = service.buildAuthUrl(state);

        const response: ApiResponse = {
            success: true,
            data: { authUrl },
        };

        res.json(response);
    })
);

callbackRouter.get(
    '/oauth/callback',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const code = req.query.code as string | undefined;
        const state = req.query.state as string | undefined;

        if (!code || !state) {
            throw new ValidationError('Google OAuth callback に必要なパラメータが不足しています');
        }

        decodeGoogleOAuthState(state, { expectedTenantId: tenantId });

        const service = createGoogleCalendarService(tenantId);
        const status = await service.exchangeCodeAndSave(code);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'google_calendar_integration',
            entityId: tenantId,
            actorType: 'system',
            actorId: 'google-oauth-callback',
            actorName: 'Google OAuth Callback',
            newValues: { ...status },
            ...meta,
        });

        const response: ApiResponse = {
            success: true,
            data: status,
        };

        res.json(response);
    })
);

export { adminRouter as googleCalendarAdminRoutes, callbackRouter as googleCalendarCallbackRoutes };
