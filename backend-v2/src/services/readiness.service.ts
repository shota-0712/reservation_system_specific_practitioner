import { DatabaseService } from '../config/database.js';
import { env } from '../config/env.js';
import { getAuthInstance } from '../config/firebase.js';
import { decrypt } from '../utils/crypto.js';
import { GoogleCalendarService } from './google-calendar.service.js';

const LINE_VERIFY_URL = 'https://api.line.me/v2/bot/info';
const LINE_VERIFY_TIMEOUT_MS = 3000;

interface TenantLineTokenRow {
    line_channel_access_token_encrypted?: string | null;
}

export interface ReadinessChecks {
    database: boolean;
    firebase: boolean;
    line: boolean;
    lineConfigured: boolean;
    googleOauthConfigured: boolean;
    writeFreezeMode: boolean;
}

export interface ReadinessResult {
    ready: boolean;
    checks: ReadinessChecks;
    required: {
        database: true;
        firebase: true;
        line: boolean;
        googleOauthConfigured: boolean;
    };
}

function normalizeLineToken(token: string): string {
    try {
        return decrypt(token);
    } catch {
        // Backward compatibility: allow plain token in legacy/dev rows.
        return token;
    }
}

async function fetchTenantLineToken(): Promise<string | null> {
    const row = await DatabaseService.queryOne<TenantLineTokenRow>(
        `SELECT line_channel_access_token_encrypted
         FROM tenants
         WHERE line_channel_access_token_encrypted IS NOT NULL
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 1`
    );

    if (!row?.line_channel_access_token_encrypted) {
        return null;
    }

    return normalizeLineToken(row.line_channel_access_token_encrypted);
}

async function resolveLineToken(): Promise<string | null> {
    if (env.LINE_CHANNEL_ACCESS_TOKEN) {
        return normalizeLineToken(env.LINE_CHANNEL_ACCESS_TOKEN);
    }

    return fetchTenantLineToken();
}

async function verifyLineConnection(token: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINE_VERIFY_TIMEOUT_MS);

    try {
        const response = await fetch(LINE_VERIFY_URL, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
        });

        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

export function deriveReadyStatus(
    checks: ReadinessChecks,
    strictLine: boolean,
    requireGoogleOAuth = env.READINESS_REQUIRE_GOOGLE_OAUTH
): boolean {
    if (!checks.database || !checks.firebase) {
        return false;
    }

    if (strictLine && !checks.line) {
        return false;
    }

    if (requireGoogleOAuth && !checks.googleOauthConfigured) {
        return false;
    }

    return true;
}

export async function checkReadiness(): Promise<ReadinessResult> {
    const checks: ReadinessChecks = {
        database: false,
        firebase: false,
        line: false,
        lineConfigured: false,
        googleOauthConfigured: GoogleCalendarService.isConfigured(),
        writeFreezeMode: env.WRITE_FREEZE_MODE,
    };

    try {
        const row = await DatabaseService.queryOne<{ ok?: number }>('SELECT 1 as ok');
        checks.database = Boolean(row?.ok === 1);
    } catch {
        checks.database = false;
    }

    try {
        getAuthInstance();
        checks.firebase = true;
    } catch {
        checks.firebase = false;
    }

    if (checks.database) {
        try {
            const lineToken = await resolveLineToken();
            checks.lineConfigured = Boolean(lineToken);
            checks.line = lineToken ? await verifyLineConnection(lineToken) : false;
        } catch {
            checks.lineConfigured = false;
            checks.line = false;
        }
    }

    const strictLine = env.READINESS_REQUIRE_LINE;
    const ready = deriveReadyStatus(checks, strictLine, env.READINESS_REQUIRE_GOOGLE_OAUTH);

    return {
        ready,
        checks,
        required: {
            database: true,
            firebase: true,
            line: env.READINESS_REQUIRE_LINE,
            googleOauthConfigured: env.READINESS_REQUIRE_GOOGLE_OAUTH,
        },
    };
}
