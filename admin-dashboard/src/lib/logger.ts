/**
 * Browser-side logger utility.
 * In development, logs are output to the console.
 * In production, logs are suppressed (swap this file to integrate Sentry or another provider).
 */

const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
    error: (...args: unknown[]): void => {
        if (isDev) console.error(...args);
    },
    warn: (...args: unknown[]): void => {
        if (isDev) console.warn(...args);
    },
    info: (...args: unknown[]): void => {
        if (isDev) console.info(...args);
    },
};
