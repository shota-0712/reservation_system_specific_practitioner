import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let writeFreezeGuard: () => (req: any, res: any, next: any) => void;
let envRef: { WRITE_FREEZE_MODE: boolean };
let originalWriteFreeze = false;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    const [{ writeFreezeGuard: middleware }, { env }] = await Promise.all([
        import('../../src/middleware/write-freeze.js'),
        import('../../src/config/env.js'),
    ]);

    writeFreezeGuard = middleware;
    envRef = env as { WRITE_FREEZE_MODE: boolean };
    originalWriteFreeze = envRef.WRITE_FREEZE_MODE;
});

afterEach(() => {
    envRef.WRITE_FREEZE_MODE = originalWriteFreeze;
});

describe('write-freeze middleware', () => {
    it('passes through when write freeze is disabled', () => {
        envRef.WRITE_FREEZE_MODE = false;

        const next = vi.fn();
        const req: any = { method: 'POST', path: '/api/v1/demo/reservations' };
        const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };

        writeFreezeGuard()(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('blocks mutating v1 API requests when write freeze is enabled', () => {
        envRef.WRITE_FREEZE_MODE = true;

        const next = vi.fn();
        const req: any = { method: 'POST', path: '/api/v1/demo/reservations' };
        const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };

        writeFreezeGuard()(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'MAINTENANCE_MODE',
                message: '現在メンテナンス中のため、更新操作を一時停止しています',
                details: {
                    writeFreezeMode: true,
                },
            },
        });
    });

    it('allows read-only requests when write freeze is enabled', () => {
        envRef.WRITE_FREEZE_MODE = true;

        const next = vi.fn();
        const req: any = { method: 'GET', path: '/api/v1/demo/reservations' };
        const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };

        writeFreezeGuard()(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });
});
