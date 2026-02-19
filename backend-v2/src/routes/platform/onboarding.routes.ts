import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { DatabaseService } from '../../config/database.js';
import { getAuthInstance } from '../../config/firebase.js';
import { env } from '../../config/env.js';
import { asyncHandler, validateBody } from '../../middleware/index.js';
import { createBookingLinkTokenService } from '../../services/booking-link-token.service.js';
import { createGoogleCalendarService } from '../../services/google-calendar.service.js';
import { decodeGoogleOAuthState } from '../../services/google-oauth-state.service.js';
import { createOnboardingService } from '../../services/onboarding.service.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import { AuthenticationError, AuthorizationError, ConflictError, RateLimitError, ValidationError } from '../../utils/errors.js';
import type { ApiResponse } from '../../types/index.js';

const router = Router();
const onboardingService = createOnboardingService();

const emailRateLimitStore = new Map<string, { count: number; resetAt: number }>();
const emailRateLimitWindowMs = 15 * 60 * 1000;
const emailRateLimitMax = 5;

// BUG-27 fix: periodically sweep expired entries to prevent unbounded memory growth.
// Without this, each unique email that triggers the limiter leaks an entry indefinitely.
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of emailRateLimitStore.entries()) {
        if (entry.resetAt <= now) {
            emailRateLimitStore.delete(key);
        }
    }
}, emailRateLimitWindowMs).unref();
const ipLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMITED',
            message: 'リクエスト数が制限を超えました。しばらく待ってからお試しください。',
        },
    },
});

const slugAvailabilitySchema = z.object({
    slug: z.string().trim().min(3).max(40),
});

const registrationSchema = z.object({
    idToken: z.string().min(1),
    tenantName: z.string().trim().min(1).max(200),
    ownerName: z.string().trim().min(1).max(100).optional(),
    storeName: z.string().trim().min(1).max(100).optional(),
    timezone: z.string().trim().min(1).default('Asia/Tokyo'),
    address: z.string().trim().max(500).optional(),
    phone: z.string().trim().max(30).optional(),
});
const bookingLinkResolveSchema = z.object({
    token: z.string().trim().min(16).max(128),
});
const adminContextQuerySchema = z.object({
    tenantKey: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/).optional(),
});

function consumeEmailQuota(email: string): void {
    const now = Date.now();
    const key = email.toLowerCase();
    const current = emailRateLimitStore.get(key);
    if (!current || current.resetAt <= now) {
        emailRateLimitStore.set(key, {
            count: 1,
            resetAt: now + emailRateLimitWindowMs,
        });
        return;
    }

    if (current.count >= emailRateLimitMax) {
        const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
        throw new RateLimitError(retryAfterSeconds);
    }

    current.count += 1;
    emailRateLimitStore.set(key, current);
}

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

function getBearerToken(req: Request): string {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        throw new AuthenticationError('認証トークンが必要です');
    }
    return authHeader.slice('Bearer '.length);
}

router.get(
    '/onboarding/registration-config',
    asyncHandler(async (_req: Request, res: Response) => {
        const response: ApiResponse<{
            enabled: boolean;
            tenantKeyPolicy: 'auto_generated';
            supportsManualTenantKey: false;
        }> = {
            success: true,
            data: {
                enabled: env.PUBLIC_ONBOARDING_ENABLED,
                tenantKeyPolicy: 'auto_generated',
                supportsManualTenantKey: false,
            },
        };

        res.json(response);
    })
);

router.get(
    '/onboarding/slug-availability',
    asyncHandler(async (req: Request, res: Response) => {
        const parsed = slugAvailabilitySchema.safeParse(req.query);
        if (!parsed.success) {
            throw new ValidationError('slug が不正です');
        }

        const available = await onboardingService.isSlugAvailable(parsed.data.slug);
        const response: ApiResponse<{ slug: string; available: boolean }> = {
            success: true,
            data: {
                slug: parsed.data.slug.toLowerCase(),
                available,
            },
        };

        res.json(response);
    })
);

router.get(
    '/booking-links/resolve',
    asyncHandler(async (req: Request, res: Response) => {
        const parsed = bookingLinkResolveSchema.safeParse(req.query);
        if (!parsed.success) {
            throw new ValidationError('token が不正です');
        }

        const service = createBookingLinkTokenService();
        const resolved = await service.resolve(parsed.data.token);
        if (!resolved) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: '予約URLが見つかりません',
                },
            });
            return;
        }

        const response: ApiResponse<{
            tenantKey: string;
            tenantId: string;
            storeId?: string;
            practitionerId: string;
            lineMode: 'tenant' | 'store' | 'practitioner';
            lineConfigSource: 'tenant' | 'store' | 'practitioner';
        }> = {
            success: true,
            data: {
                tenantKey: resolved.tenantKey,
                tenantId: resolved.tenantId,
                storeId: resolved.storeId,
                practitionerId: resolved.practitionerId,
                lineMode: resolved.lineMode,
                lineConfigSource: resolved.lineConfigSource,
            },
        };
        res.json(response);
    })
);

