/**
 * Environment Configuration
 * Loads and validates environment variables
 */

import 'dotenv/config';

interface EnvConfig {
    // Server
    NODE_ENV: 'development' | 'production' | 'test';
    PORT: number;
    HOST: string;

    // Firebase (PRIVATE_KEY and CLIENT_EMAIL are optional when using ADC on Cloud Run)
    FIREBASE_PROJECT_ID: string;
    FIREBASE_SERVICE_ACCOUNT?: string;
    FIREBASE_PRIVATE_KEY?: string;
    FIREBASE_CLIENT_EMAIL?: string;
    FIREBASE_DATABASE_URL?: string;

    // Encryption
    ENCRYPTION_KEY: string;

    // CORS
    ALLOWED_ORIGINS: string[];

    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: number;
    RATE_LIMIT_MAX_REQUESTS: number;

    // Logging
    LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';
    WRITE_FREEZE_MODE: boolean;
    READINESS_REQUIRE_LINE: boolean;
    READINESS_REQUIRE_GOOGLE_OAUTH: boolean;
    PUBLIC_ONBOARDING_ENABLED: boolean;

    // LINE
    LINE_CHANNEL_ACCESS_TOKEN?: string;
    LINE_CHANNEL_SECRET?: string;
    LINE_CHANNEL_ID?: string;

    // Google Calendar OAuth
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_OAUTH_REDIRECT_URI?: string;
    GOOGLE_OAUTH_SCOPES: string[];

    // Database
    DB_HOST: string;
    DB_PORT: number;
    DB_USER: string;
    DB_PASSWORD: string;
    DB_NAME: string;
}

