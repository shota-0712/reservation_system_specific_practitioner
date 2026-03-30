import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
}

const routeState = vi.hoisted(() => ({
    tenantId: '11111111-1111-4111-8111-111111111111',
    adminUser: {
        uid: 'admin-uid',
        name: 'Admin User',
    },
    lineUser: {
        uid: 'line-user-1',
        name: 'Line User',
    },
    reservationRepo: {
        findByIdOrFail: vi.fn(),
        updateStatus: vi.fn(),
        cancel: vi.fn(),
    },
    customerRepo: {
        findById: vi.fn(),
        findByIdOrFail: vi.fn(),
        findByLineUserId: vi.fn(),
        syncReservationStats: vi.fn(),
    },
    practitionerRepo: {
        findById: vi.fn(),
    },
    messageService: {
        sendCancellationNotice: vi.fn(),
        sendConfirmation: vi.fn(),
        sendVisitCompletedNotice: vi.fn(),
    },
    calendarService: {
        syncReservationDeletion: vi.fn(),
    },
    audit: {
        getRequestMeta: vi.fn(),
        writeAuditLog: vi.fn(),
    },
}));

vi.mock('../../src/middleware/auth.js', () => ({
    requirePermission: () => (req: any, _res: any, next: any) => {
        req.user = routeState.adminUser;
        next();
    },
    requireLineAuth: () => (req: any, _res: any, next: any) => {
        req.user = routeState.lineUser;
        next();
    },
    getUser: (req: any) => req.user,
}));

vi.mock('../../src/middleware/tenant.js', () => ({
    getTenantId: () => routeState.tenantId,
}));

vi.mock('../../src/repositories/index.js', () => ({
    createReservationRepository: () => routeState.reservationRepo,
    createCustomerRepository: () => routeState.customerRepo,
    createPractitionerRepository: () => routeState.practitionerRepo,
}));

vi.mock('../../src/services/reservation-policy.service.js', () => ({
    enforceAdvanceBookingPolicy: vi.fn(),
    enforceCancelPolicy: vi.fn(),
    resolveStoreContext: vi.fn().mockResolvedValue({
        store: { id: 'store-1' },
        policy: { timezone: 'Asia/Tokyo' },
    }),
}));

vi.mock('../../src/services/service-message.service.js', () => ({
    createServiceMessageService: () => routeState.messageService,
}));

vi.mock('../../src/services/google-calendar-sync.service.js', () => ({
    createGoogleCalendarSyncService: () => routeState.calendarService,
}));

vi.mock('../../src/services/audit-log.service.js', () => ({
    getRequestMeta: (...args: any[]) => routeState.audit.getRequestMeta(...args),
    writeAuditLog: (...args: any[]) => routeState.audit.writeAuditLog(...args),
}));

vi.mock('../../src/services/booking-link-token.service.js', () => ({
    createBookingLinkTokenService: vi.fn(),
}));

vi.mock('../../src/services/reservation.service.js', () => ({
    createReservationService: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

let reservationAdminRoutes: typeof import('../../src/routes/v1/reservation.admin.routes.js').reservationAdminRoutes;
let reservationCustomerRoutes: typeof import('../../src/routes/v1/reservation.customer.routes.js').reservationCustomerRoutes;
let server: Server;
let baseUrl: string;

const reservationBefore = {
    id: '22222222-2222-4222-8222-222222222222',
    customerId: '33333333-3333-4333-8333-333333333333',
    practitionerId: '44444444-4444-4444-8444-444444444444',
    storeId: '55555555-5555-4555-8555-555555555555',
    status: 'completed',
    totalPrice: 9000,
    startsAt: '2026-03-20T01:00:00.000Z',
};

beforeAll(async () => {
    ({ reservationAdminRoutes } = await import('../../src/routes/v1/reservation.admin.routes.js'));
    ({ reservationCustomerRoutes } = await import('../../src/routes/v1/reservation.customer.routes.js'));

    const app = express();
    app.use(express.json());
    app.use('/admin/reservations', reservationAdminRoutes);
    app.use('/customer/reservations', reservationCustomerRoutes);
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
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
});

beforeEach(() => {
    routeState.reservationRepo.findByIdOrFail.mockResolvedValue(reservationBefore);
    routeState.reservationRepo.updateStatus.mockImplementation(async (_id: string, status: string) => ({
        ...reservationBefore,
        status,
    }));
    routeState.reservationRepo.cancel.mockResolvedValue({
        ...reservationBefore,
        status: 'canceled',
        cancelReason: 'お客様によるキャンセル',
    });
    routeState.customerRepo.findById.mockResolvedValue({
        id: reservationBefore.customerId,
        lineNotificationToken: 'notification-token',
        lineUserId: 'line-user-1',
    });
    routeState.customerRepo.findByLineUserId.mockResolvedValue({
        id: reservationBefore.customerId,
        name: '顧客A',
        lineNotificationToken: 'notification-token',
        lineUserId: 'line-user-1',
    });
    routeState.customerRepo.syncReservationStats.mockResolvedValue({
        id: reservationBefore.customerId,
        name: '顧客A',
        isActive: true,
    });
    routeState.practitionerRepo.findById.mockResolvedValue({
        id: reservationBefore.practitionerId,
        name: '施術者A',
    });
    routeState.messageService.sendCancellationNotice.mockResolvedValue(undefined);
    routeState.messageService.sendConfirmation.mockResolvedValue(undefined);
    routeState.messageService.sendVisitCompletedNotice.mockResolvedValue(undefined);
    routeState.calendarService.syncReservationDeletion.mockResolvedValue(undefined);
    routeState.audit.getRequestMeta.mockReturnValue({});
    routeState.audit.writeAuditLog.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.clearAllMocks();
});

async function requestJson(path: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, init);
    const json = await response.json();
    return { response, json };
}

describe('reservation status aggregation routes', () => {
    it('rebuilds customer stats even when an admin restores a completed reservation back to confirmed', async () => {
        const { response, json } = await requestJson(`/admin/reservations/${reservationBefore.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'confirmed',
            }),
        });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(routeState.customerRepo.syncReservationStats).toHaveBeenCalledWith(reservationBefore.customerId);
        expect(routeState.customerRepo.syncReservationStats).toHaveBeenCalledTimes(1);
    });

    it('keeps customer cancel aggregates idempotent on customer-side retry cancel requests', async () => {
        const { response, json } = await requestJson(`/customer/reservations/${reservationBefore.id}`, {
            method: 'DELETE',
        });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(routeState.customerRepo.syncReservationStats).toHaveBeenCalledWith(reservationBefore.customerId);
        expect(routeState.customerRepo.syncReservationStats).toHaveBeenCalledTimes(1);
    });
});
