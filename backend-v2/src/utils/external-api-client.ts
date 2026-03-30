/**
 * Shared external API client with timeout, retry, circuit breaker, and telemetry.
 */

import { env } from '../config/env.js';
import { logger } from './logger.js';

const DEFAULT_RETRYABLE_STATUS_CODES = [408, 425, 429, 500, 502, 503, 504];
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EPIPE',
]);

interface CircuitState {
    consecutiveFailures: number;
    openedUntil: number | null;
}

export interface ExternalApiMetricSnapshot {
    attempts: number;
    successes: number;
    failures: number;
    retries: number;
    timeouts: number;
    circuitOpen: number;
    totalDurationMs: number;
    maxDurationMs: number;
    lastStatus?: number;
    lastErrorKind?: string;
    lastFailureAt?: string;
}

export interface ExternalApiRequestOptions extends RequestInit {
    service: string;
    operation: string;
    tenantId?: string;
    timeoutMs?: number;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    enableRetries?: boolean;
    retryableStatusCodes?: number[];
    circuitBreakerKey?: string;
    circuitBreakerFailureThreshold?: number;
    circuitBreakerCooldownMs?: number;
    metadata?: Record<string, unknown>;
}

export type ExternalApiErrorKind = 'timeout' | 'network' | 'circuit_open' | 'aborted';

export class ExternalApiRequestError extends Error {
    readonly service: string;
    readonly operation: string;
    readonly kind: ExternalApiErrorKind;
    readonly retryable: boolean;
    readonly details?: Record<string, unknown>;
    override readonly cause?: unknown;

    constructor(
        message: string,
        options: {
            service: string;
            operation: string;
            kind: ExternalApiErrorKind;
            retryable: boolean;
            details?: Record<string, unknown>;
            cause?: unknown;
        }
    ) {
        super(message);
        this.name = 'ExternalApiRequestError';
        this.service = options.service;
        this.operation = options.operation;
        this.kind = options.kind;
        this.retryable = options.retryable;
        this.details = options.details;
        this.cause = options.cause;
    }
}

const circuitStates = new Map<string, CircuitState>();
const metricSnapshots = new Map<string, ExternalApiMetricSnapshot>();

function normalizeMethod(method?: string): string {
    return (method ?? 'GET').toUpperCase();
}

function isIdempotentMethod(method: string): boolean {
    return IDEMPOTENT_METHODS.has(method);
}

function getMetricKey(service: string, operation: string): string {
    return `${service}:${operation}`;
}

function getMetricSnapshot(service: string, operation: string): ExternalApiMetricSnapshot {
    const key = getMetricKey(service, operation);
    const existing = metricSnapshots.get(key);

    if (existing) {
        return existing;
    }

    const created: ExternalApiMetricSnapshot = {
        attempts: 0,
        successes: 0,
        failures: 0,
        retries: 0,
        timeouts: 0,
        circuitOpen: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
    };
    metricSnapshots.set(key, created);
    return created;
}

function recordMetric(
    service: string,
    operation: string,
    update: Partial<ExternalApiMetricSnapshot>
): void {
    const snapshot = getMetricSnapshot(service, operation);
    snapshot.attempts += update.attempts ?? 0;
    snapshot.successes += update.successes ?? 0;
    snapshot.failures += update.failures ?? 0;
    snapshot.retries += update.retries ?? 0;
    snapshot.timeouts += update.timeouts ?? 0;
    snapshot.circuitOpen += update.circuitOpen ?? 0;
    snapshot.totalDurationMs += update.totalDurationMs ?? 0;
    snapshot.maxDurationMs = Math.max(snapshot.maxDurationMs, update.maxDurationMs ?? 0);

    if (update.lastStatus !== undefined) {
        snapshot.lastStatus = update.lastStatus;
    }
    if (update.lastErrorKind !== undefined) {
        snapshot.lastErrorKind = update.lastErrorKind;
        snapshot.lastFailureAt = new Date().toISOString();
    }
}

function getCircuitState(key: string): CircuitState {
    const existing = circuitStates.get(key);
    if (existing) {
        return existing;
    }

    const created: CircuitState = {
        consecutiveFailures: 0,
        openedUntil: null,
    };
    circuitStates.set(key, created);
    return created;
}

function resetCircuit(key: string): void {
    const state = getCircuitState(key);
    state.consecutiveFailures = 0;
    state.openedUntil = null;
}

