/**
 * Browser-side logger utility.
 * In development, logs are output to the console.
 * In production, logs are suppressed (swap this file to integrate Sentry or another provider).
 */

const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
    error: (msg: string, ...args: unknown[]): void => {
        if (isDev) console.error(msg, ...args);
    },
    warn: (msg: string, ...args: unknown[]): void => {
        if (isDev) console.warn(msg, ...args);
    },
    info: (msg: string, ...args: unknown[]): void => {
        if (isDev) console.info(msg, ...args);
    },
};
