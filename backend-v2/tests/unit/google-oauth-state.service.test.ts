import { beforeAll, describe, expect, it } from 'vitest';

let encodeGoogleOAuthState: typeof import('../../src/services/google-oauth-state.service.js').encodeGoogleOAuthState;
let decodeGoogleOAuthState: typeof import('../../src/services/google-oauth-state.service.js').decodeGoogleOAuthState;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    const module = await import('../../src/services/google-oauth-state.service.js');
    encodeGoogleOAuthState = module.encodeGoogleOAuthState;
    decodeGoogleOAuthState = module.decodeGoogleOAuthState;
});

describe('google-oauth-state-service', () => {
    it('decodes valid state payload', () => {
        const state = encodeGoogleOAuthState({
            tenantId: 'tenant-1',
            issuedAt: Date.now(),
        });

        const decoded = decodeGoogleOAuthState(state);
        expect(decoded.tenantId).toBe('tenant-1');
    });

    it('throws when signature is invalid', () => {
        const state = encodeGoogleOAuthState({
            tenantId: 'tenant-1',
            issuedAt: Date.now(),
        });

        const [body] = state.split('.');
        expect(() => decodeGoogleOAuthState(`${body}.invalid`)).toThrowError('Invalid OAuth state signature');
    });

    it('throws when state is expired', () => {
        const state = encodeGoogleOAuthState({
            tenantId: 'tenant-1',
            issuedAt: Date.now() - (11 * 60 * 1000),
        });

        expect(() => decodeGoogleOAuthState(state, { ttlMs: 10 * 60 * 1000 })).toThrowError(
            'OAuth state の有効期限が切れています'
        );
    });

    it('throws when expected tenant does not match', () => {
        const state = encodeGoogleOAuthState({
            tenantId: 'tenant-1',
            issuedAt: Date.now(),
        });

        expect(() => decodeGoogleOAuthState(state, { expectedTenantId: 'tenant-2' })).toThrowError(
            'OAuth state tenant mismatch'
        );
    });
});