function registerRetryableFailure(
    key: string,
    failureThreshold: number,
    cooldownMs: number
): { consecutiveFailures: number; openedUntil: number | null } {
    const state = getCircuitState(key);
    state.consecutiveFailures += 1;

    if (state.consecutiveFailures >= failureThreshold) {
        state.openedUntil = Date.now() + cooldownMs;
    }

    return {
        consecutiveFailures: state.consecutiveFailures,
        openedUntil: state.openedUntil,
    };
}

function throwIfCircuitOpen(
    key: string,
    service: string,
    operation: string,
    tenantId?: string,
    metadata?: Record<string, unknown>
): void {
    const state = getCircuitState(key);
    const now = Date.now();

    if (state.openedUntil && state.openedUntil <= now) {
        resetCircuit(key);
        return;
    }

    if (!state.openedUntil) {
        return;
    }

    recordMetric(service, operation, {
        failures: 1,
        circuitOpen: 1,
        lastErrorKind: 'circuit_open',
    });

    logger.warn('External API circuit breaker is open', {
        type: 'external_api',
        service,
        operation,
        tenantId,
        openedUntil: new Date(state.openedUntil).toISOString(),
        ...metadata,
    });

    throw new ExternalApiRequestError(
        `${service} ${operation} is temporarily unavailable because the circuit breaker is open`,
        {
            service,
            operation,
            kind: 'circuit_open',
            retryable: true,
            details: {
                openedUntil: state.openedUntil,
            },
        }
    );
}

function createMergedSignal(
    primary?: AbortSignal,
    secondary?: AbortSignal
): { signal?: AbortSignal; cleanup: () => void } {
    if (!primary && !secondary) {
        return { cleanup: () => undefined };
    }

    if (!primary) {
        return { signal: secondary, cleanup: () => undefined };
    }

    if (!secondary) {
        return { signal: primary, cleanup: () => undefined };
    }

    const controller = new AbortController();

    const abortFrom = (signal: AbortSignal) => {
        if (!controller.signal.aborted) {
            controller.abort(signal.reason);
        }
    };

    const onPrimaryAbort = () => abortFrom(primary);
    const onSecondaryAbort = () => abortFrom(secondary);

    if (primary.aborted) {
        abortFrom(primary);
    } else if (secondary.aborted) {
        abortFrom(secondary);
    } else {
        primary.addEventListener('abort', onPrimaryAbort);
        secondary.addEventListener('abort', onSecondaryAbort);
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            primary.removeEventListener('abort', onPrimaryAbort);
            secondary.removeEventListener('abort', onSecondaryAbort);
        },
    };
}

function sleep(ms: number): Promise<void> {
    if (ms <= 0) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function sanitizeUrl(input: string | URL | Request): string {
    const raw = typeof input === 'string'
        ? input
        : input instanceof URL
            ? input.toString()
            : input.url;

    try {
        const url = new URL(raw);
        return `${url.origin}${url.pathname}`;
    } catch {
        return raw;
    }
}

function getErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
        return undefined;
    }

    const maybeCode = (error as { code?: unknown }).code;
    if (typeof maybeCode === 'string') {
        return maybeCode;
    }

    const maybeCauseCode = (error as { cause?: { code?: unknown } }).cause?.code;
    return typeof maybeCauseCode === 'string' ? maybeCauseCode : undefined;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function isRetryableNetworkError(error: unknown): boolean {
    if (error instanceof ExternalApiRequestError) {
        return error.retryable;
    }

    if (error instanceof TypeError) {
        return true;
    }

    const code = getErrorCode(error);
    return code ? RETRYABLE_NETWORK_ERROR_CODES.has(code) : false;
}

