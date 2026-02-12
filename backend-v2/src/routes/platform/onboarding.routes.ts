import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { getAuthInstance } from '../../config/firebase.js';
import { env } from '../../config/env.js';
import { asyncHandler, validateBody } from '../../middleware/index.js';
import { createGoogleCalendarService } from '../../services/google-calendar.service.js';
import { decodeGoogleOAuthState } from '../../services/google-oauth-state.service.js';
import { createOnboardingService } from '../../services/onboarding.service.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import { ConflictError, RateLimitError, ValidationError } from '../../utils/errors.js';
import type { ApiResponse } from '../../types/index.js';

const router = Router();
const onboardingService = createOnboardingService();

const emailRateLimitStore = new Map<string, { count: number; resetAt: number }>();
const emailRateLimitWindowMs = 15 * 60 * 1000;
const emailRateLimitMax = 5;
const slugPattern = '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$';

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

router.get(
    '/onboarding/registration-config',
    asyncHandler(async (_req: Request, res: Response) => {
        const response: ApiResponse<{
            enabled: boolean;
            slugPattern: string;
            slugMinLength: number;
            slugMaxLength: number;
        }> = {
            success: true,
            data: {
                enabled: env.PUBLIC_ONBOARDING_ENABLED,
                slugPattern,
                slugMinLength: 3,
                slugMaxLength: 40,
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

        const response: ApiResponse = {
            success: true,
            data: status,
        };
        res.json(response);
    })
);

export const platformOnboardingRoutes = router;
