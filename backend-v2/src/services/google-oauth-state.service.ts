import { createHmac } from 'crypto';
import { env } from '../config/env.js';
import { ValidationError } from '../utils/errors.js';

export interface GoogleOAuthStatePayload {
    tenantId: string;
    issuedAt: number;
    redirectTo?: string;
}

const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000;

export function encodeGoogleOAuthState(payload: GoogleOAuthStatePayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', env.ENCRYPTION_KEY).update(body).digest('base64url');
    return `${body}.${signature}`;
}

export function decodeGoogleOAuthState(
    state: string,
    options: {
        ttlMs?: number;
        expectedTenantId?: string;
    } = {}
): GoogleOAuthStatePayload {
    const [body, signature] = state.split('.');
    if (!body || !signature) {
        throw new ValidationError('Invalid OAuth state');
    }

    const expected = createHmac('sha256', env.ENCRYPTION_KEY).update(body).digest('base64url');
    if (expected !== signature) {
        throw new ValidationError('Invalid OAuth state signature');
    }

    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as Partial<GoogleOAuthStatePayload>;
    if (!decoded.tenantId || !decoded.issuedAt) {
        throw new ValidationError('Invalid OAuth state payload');
    }

    const ttlMs = options.ttlMs ?? DEFAULT_STATE_TTL_MS;
    if (Date.now() - decoded.issuedAt > ttlMs) {
        throw new ValidationError('OAuth state の有効期限が切れています');
    }

    if (options.expectedTenantId && decoded.tenantId !== options.expectedTenantId) {
        throw new ValidationError('OAuth state tenant mismatch');
    }

    return {
        tenantId: decoded.tenantId,
        issuedAt: decoded.issuedAt,
        redirectTo: decoded.redirectTo,
    };
}