function getEnvString(key: string, defaultValue?: string): string {
    const value = process.env[key];
    if (value === undefined) {
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
    const value = process.env[key];
    if (value === undefined) {
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        throw new Error(`Missing required environment variable: ${key}`);
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        throw new Error(`Environment variable ${key} must be a number`);
    }
    return parsed;
}

function getEnvArray(key: string, defaultValue: string[] = []): string[] {
    const value = process.env[key];
    if (!value) {
        return defaultValue;
    }
    return value.split(',').map(s => s.trim()).filter(Boolean);
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (value === undefined) {
        return defaultValue;
    }
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function validateConfig(): EnvConfig {
    const nodeEnv = getEnvString('NODE_ENV', 'development');
    if (!['development', 'production', 'test'].includes(nodeEnv)) {
        throw new Error('NODE_ENV must be development, production, or test');
    }

    const isProduction = nodeEnv === 'production';

    const firebaseServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    let firebaseProjectIdDefault: string | undefined;
    let firebasePrivateKeyDefault: string | undefined;
    let firebaseClientEmailDefault: string | undefined;

    if (firebaseServiceAccount) {
        try {
            const parsed = JSON.parse(firebaseServiceAccount) as Record<string, unknown>;
            if (typeof parsed.project_id === 'string') firebaseProjectIdDefault = parsed.project_id;
            if (typeof parsed.private_key === 'string') firebasePrivateKeyDefault = parsed.private_key;
            if (typeof parsed.client_email === 'string') firebaseClientEmailDefault = parsed.client_email;
        } catch {
            // ignore; will fall back to explicit env vars / ADC
        }
    }

    // ENCRYPTION_KEY: Required in production, default allowed in development
    const encryptionKey = isProduction
        ? getEnvString('ENCRYPTION_KEY') // Required - no default
        : getEnvString('ENCRYPTION_KEY', 'development-key-32-bytes-long!!');

    // Validate encryption key length (32 bytes for AES-256)
    if (encryptionKey.length !== 32) {
        throw new Error('ENCRYPTION_KEY must be exactly 32 characters (bytes) for AES-256');
    }

    // DB_PASSWORD: Required in production, default allowed in development
    const dbPassword = isProduction
        ? getEnvString('DB_PASSWORD') // Required - no default
        : getEnvString('DB_PASSWORD', 'change_me');

    // Warn about default values in development
    if (!isProduction) {
        if (encryptionKey === 'development-key-32-bytes-long!!') {
            console.warn('⚠️  Using default ENCRYPTION_KEY. Set a secure key for production!');
        }
        if (dbPassword === 'change_me') {
            console.warn('⚠️  Using default DB_PASSWORD. Set a secure password for production!');
        }
    }

    return {
        // Server
        NODE_ENV: nodeEnv as EnvConfig['NODE_ENV'],
        PORT: getEnvNumber('PORT', 8080),
        HOST: getEnvString('HOST', '0.0.0.0'),

        // Firebase
        FIREBASE_PROJECT_ID: getEnvString(
            'FIREBASE_PROJECT_ID',
            firebaseProjectIdDefault ?? (isProduction ? undefined : 'demo-project')
        ),
        FIREBASE_SERVICE_ACCOUNT: firebaseServiceAccount,
        FIREBASE_PRIVATE_KEY: getEnvString('FIREBASE_PRIVATE_KEY', firebasePrivateKeyDefault ?? '').replace(/\\n/g, '\n'),
        FIREBASE_CLIENT_EMAIL: getEnvString('FIREBASE_CLIENT_EMAIL', firebaseClientEmailDefault ?? ''),
        FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL,

        // Encryption (32 bytes for AES-256)
        ENCRYPTION_KEY: encryptionKey,

        // CORS
        ALLOWED_ORIGINS: getEnvArray('ALLOWED_ORIGINS', isProduction ? [] : [
            'https://liff.line.me',
            'http://localhost:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3000'
        ]),

        // Rate Limiting
        RATE_LIMIT_WINDOW_MS: getEnvNumber('RATE_LIMIT_WINDOW_MS', 60000),
        RATE_LIMIT_MAX_REQUESTS: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100),

        // Logging
        LOG_LEVEL: getEnvString('LOG_LEVEL', isProduction ? 'info' : 'debug') as EnvConfig['LOG_LEVEL'],
        WRITE_FREEZE_MODE: getEnvBoolean('WRITE_FREEZE_MODE', false),
        READINESS_REQUIRE_LINE: getEnvBoolean('READINESS_REQUIRE_LINE', false),
        READINESS_REQUIRE_GOOGLE_OAUTH: getEnvBoolean('READINESS_REQUIRE_GOOGLE_OAUTH', true),
        PUBLIC_ONBOARDING_ENABLED: getEnvBoolean('PUBLIC_ONBOARDING_ENABLED', true),

        // LINE
        LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
        LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
        LINE_CHANNEL_ID: process.env.LINE_CHANNEL_ID,

        // Google Calendar OAuth
        GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,
        GOOGLE_OAUTH_SCOPES: getEnvArray(
            'GOOGLE_OAUTH_SCOPES',
            ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar']
        ),

        // Database
        DB_HOST: getEnvString('DB_HOST', '127.0.0.1'),
        DB_PORT: getEnvNumber('DB_PORT', 5432),
        DB_USER: getEnvString('DB_USER', 'app_user'),
        DB_PASSWORD: dbPassword,
        DB_NAME: getEnvString('DB_NAME', 'reservation_system'),
    };
}

export const env = validateConfig();

// Print config info on startup (without secrets)
export function logConfig(): void {
    console.log('📝 Configuration:');
    console.log(`   Environment: ${env.NODE_ENV}`);
    console.log(`   Port: ${env.PORT}`);
    console.log(`   Firebase Project: ${env.FIREBASE_PROJECT_ID}`);
    console.log(`   Allowed Origins: ${env.ALLOWED_ORIGINS.join(', ')}`);
    console.log(`   Write Freeze Mode: ${env.WRITE_FREEZE_MODE}`);
    console.log(`   Readiness Require LINE: ${env.READINESS_REQUIRE_LINE}`);
    console.log(`   Readiness Require Google OAuth: ${env.READINESS_REQUIRE_GOOGLE_OAUTH}`);
    console.log(`   Public Onboarding Enabled: ${env.PUBLIC_ONBOARDING_ENABLED}`);
}
