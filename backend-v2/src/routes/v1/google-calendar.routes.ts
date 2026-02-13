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

function isValidRedirectTarget(url: string | undefined): boolean {
    if (!url) {
        return false;
    }

    return /^https?:\/\//.test(url);
}

function renderOAuthCompletionPage(res: Response, payload: {
    connected: boolean;
    email?: string;
    tenantId: string;
}): void {
    const serializedPayload = JSON.stringify({
        type: 'reserve:google-oauth-result',
        connected: payload.connected,
        email: payload.email ?? '',
        tenantId: payload.tenantId,
    }).replace(/</g, '\\u003c');
    const statusLabel = payload.connected ? 'Google連携が完了しました。' : 'Google連携に失敗しました。';
    const body = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google連携</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      main { max-width: 720px; margin: 48px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
      h1 { margin: 0 0 8px; font-size: 20px; }
      p { margin: 8px 0; line-height: 1.6; }
      code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; }
      .sub { color: #475569; font-size: 14px; }
      .close { margin-top: 16px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${statusLabel}</h1>
      <p class="sub">このウィンドウを閉じて、元の管理画面に戻ってください。</p>
      <p>tenantId: <code>${payload.tenantId}</code></p>
      <p>account: <code>${payload.email ?? '-'}</code></p>
      <button class="close" onclick="window.close()">このウィンドウを閉じる</button>
    </main>
    <script>
      (function () {
        const payload = ${serializedPayload};
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(payload, '*');
          } catch (error) {
            console.warn('postMessage failed:', error);
          }
          setTimeout(function () { window.close(); }, 350);
        }
      })();
    </script>
  </body>
</html>`;

    res.status(200).type('html').send(body);
}

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

        const decodedState = decodeGoogleOAuthState(state, { expectedTenantId: tenantId });

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

        if (isValidRedirectTarget(decodedState.redirectTo)) {
            const redirectUrl = new URL(decodedState.redirectTo as string);
            redirectUrl.searchParams.set('googleCalendar', status.connected ? 'connected' : 'failed');
            redirectUrl.searchParams.set('tenantId', tenantId);
            res.redirect(302, redirectUrl.toString());
            return;
        }

        if (req.accepts('html')) {
            renderOAuthCompletionPage(res, {
                connected: Boolean(status.connected),
                email: status.email,
                tenantId,
            });
            return;
        }

        const response: ApiResponse = {
            success: true,
            data: status,
        };

        res.json(response);
    })
);

export { adminRouter as googleCalendarAdminRoutes, callbackRouter as googleCalendarCallbackRoutes };
