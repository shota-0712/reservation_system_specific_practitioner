import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
}

const reminderState = vi.hoisted(() => ({
    auth: {
        uid: 'admin-uid',
        role: 'manager',
    },
    tenant: {
        id: '11111111-1111-4111-8111-111111111111',
        slug: 'smoke-salon',
        name: 'Smoke Salon',
        lineConfig: {
            mode: 'tenant',
            channelId: 'channel',
            liffId: 'liff',
        },
    },
    reservationRepo: {
        findById: vi.fn(),
    },
    customerRepo: {
        findById: vi.fn(),
    },
    service: {
        sendDayBeforeReminder: vi.fn(),
        sendSameDayReminder: vi.fn(),
    },
    query: vi.fn(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
    requireFirebaseAuth: () => (req: any, _res: any, next: any) => {
        req.user = {
            uid: reminderState.auth.uid,
            role: reminderState.auth.role,
        };
        next();
    },
    requireRole: (...roles: string[]) => (req: any, _res: any, next: any) => {
        req.user = req.user ?? {
            uid: reminderState.auth.uid,
            role: reminderState.auth.role,
        };
        if (!roles.includes(req.user.role)) {
            next({
                statusCode: 403,
                code: 'AUTHORIZATION_ERROR',
                message: 'forbidden',
            });
            return;
        }
        next();
    },
}));

vi.mock('../../src/middleware/tenant.js', () => ({
    getTenant: () => reminderState.tenant,
}));

vi.mock('../../src/repositories/index.js', () => ({
    createReservationRepository: () => reminderState.reservationRepo,
    createCustomerRepository: () => reminderState.customerRepo,
}));

vi.mock('../../src/services/service-message.service.js', () => ({
    createServiceMessageService: () => reminderState.service,
}));

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        query: reminderState.query,
    },
}));

let reminderRoutes: typeof import('../../src/routes/v1/reminder.routes.js').default;
let server: Server;
let baseUrl: string;

const RESERVATION_ID = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
    ({ default: reminderRoutes } = await import('../../src/routes/v1/reminder.routes.js'));

    const app = express();
    app.use(express.json());
    app.use('/reminders', reminderRoutes);
    app.use((error: any, _req: any, res: any, _next: any) => {
        res.status(error?.statusCode ?? 500).json({
            success: false,
            error: {
                code: error?.code ?? 'INTERNAL_ERROR',
                message: error?.message ?? 'unexpected error',
            },
        });
    });

    server = await new Promise<Server>((resolve) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
});

beforeEach(() => {
    reminderState.reservationRepo.findById.mockResolvedValue({
        id: RESERVATION_ID,
        customerId: '33333333-3333-4333-8333-333333333333',
    });
    reminderState.customerRepo.findById.mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333333',
        lineUserId: 'line-user-1',
    });
    reminderState.service.sendDayBeforeReminder.mockResolvedValue({ success: true });
    reminderState.service.sendSameDayReminder.mockResolvedValue({ success: true });
    reminderState.query.mockResolvedValue([
        {
            id: 'log-1',
            reservation_id: RESERVATION_ID,
            message_type: 'reminder_day_before',
            status: 'success',
            error: null,
            sent_at: '2026-03-22T00:00:00.000Z',
        },
    ]);
});

afterEach(() => {
    vi.clearAllMocks();
});

async function requestJson(path: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, init);
    const json = await response.json();
    return { response, json };
}

describe('reminder routes integration', () => {
    it('sends a single day-before reminder', async () => {
        const { response, json } = await requestJson('/reminders/send-single', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reservationId: RESERVATION_ID,
                type: 'reminder_day_before',
            }),
        });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(reminderState.service.sendDayBeforeReminder).toHaveBeenCalled();
    });

    it('returns reminder logs', async () => {
        const { response, json } = await requestJson('/reminders/logs?limit=5');

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data[0].status).toBe('success');
        expect(reminderState.query).toHaveBeenCalledWith(
            expect.stringContaining('FROM service_message_logs'),
            [reminderState.tenant.id, 5],
            reminderState.tenant.id
        );
    });
});