function normalizeRequestError(
    error: unknown,
    context: {
        service: string;
        operation: string;
        timeoutMs: number;
        timeoutTriggered: boolean;
        abortedByCaller: boolean;
        method: string;
        requestUrl: string;
    }
): ExternalApiRequestError {
    if (error instanceof ExternalApiRequestError) {
        return error;
    }

    if (context.timeoutTriggered) {
        return new ExternalApiRequestError(
            `${context.service} ${context.operation} timed out after ${context.timeoutMs}ms`,
            {
                service: context.service,
                operation: context.operation,
                kind: 'timeout',
                retryable: true,
                details: {
                    timeoutMs: context.timeoutMs,
                    method: context.method,
                    requestUrl: context.requestUrl,
                },
                cause: error,
            }
        );
    }

    if (context.abortedByCaller || isAbortError(error)) {
        return new ExternalApiRequestError(
            `${context.service} ${context.operation} was aborted`,
            {
                service: context.service,
                operation: context.operation,
                kind: 'aborted',
                retryable: false,
                details: {
                    method: context.method,
                    requestUrl: context.requestUrl,
                },
                cause: error,
            }
        );
    }

    const code = getErrorCode(error);
    return new ExternalApiRequestError(
        `${context.service} ${context.operation} request failed`,
        {
            service: context.service,
            operation: context.operation,
            kind: 'network',
            retryable: isRetryableNetworkError(error),
            details: {
                method: context.method,
                requestUrl: context.requestUrl,
                code,
            },
            cause: error,
        }
    );
}

function parseRetryAfter(header: string | null): number | null {
    if (!header) {
        return null;
    }

    const asSeconds = Number(header);
    if (!Number.isNaN(asSeconds)) {
        return Math.max(0, asSeconds * 1000);
    }

    const asDate = Date.parse(header);
    if (Number.isNaN(asDate)) {
        return null;
    }

    return Math.max(0, asDate - Date.now());
}

function getRetryDelayMs(
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number,
    retryAfterHeader: string | null
): number {
    const retryAfterMs = parseRetryAfter(retryAfterHeader);
    if (retryAfterMs !== null) {
        return Math.min(retryAfterMs, maxDelayMs);
    }

    return Math.min(baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)), maxDelayMs);
}

export function isRetryableHttpStatus(
    status: number,
    retryableStatusCodes: number[] = DEFAULT_RETRYABLE_STATUS_CODES
): boolean {
    return retryableStatusCodes.includes(status);
}

export function getExternalApiMetricsSnapshot(): Record<string, ExternalApiMetricSnapshot> {
    return Object.fromEntries(
        Array.from(metricSnapshots.entries()).map(([key, value]) => [
            key,
            {
                ...value,
            },
        ])
    );
}

export function resetExternalApiClientState(): void {
    circuitStates.clear();
    metricSnapshots.clear();
}