router.get(
    '/admin/context',
    asyncHandler(async (req: Request, res: Response) => {
        const token = getBearerToken(req);
        const auth = getAuthInstance();
        const decoded = await auth.verifyIdToken(token);

        const parsed = adminContextQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            throw new ValidationError('tenantKey が不正です');
        }
        const requestedTenantKey = parsed.data.tenantKey;

        const adminRows = await DatabaseService.query<{
            admin_id: string;
            tenant_id: string;
            tenant_key: string;
            tenant_name: string;
            role: 'owner' | 'admin' | 'manager' | 'staff';
            store_ids: string[] | null;
        }>(
            `SELECT a.id AS admin_id,
                    a.tenant_id,
                    t.slug AS tenant_key,
                    t.name AS tenant_name,
                    a.role,
                    a.store_ids
             FROM admins a
             INNER JOIN tenants t
                ON t.id = a.tenant_id
             WHERE a.firebase_uid = $1
               AND a.is_active = true
               AND t.status IN ('active', 'trial')
             ORDER BY a.created_at DESC`,
            [decoded.uid]
        );

        if (adminRows.length === 0) {
            throw new AuthorizationError('管理者として登録されていません');
        }

        const tenantIds = [...new Set(adminRows.map((row) => row.tenant_id))];
        const storeRows = tenantIds.length > 0
            ? await DatabaseService.query<{ tenant_id: string; id: string }>(
                `SELECT tenant_id, id
                 FROM stores
                 WHERE tenant_id = ANY($1::uuid[])
                   AND status = 'active'
                 ORDER BY display_order ASC, created_at ASC`,
                [tenantIds]
            )
            : [];

        const activeStoreIdsByTenant = new Map<string, string[]>();
        for (const row of storeRows) {
            const list = activeStoreIdsByTenant.get(row.tenant_id) ?? [];
            list.push(row.id);
            activeStoreIdsByTenant.set(row.tenant_id, list);
        }

        const availableTenantMap = new Map<string, {
            tenantKey: string;
            tenantId: string;
            tenantName: string;
            adminRole: 'owner' | 'admin' | 'manager' | 'staff';
            storeIds: string[];
        }>();

        for (const row of adminRows) {
            const activeStoreIds = activeStoreIdsByTenant.get(row.tenant_id) ?? [];
            const scopedStoreIds = (row.store_ids ?? []).filter((id) => activeStoreIds.includes(id));
            availableTenantMap.set(row.tenant_id, {
                tenantKey: row.tenant_key,
                tenantId: row.tenant_id,
                tenantName: row.tenant_name,
                adminRole: row.role,
                storeIds: scopedStoreIds.length > 0 ? scopedStoreIds : activeStoreIds,
            });
        }
        const availableTenants = Array.from(availableTenantMap.values());

        let context = requestedTenantKey
            ? availableTenants.find((row) => row.tenantKey === requestedTenantKey)
            : availableTenants[0];

        if (!context && requestedTenantKey) {
            throw new AuthorizationError('指定した tenantKey の管理権限がありません');
        }
        if (!context) {
            throw new AuthorizationError('管理可能なテナントが見つかりません');
        }

        const response: ApiResponse<{
            tenantKey: string;
            tenantId: string;
            adminRole: 'owner' | 'admin' | 'manager' | 'staff';
            storeIds: string[];
            availableTenants: Array<{
                tenantKey: string;
                tenantId: string;
                tenantName: string;
                adminRole: 'owner' | 'admin' | 'manager' | 'staff';
                storeIds: string[];
            }>;
        }> = {
            success: true,
            data: {
                tenantKey: context.tenantKey,
                tenantId: context.tenantId,
                adminRole: context.adminRole,
                storeIds: context.storeIds,
                availableTenants,
            },
        };

        res.json(response);
    })
);

router.post(
    '/onboarding/register',
    ipLimiter,
    validateBody(registrationSchema),
    asyncHandler(async (req: Request, res: Response) => {
        if (!env.PUBLIC_ONBOARDING_ENABLED) {
            throw new ConflictError('現在は新規登録を受け付けていません');
        }

        const {
            idToken,
            tenantName,
            ownerName,
            storeName,
            timezone,
            address,
            phone,
        } = req.body as z.infer<typeof registrationSchema>;

        const auth = getAuthInstance();
        const decoded = await auth.verifyIdToken(idToken);

        const firebaseUid = decoded.uid;
        const email = decoded.email?.toLowerCase();
        if (!email) {
            throw new ValidationError('Firebase アカウントのメールアドレスが必要です');
        }

        consumeEmailQuota(email);

        const normalizedOwnerName = ownerName?.trim() || decoded.name?.trim() || email.split('@')[0];
        const normalizedStoreName = storeName?.trim() || `${tenantName.trim()} 本店`;

        const result = await onboardingService.register({
            firebaseUid,
            email,
            ownerName: normalizedOwnerName,
            tenantName: tenantName.trim(),
            storeName: normalizedStoreName,
            timezone,
            address,
            phone,
        });

        const response: ApiResponse<{
            tenantId: string;
            tenantKey: string;
            storeId: string;
            adminId: string;
        }> = {
            success: true,
            data: {
                tenantId: result.tenantId,
                tenantKey: result.tenantSlug,
                storeId: result.storeId,
                adminId: result.adminId,
            },
        };

        res.status(201).json(response);
    })
);

router.get(
    '/integrations/google-calendar/oauth/callback',
    asyncHandler(async (req: Request, res: Response) => {
        const code = req.query.code as string | undefined;
        const state = req.query.state as string | undefined;

        if (!code || !state) {
            throw new ValidationError('Google OAuth callback に必要なパラメータが不足しています');
        }

        const decodedState = decodeGoogleOAuthState(state);
        const tenantId = decodedState.tenantId;

        const service = createGoogleCalendarService(tenantId);
        const status = await service.exchangeCodeAndSave(code);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'google_calendar_integration',
            entityId: tenantId,
            actorType: 'system',
            actorId: 'google-oauth-platform-callback',
            actorName: 'Google OAuth Platform Callback',
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

export const platformOnboardingRoutes = router;
