import { Router, Request, Response } from 'express';
import { createHmac } from 'crypto';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { env } from '../../config/env.js';
import { createGoogleCalendarService } from '../../services/google-calendar.service.js';
import { createGoogleCalendarSyncQueueService } from '../../services/google-calendar-sync-queue.service.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import { ValidationError } from '../../utils/errors.js';
import type { ApiResponse } from '../../types/index.js';

const adminRouter = Router();
const callbackRouter = Router();

const stateTtlMs = 10 * 60 * 1000;

function encodeState(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sign = createHmac('sha256', env.ENCRYPTION_KEY).update(body).digest('base64url');
    return `${body}.${sign}`;
}

function decodeState(state: string): Record<string, unknown> {
    const [body, sign] = state.split('.');
    if (!body || !sign) {
        throw new ValidationError('Invalid OAuth state');
    }

    const expected = createHmac('sha256', env.ENCRYPTION_KEY).update(body).digest('base64url');
    if (sign !== expected) {
        throw new ValidationError('Invalid OAuth state signature');
    }

    return JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as Record<string, unknown>;
}

const updateSchema = z.object({
    status: z.enum(['active', 'revoked']),
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

        const now = Date.now();
        const state = encodeState({ tenantId, issuedAt: now });
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

        const decoded = decodeState(state);
        const issuedAt = Number(decoded.issuedAt || 0);
        if (!issuedAt || Date.now() - issuedAt > stateTtlMs) {
            throw new ValidationError('OAuth state の有効期限が切れています');
        }
        if (decoded.tenantId !== tenantId) {
            throw new ValidationError('OAuth state tenant mismatch');
        }

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
