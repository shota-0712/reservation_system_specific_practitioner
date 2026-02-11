import { beforeAll, describe, expect, it } from 'vitest';

type ReadinessChecks = {
    database: boolean;
    firebase: boolean;
    line: boolean;
    lineConfigured: boolean;
    googleOauthConfigured: boolean;
    writeFreezeMode: boolean;
};

let deriveReadyStatus: (checks: ReadinessChecks, strictLine: boolean, requireGoogleOAuth?: boolean) => boolean;

function createChecks(overrides: Partial<ReadinessChecks> = {}): ReadinessChecks {
    return {
        database: true,
        firebase: true,
        line: true,
        lineConfigured: true,
        googleOauthConfigured: true,
        writeFreezeMode: false,
        ...overrides,
    };
}

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    const module = await import('../../src/services/readiness.service.js');
    deriveReadyStatus = module.deriveReadyStatus;
});

describe('readiness service', () => {
    it('returns ready in non-strict mode even if line check fails', () => {
        const checks = createChecks({ line: false, lineConfigured: false });
        expect(deriveReadyStatus(checks, false)).toBe(true);
    });

    it('returns not ready in strict mode when line check fails', () => {
        const checks = createChecks({ line: false });
        expect(deriveReadyStatus(checks, true)).toBe(false);
    });

    it('returns not ready in strict mode when google oauth is not configured', () => {
        const checks = createChecks({ googleOauthConfigured: false });
        expect(deriveReadyStatus(checks, true, true)).toBe(false);
    });

    it('returns ready when google oauth is not required', () => {
        const checks = createChecks({ googleOauthConfigured: false });
        expect(deriveReadyStatus(checks, false, false)).toBe(true);
    });

    it('returns not ready when database check fails', () => {
        const checks = createChecks({ database: false });
        expect(deriveReadyStatus(checks, false)).toBe(false);
    });

    it('returns not ready when firebase check fails', () => {
        const checks = createChecks({ firebase: false });
        expect(deriveReadyStatus(checks, false)).toBe(false);
    });
});
