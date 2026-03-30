import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let fetchWithResilience: typeof import('../../src/utils/external-api-client.js').fetchWithResilience;
let getExternalApiMetricsSnapshot: typeof import('../../src/utils/external-api-client.js').getExternalApiMetricsSnapshot;
let resetExternalApiClientState: typeof import('../../src/utils/external-api-client.js').resetExternalApiClientState;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    const module = await import('../../src/utils/external-api-client.js');
    fetchWithResilience = module.fetchWithResilience;
    getExternalApiMetricsSnapshot = module.getExternalApiMetricsSnapshot;
    resetExternalApiClientState = module.resetExternalApiClientState;
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetExternalApiClientState();
});

describe('external-api-client', () => {
    it('retries retryable GET responses and records metrics', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('busy', { status: 503 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await fetchWithResilience('https://api.example.com/resource', {
            service: 'example',
            operation: 'load-resource',
            maxRetries: 1,
            baseDelayMs: 0,
            maxDelayMs: 0,
        });

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(getExternalApiMetricsSnapshot()['example:load-resource']).toMatchObject({
            attempts: 2,
            successes: 1,
            failures: 1,
            retries: 1,
            lastStatus: 200,
        });
    });

    it('does not retry non-idempotent POST requests by default', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValue(new Response('unavailable', { status: 503 }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await fetchWithResilience('https://api.example.com/messages', {
            service: 'example',
            operation: 'send-message',
            method: 'POST',
            maxRetries: 3,
            baseDelayMs: 0,
            maxDelayMs: 0,
        });

        expect(response.status).toBe(503);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('times out stalled requests and records the timeout metric', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockImplementation((_: string, init?: RequestInit) => (
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            })
        ));
        vi.stubGlobal('fetch', fetchMock);

        const request = fetchWithResilience('https://api.example.com/slow', {
            service: 'example',
            operation: 'slow-call',
            timeoutMs: 100,
            maxRetries: 0,
        });
        const rejection = expect(request).rejects.toMatchObject({
            kind: 'timeout',
        });

        await vi.advanceTimersByTimeAsync(100);

        await rejection;
        expect(getExternalApiMetricsSnapshot()['example:slow-call']).toMatchObject({
            attempts: 1,
            failures: 1,
            timeouts: 1,
        });
    });

    it('opens the circuit breaker after repeated retryable failures', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('socket hang up'));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchWithResilience('https://api.example.com/flaky', {
            service: 'example',
            operation: 'flaky-call',
            maxRetries: 0,
            circuitBreakerFailureThreshold: 1,
            circuitBreakerCooldownMs: 1000,
        })).rejects.toMatchObject({
            kind: 'network',
        });

        await expect(fetchWithResilience('https://api.example.com/flaky', {
            service: 'example',
            operation: 'flaky-call',
            maxRetries: 0,
            circuitBreakerFailureThreshold: 1,
            circuitBreakerCooldownMs: 1000,
        })).rejects.toMatchObject({
            kind: 'circuit_open',
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getExternalApiMetricsSnapshot()['example:flaky-call']).toMatchObject({
            failures: 2,
            circuitOpen: 1,
        });
    });
});