export async function fetchWithResilience(
    input: string | URL | Request,
    options: ExternalApiRequestOptions
): Promise<Response> {
    const {
        service,
        operation,
        tenantId,
        timeoutMs = env.EXTERNAL_API_TIMEOUT_MS,
        maxRetries = env.EXTERNAL_API_MAX_RETRIES,
        baseDelayMs = env.EXTERNAL_API_RETRY_BASE_DELAY_MS,
        maxDelayMs = env.EXTERNAL_API_RETRY_MAX_DELAY_MS,
        enableRetries,
        retryableStatusCodes = DEFAULT_RETRYABLE_STATUS_CODES,
        circuitBreakerKey = `${service}:${operation}`,
        circuitBreakerFailureThreshold = env.EXTERNAL_API_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        circuitBreakerCooldownMs = env.EXTERNAL_API_CIRCUIT_BREAKER_COOLDOWN_MS,
        metadata,
        signal,
        ...requestInit
    } = options;

    const method = normalizeMethod(requestInit.method);
    const retryEnabled = enableRetries ?? isIdempotentMethod(method);
    const totalAttempts = retryEnabled ? Math.max(1, maxRetries + 1) : 1;
    const requestUrl = sanitizeUrl(input);

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        throwIfCircuitOpen(circuitBreakerKey, service, operation, tenantId, metadata);

        const timeoutController = new AbortController();
        let timeoutTriggered = false;
        const timeoutId = setTimeout(() => {
            timeoutTriggered = true;
            timeoutController.abort();
        }, timeoutMs);

        const { signal: mergedSignal, cleanup } = createMergedSignal(signal, timeoutController.signal);
        const attemptStartedAt = Date.now();

        try {
            const response = await fetch(input, {
                ...requestInit,
                method,
                signal: mergedSignal,
            });
            const durationMs = Date.now() - attemptStartedAt;

            recordMetric(service, operation, {
                attempts: 1,
                totalDurationMs: durationMs,
                maxDurationMs: durationMs,
                lastStatus: response.status,
            });

            if (response.ok) {
                resetCircuit(circuitBreakerKey);
                recordMetric(service, operation, {
                    successes: 1,
                });
                return response;
            }

            const retryableStatus = isRetryableHttpStatus(response.status, retryableStatusCodes);
            if (!retryableStatus) {
                resetCircuit(circuitBreakerKey);
            }

            const circuitResult = retryableStatus
                ? registerRetryableFailure(
                    circuitBreakerKey,
                    circuitBreakerFailureThreshold,
                    circuitBreakerCooldownMs
                )
                : null;
            const shouldRetry = retryableStatus
                && retryEnabled
                && attempt < totalAttempts
                && !circuitResult?.openedUntil;

            recordMetric(service, operation, {
                failures: 1,
                lastErrorKind: retryableStatus ? 'network' : undefined,
            });

            if (shouldRetry) {
                const delayMs = getRetryDelayMs(
                    attempt,
                    baseDelayMs,
                    maxDelayMs,
                    response.headers.get('retry-after')
                );

                recordMetric(service, operation, {
                    retries: 1,
                });

                logger.warn('External API retry scheduled after upstream response', {
                    type: 'external_api',
                    service,
                    operation,
                    tenantId,
                    method,
                    requestUrl,
                    attempt,
                    totalAttempts,
                    delayMs,
                    status: response.status,
                    consecutiveFailures: circuitResult?.consecutiveFailures,
                    ...metadata,
                });

                await sleep(delayMs);
                continue;
            }

            logger.error('External API request returned a non-ok response', {
                type: 'external_api',
                service,
                operation,
                tenantId,
                method,
                requestUrl,
                attempt,
                totalAttempts,
                status: response.status,
                retryableStatus,
                consecutiveFailures: circuitResult?.consecutiveFailures,
                circuitOpenedUntil: circuitResult?.openedUntil
                    ? new Date(circuitResult.openedUntil).toISOString()
                    : undefined,
                ...metadata,
            });

            return response;
        } catch (error) {
            const durationMs = Date.now() - attemptStartedAt;
            const normalizedError = normalizeRequestError(error, {
                service,
                operation,
                timeoutMs,
                timeoutTriggered,
                abortedByCaller: Boolean(signal?.aborted && !timeoutTriggered),
                method,
                requestUrl,
            });

            recordMetric(service, operation, {
                attempts: 1,
                totalDurationMs: durationMs,
                maxDurationMs: durationMs,
                failures: 1,
                timeouts: normalizedError.kind === 'timeout' ? 1 : 0,
                lastErrorKind: normalizedError.kind,
            });

            const circuitResult = normalizedError.retryable
                ? registerRetryableFailure(
                    circuitBreakerKey,
                    circuitBreakerFailureThreshold,
                    circuitBreakerCooldownMs
                )
                : null;
            const shouldRetry = normalizedError.retryable
                && retryEnabled
                && attempt < totalAttempts
                && !circuitResult?.openedUntil;

            if (!normalizedError.retryable) {
                resetCircuit(circuitBreakerKey);
            }

            if (shouldRetry) {
                const delayMs = getRetryDelayMs(attempt, baseDelayMs, maxDelayMs, null);
                recordMetric(service, operation, {
                    retries: 1,
                });

                logger.warn('External API retry scheduled after request error', {
                    type: 'external_api',
                    service,
                    operation,
                    tenantId,
                    method,
                    requestUrl,
                    attempt,
                    totalAttempts,
                    delayMs,
                    errorKind: normalizedError.kind,
                    errorMessage: normalizedError.message,
                    consecutiveFailures: circuitResult?.consecutiveFailures,
                    ...metadata,
                });

                await sleep(delayMs);
                continue;
            }

            logger.error('External API request failed', {
                type: 'external_api',
                service,
                operation,
                tenantId,
                method,
                requestUrl,
                attempt,
                totalAttempts,
                errorKind: normalizedError.kind,
                retryable: normalizedError.retryable,
                errorMessage: normalizedError.message,
                consecutiveFailures: circuitResult?.consecutiveFailures,
                circuitOpenedUntil: circuitResult?.openedUntil
                    ? new Date(circuitResult.openedUntil).toISOString()
                    : undefined,
                ...metadata,
            });

            throw normalizedError;
        } finally {
            clearTimeout(timeoutId);
            cleanup();
        }
    }

    throw new ExternalApiRequestError(
        `${service} ${operation} failed without returning a response`,
        {
            service,
            operation,
            kind: 'network',
            retryable: false,
            details: {
                method,
                requestUrl,
            },
        }
    );
}
