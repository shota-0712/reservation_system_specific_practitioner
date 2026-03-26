import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const onboardingRouteState = vi.hoisted(() => ({
    findBySlug: vi.fn(),
    resolveToken: vi.fn(),
    verifyIdToken: vi.fn(),
    isSlugAvailable: vi.fn(),
    register: vi.fn(),
}));

vi.mock('../../src/config/firebase.js', () => ({
    initializeFirebase: vi.fn(),
    getAuthInstance: () => ({
        verifyIdToken: onboardingRouteState.verifyIdToken,
        setCustomUserClaims: vi.fn(),
    }),
}));

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        query: vi.fn(),
        queryOne: vi.fn(),
        transaction: vi.fn(),
        setTenantContext: vi.fn(),
    },
}));

vi.mock('../../src/config/env.js', () => ({
    env: {
        PUBLIC_ONBOARDING_ENABLED: true,
        NODE_ENV: 'test',
    },
}));

vi.mock('../../src/repositories/index.js', () => ({
    createTenantRepository: () => ({
        findBySlug: onboardingRouteState.findBySlug,
    }),
}));

vi.mock('../../src/services/booking-link-token.service.js', () => ({
    createBookingLinkTokenService: (tenantId?: string) => ({
        resolve: (token: string) => onboardingRouteState.resolveToken(tenantId, token),
    }),
}));

vi.mock('../../src/services/google-calendar.service.js', () => ({
    createGoogleCalendarService: vi.fn(() => ({})),
}));

vi.mock('../../src/services/google-oauth-state.service.js', () => ({
    decodeGoogleOAuthState: vi.fn(),
}));

vi.mock('../../src/services/admin-claims-sync.service.js', () => ({
    resolveTenantIdForClaimsSync: vi.fn(),
}));

vi.mock('../../src/services/onboarding.service.js', () => ({
    createOnboardingService: () => ({
        isSlugAvailable: onboardingRouteState.isSlugAvailable,
        register: onboardingRouteState.register,
    }),
}));

vi.mock('../../src/services/audit-log.service.js', () => ({
    getRequestMeta: vi.fn(() => ({})),
    writeAuditLog: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    logError: vi.fn(),
    logRequest: vi.fn(),
}));

let platformOnboardingRoutes: typeof import('../../src/routes/platform/onboarding.routes.js').platformOnboardingRoutes;
let server: Server;
let baseUrl: string;

const activeResolvedPayload = {
    tenantKey: 'smoke-salon-1774332932',
    tenantId: 'c82a0a31-7c1c-4a39-b5a9-2b4ccd5f1d4b',
    practitionerId: 'c2ba9847-04fb-4fb8-9669-d54e34e498c1',
    lineMode: 'tenant' as const,
    lineConfigSource: 'tenant' as const,
};

beforeAll(async () => {
    ({ platformOnboardingRoutes } = await import('../../src/routes/platform/onboarding.routes.js'));

    const app = express();
    app.use(express.json());
    app.use('/api/platform/v1', platformOnboardingRoutes);
    app.use((error: any, _req: any, res: any, _next: any) => {
        res.status(error?.statusCode ?? 500).json({
            success: false,
            error: {
                code: error?.code ?? 'INTERNAL_ERROR',
                message: error?.message ?? 'unexpected error',
            },
        });
    });

    server = await new Promise<Server>((resolve) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
});

beforeEach(() => {
    onboardingRouteState.findBySlug.mockResolvedValue({
        id: 'tenant-1',
        slug: 'smoke-salon-1774332932',
        status: 'active',
    });
    onboardingRouteState.resolveToken.mockImplementation(async (tenantId: string | undefined, token: string) => {
        if (token === 'A23456789012345678901234567890') {
            return activeResolvedPayload;
        }
        if (token === 'B23456789012345678901234567890') {
            return null;
        }
        if (token === 'C23456789012345678901234567890') {
            throw new Error('database regression');
        }
        return null;
    });
});

afterEach(() => {
    vi.clearAllMocks();
});

async function requestJson(path: string) {
    const response = await fetch(`${baseUrl}${path}`);
    const json = await response.json();
    return { response, json };
}

describe('platform onboarding public routes integration', () => {
    it('returns 200 for token-only active resolve and keeps the success payload unchanged', async () => {
        const { response, json } = await requestJson(
            '/api/platform/v1/booking-links/resolve?token=A23456789012345678901234567890'
        );

        expect(response.status).toBe(200);
        expect(json).toEqual({
            success: true,
            data: activeResolvedPayload,
        });
        expect(onboardingRouteState.resolveToken).toHaveBeenCalledWith(undefined, 'A23456789012345678901234567890');
    });

    it('returns 200 for the tenant-scoped resolve variant for the same token', async () => {
        const { response, json } = await requestJson(
            '/api/platform/v1/booking-links/resolve?token=A23456789012345678901234567890&tenantKey=smoke-salon-1774332932'
        );

        expect(response.status).toBe(200);
        expect(json).toEqual({
            success: true,
            data: activeResolvedPayload,
        });
        expect(onboardingRouteState.findBySlug).toHaveBeenCalledWith('smoke-salon-1774332932');
        expect(onboardingRouteState.resolveToken).toHaveBeenCalledWith('tenant-1', 'A23456789012345678901234567890');
    });

    it('returns 404 for unknown or expired tokens', async () => {
        const { response, json } = await requestJson(
            '/api/platform/v1/booking-links/resolve?token=B23456789012345678901234567890'
        );

        expect(response.status).toBe(404);
        expect(json).toEqual({
            success: false,
            error: {
                code: 'NOT_FOUND',
                message: '予約URLが見つかりません',
            },
        });
    });

    it('keeps true unexpected faults as 500 responses', async () => {
        const { response, json } = await requestJson(
            '/api/platform/v1/booking-links/resolve?token=C23456789012345678901234567890'
        );

        expect(response.status).toBe(500);
        expect(json.error.code).toBe('INTERNAL_ERROR');
        expect(json.error.message).toBe('database regression');
    });
});
