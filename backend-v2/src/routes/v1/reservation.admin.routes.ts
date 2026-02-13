import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
    asyncHandler,
    validateBody,
    validateParams,
    validateQuery,
    idParamSchema,
    dateSchema,
    timeSchema,
    paginationSchema,
} from '../../middleware/index.js';
import { getTenantId } from '../../middleware/tenant.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import {
    createReservationRepository,
    createCustomerRepository,
    createMenuRepository,
    createPractitionerRepository,
    createOptionRepository,
} from '../../repositories/index.js';
import { createServiceMessageService } from '../../services/service-message.service.js';
import { createGoogleCalendarService } from '../../services/google-calendar.service.js';
import { createGoogleCalendarSyncQueueService } from '../../services/google-calendar-sync-queue.service.js';
import {
    enforceAdvanceBookingPolicy,
    enforceCancelPolicy,
    resolveStoreContext,
} from '../../services/reservation-policy.service.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import { ConflictError, ValidationError } from '../../utils/errors.js';
import type { ApiResponse, Reservation } from '../../types/index.js';

const router = Router();

const updateReservationStatusSchema = z.object({
    status: z.enum(['pending', 'confirmed', 'completed', 'canceled', 'no_show']),
    reason: z.string().max(500).optional(),
});

const updateReservationSchema = z.object({
    customerId: z.string().optional(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    customerEmail: z.string().email().optional(),
    practitionerId: z.string().optional(),
    menuIds: z.array(z.string()).optional(),
    optionIds: z.array(z.string()).optional(),
    date: dateSchema.optional(),
    startTime: timeSchema.optional(),
    status: z.enum(['pending', 'confirmed', 'completed', 'canceled', 'no_show']).optional(),
    isNomination: z.boolean().optional(),
    customerNote: z.string().max(500).optional(),
    staffNote: z.string().max(500).optional(),
    source: z.enum(['line', 'phone', 'walk_in', 'salonboard', 'hotpepper', 'web', 'admin', 'google_calendar']).optional(),
    storeId: z.string().optional(),
});

const createAdminReservationSchema = z.object({
    customerId: z.string().optional(),
    customerName: z.string().min(1, '顧客名は必須です'),
    customerPhone: z.string().optional(),
    customerEmail: z.string().email().optional(),
    practitionerId: z.string().min(1, '施術者を選択してください'),
    menuIds: z.array(z.string()).min(1, 'メニューを選択してください'),
    optionIds: z.array(z.string()).optional().default([]),
    date: dateSchema,
    startTime: timeSchema,
    status: z.enum(['pending', 'confirmed']).optional(),
    isNomination: z.boolean().optional(),
    customerNote: z.string().max(500).optional(),
    staffNote: z.string().max(500).optional(),
    source: z.enum(['line', 'phone', 'walk_in', 'salonboard', 'hotpepper', 'web', 'admin', 'google_calendar']).optional(),
    storeId: z.string().optional(),
});

const reservationFiltersSchema = paginationSchema.extend({
    status: z.enum(['pending', 'confirmed', 'completed', 'canceled', 'no_show']).optional(),
    practitionerId: z.string().optional(),
    customerId: z.string().optional(),
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
    date: dateSchema.optional(),
});

function practitionerMatchesStore(practitionerStoreIds: string[] | undefined, storeId?: string): boolean {
    if (!storeId) {
        return true;
    }
    const ids = practitionerStoreIds ?? [];
    if (ids.length === 0) {
        return true;
    }
    return ids.includes(storeId);
}

router.get(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageReservations'),
    validateQuery(reservationFiltersSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const { page, limit, sortBy, sortOrder, ...filters } = req.query as unknown as {
            page?: number;
            limit?: number;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            [key: string]: unknown;
        };

        const reservationRepo = createReservationRepository(tenantId);
        const result = await reservationRepo.findPaginatedWithFilters(
            filters as Parameters<typeof reservationRepo.findPaginatedWithFilters>[0],
            { page, limit, sortBy, sortOrder }
        );

        const response: ApiResponse<Reservation[]> = {
            success: true,
            data: result.data,
            meta: result.pagination,
        };

        res.json(response);
    })
);

router.post(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManageReservations'),
    validateBody(createAdminReservationSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const {
            customerId,
            customerName,
            customerPhone,
            customerEmail,
            practitionerId,
            menuIds,
            optionIds,
            date,
            startTime,
            status,
            isNomination,
            customerNote,
            staffNote,
            source,
            storeId,
        } = req.body;

        const { store, policy } = await resolveStoreContext(tenantId, storeId || (req as { storeId?: string }).storeId);
        enforceAdvanceBookingPolicy(date, policy);

        const reservationRepo = createReservationRepository(tenantId);
        const customerRepo = createCustomerRepository(tenantId);
        const menuRepo = createMenuRepository(tenantId);
        const practitionerRepo = createPractitionerRepository(tenantId);
        const optionRepo = createOptionRepository(tenantId);

        let customer = null;
        if (customerId) {
            customer = await customerRepo.findByIdOrFail(customerId);
        } else if (customerPhone) {
            customer = await customerRepo.findByPhone(customerPhone);
        }
        if (!customer && customerEmail) {
            customer = await customerRepo.findByEmail(customerEmail);
        }

        if (!customer) {
            customer = await customerRepo.create({
                name: customerName,
                phone: customerPhone,
                email: customerEmail,
                tags: [],
            });
        } else {
            await customerRepo.update(customer.id, {
                name: customerName || customer.name,
                phone: customerPhone || customer.phone,
                email: customerEmail || customer.email,
            });
        }

        const practitioner = await practitionerRepo.findByIdOrFail(practitionerId);
        if (!practitionerMatchesStore(practitioner.storeIds, store.id)) {
            throw new ValidationError('選択された施術者はこの店舗では利用できません');
        }
        const menus = await Promise.all(menuIds.map((id: string) => menuRepo.findByIdOrFail(id)));
        const options = await Promise.all((optionIds || []).map((id: string) => optionRepo.findByIdOrFail(id)));

        const menuDuration = menus.reduce((sum, m) => sum + m.duration, 0);
        const menuPrice = menus.reduce((sum, m) => sum + m.price, 0);
        const optionDuration = options.reduce((sum, o) => sum + o.duration, 0);
        const optionPrice = options.reduce((sum, o) => sum + o.price, 0);
        const nominationFee = isNomination ? (practitioner.nominationFee ?? 0) : 0;
        const totalDuration = menuDuration + optionDuration;
        const totalPrice = menuPrice + optionPrice + nominationFee;

        const [hours, minutes] = startTime.split(':').map(Number);
        const endMinutes = hours * 60 + minutes + totalDuration;
        const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60)
            .toString()
            .padStart(2, '0')}`;

        const hasConflict = await reservationRepo.hasConflict(practitionerId, date, startTime, endTime, {
            timezone: policy.timezone,
        });
        if (hasConflict) {
            throw new ConflictError('選択された時間帯はすでに予約が入っています');
        }

        const reservation = await reservationRepo.create({
            storeId: store.id,
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone,
            practitionerId,
            practitionerName: practitioner.name,
            menuIds,
            menuNames: menus.map((m) => m.name),
            optionIds,
            optionNames: options.map((o) => o.name),
            date,
            startTime,
            endTime,
            duration: totalDuration,
            totalPrice,
            status: status ?? 'confirmed',
            source: source ?? 'admin',
            customerNote,
            staffNote,
            subtotal: menuPrice,
            optionTotal: optionPrice,
            nominationFee,
            menuItems: menus.map((m, idx) => ({
                menuId: m.id,
                menuName: m.name,
                menuPrice: m.price,
                menuDuration: m.duration,
                sortOrder: idx,
                isMain: idx === 0,
            })),
            optionItems: options.map((o) => ({
                optionId: o.id,
                optionName: o.name,
                optionPrice: o.price,
                optionDuration: o.duration,
            })),
        } as Omit<Reservation, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>, policy.timezone);

        const targetToken = customer.lineNotificationToken || customer.lineUserId;
        if (targetToken) {
            const messageService = createServiceMessageService(tenantId);
            messageService.sendConfirmation(targetToken, reservation).catch((err) => {
                console.error('Failed to send confirmation', err);
            });
        }

        if (practitioner.calendarId) {
            const googleService = createGoogleCalendarService(tenantId);
            googleService
                .syncCreateEvent(practitioner.calendarId, reservation, store.timezone || 'Asia/Tokyo')
                .then(async (eventId) => {
                    if (!eventId) return;
                    await reservationRepo.setGoogleCalendarRefs(reservation.id, {
                        calendarId: practitioner.calendarId as string,
                        eventId,
                    });
                })
                .catch((error) => {
                    console.error('Failed to sync reservation to Google Calendar', error);
                    const queue = createGoogleCalendarSyncQueueService(tenantId);
                    queue
                        .enqueue({
                            reservationId: reservation.id,
                            action: 'create',
                            calendarId: practitioner.calendarId,
                        })
                        .catch(() => undefined);
                });
        }

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'CREATE',
            entityType: 'reservation',
            entityId: reservation.id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            newValues: reservation as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Reservation> = { success: true, data: reservation };
        res.status(201).json(response);
    })
);

router.put(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageReservations'),
    validateParams(idParamSchema),
    validateBody(updateReservationSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!id) {
            throw new ValidationError('予約IDが不正です');
        }
        const {
            customerId,
            customerName,
            customerPhone,
            customerEmail,
            practitionerId,
            menuIds,
            optionIds,
            date,
            startTime,
            status,
            isNomination,
            customerNote,
            staffNote,
            source,
            storeId,
        } = req.body;

        const reservationRepo = createReservationRepository(tenantId);
        const customerRepo = createCustomerRepository(tenantId);
        const menuRepo = createMenuRepository(tenantId);
        const practitionerRepo = createPractitionerRepository(tenantId);
        const optionRepo = createOptionRepository(tenantId);

        const existing = await reservationRepo.findByIdOrFail(id);

        const targetStoreId = storeId ?? existing.storeId ?? (req as { storeId?: string }).storeId;
        const { store, policy } = await resolveStoreContext(tenantId, targetStoreId);
        if (date) {
            enforceAdvanceBookingPolicy(date, policy);
        }

        const targetCustomerId = customerId ?? existing.customerId;
        const customer = await customerRepo.findByIdOrFail(targetCustomerId);
        if (customerName || customerPhone || customerEmail) {
            await customerRepo.update(customer.id, {
                name: customerName || customer.name,
                phone: customerPhone || customer.phone,
                email: customerEmail || customer.email,
            });
        }

        const newPractitionerId = practitionerId ?? existing.practitionerId;
        const newMenuIds = menuIds ?? existing.menuIds ?? [];
        const newOptionIds = optionIds ?? existing.optionIds ?? [];

        if (newMenuIds.length === 0) {
            throw new ValidationError('メニューを選択してください');
        }

        const practitioner = await practitionerRepo.findByIdOrFail(newPractitionerId);
        if (!practitionerMatchesStore(practitioner.storeIds, store.id)) {
            throw new ValidationError('選択された施術者はこの店舗では利用できません');
        }
        const menus = await Promise.all(newMenuIds.map((menuId: string) => menuRepo.findByIdOrFail(menuId)));
        const options = await Promise.all((newOptionIds || []).map((optionId: string) => optionRepo.findByIdOrFail(optionId)));

        const menuDuration = menus.reduce((sum, m) => sum + m.duration, 0);
        const menuPrice = menus.reduce((sum, m) => sum + m.price, 0);
        const optionDuration = options.reduce((sum, o) => sum + o.duration, 0);
        const optionPrice = options.reduce((sum, o) => sum + o.price, 0);

        const applyNomination = isNomination ?? ((existing.nominationFee ?? 0) > 0);
        const nominationFee = applyNomination ? (practitioner.nominationFee ?? 0) : 0;

        const totalDuration = menuDuration + optionDuration;
        const totalPrice = menuPrice + optionPrice + nominationFee;

        const newDate = date ?? existing.date;
        const newStartTime = startTime ?? existing.startTime;
        const [hours, minutes] = newStartTime.split(':').map(Number);
        const endMinutes = hours * 60 + minutes + totalDuration;
        const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60)
            .toString()
            .padStart(2, '0')}`;

        const hasConflict = await reservationRepo.hasConflict(newPractitionerId, newDate, newStartTime, endTime, {
            excludeReservationId: id,
            timezone: policy.timezone,
        });
        if (hasConflict) {
            throw new ConflictError('選択された時間帯はすでに予約が入っています');
        }

        const updated = await reservationRepo.updateWithItems(id, {
            storeId: store.id,
            customerId: customer.id,
            customerName: customerName || existing.customerName || customer.name,
            customerPhone: customerPhone || existing.customerPhone || customer.phone,
            practitionerId: newPractitionerId,
            practitionerName: practitioner.name,
            menuIds: newMenuIds,
            menuNames: menus.map((m) => m.name),
            optionIds: newOptionIds,
            optionNames: options.map((o) => o.name),
            date: newDate,
            startTime: newStartTime,
            endTime,
            duration: totalDuration,
            totalPrice,
            status: status ?? existing.status,
            source: source ?? existing.source,
            customerNote: customerNote ?? existing.customerNote,
            staffNote: staffNote ?? existing.staffNote,
            subtotal: menuPrice,
            optionTotal: optionPrice,
            nominationFee,
            menuItems: menus.map((m, idx) => ({
                menuId: m.id,
                menuName: m.name,
                menuPrice: m.price,
                menuDuration: m.duration,
                sortOrder: idx,
                isMain: idx === 0,
            })),
            optionItems: options.map((o) => ({
                optionId: o.id,
                optionName: o.name,
                optionPrice: o.price,
                optionDuration: o.duration,
            })),
            googleCalendarId: existing.googleCalendarId,
            googleCalendarEventId: existing.googleCalendarEventId,
        } as Omit<Reservation, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>, policy.timezone);

        // Notify customer about reservation changes (best-effort).
        // Status changes are handled by PATCH /:id/status, so we skip if status is explicitly changed here.
        if (!status || status === existing.status) {
            const targetToken = customer.lineNotificationToken || customer.lineUserId;
            if (targetToken) {
                let changeType = '予約内容変更';
                let oldValue = `${existing.date} ${existing.startTime}`;
                let newValue = `${updated.date} ${updated.startTime}`;

                if (existing.date !== updated.date || existing.startTime !== updated.startTime) {
                    changeType = '日時変更';
                } else if (JSON.stringify(existing.menuIds || []) !== JSON.stringify(updated.menuIds || [])) {
                    changeType = 'メニュー変更';
                    oldValue = (existing.menuNames || []).join('、');
                    newValue = (updated.menuNames || []).join('、');
                }

                const messageService = createServiceMessageService(tenantId);
                messageService.sendModificationNotice(targetToken, updated, changeType, oldValue, newValue).catch(() => undefined);
            }
        }

        if (practitioner.calendarId) {
            const googleService = createGoogleCalendarService(tenantId);
            if (updated.googleCalendarEventId) {
                const calendarId = updated.googleCalendarId || practitioner.calendarId;
                googleService
                    .syncUpdateEvent(calendarId, updated.googleCalendarEventId, updated, store.timezone || 'Asia/Tokyo')
                    .catch((error) => {
                        console.error('Failed to update Google Calendar event', error);
                        const queue = createGoogleCalendarSyncQueueService(tenantId);
                        queue
                            .enqueue({
                                reservationId: updated.id,
                                action: 'update',
                                calendarId,
                                eventId: updated.googleCalendarEventId,
                            })
                            .catch(() => undefined);
                    });
            } else {
                googleService
                    .syncCreateEvent(practitioner.calendarId, updated, store.timezone || 'Asia/Tokyo')
                    .then(async (eventId) => {
                        if (!eventId) return;
                        await reservationRepo.setGoogleCalendarRefs(updated.id, {
                            calendarId: practitioner.calendarId as string,
                            eventId,
                        });
                    })
                    .catch((error) => {
                        console.error('Failed to create Google Calendar event', error);
                        const queue = createGoogleCalendarSyncQueueService(tenantId);
                        queue
                            .enqueue({
                                reservationId: updated.id,
                                action: 'create',
                                calendarId: practitioner.calendarId,
                            })
                            .catch(() => undefined);
                    });
            }
        }

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'reservation',
            entityId: updated.id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: existing as unknown as Record<string, unknown>,
            newValues: updated as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Reservation> = { success: true, data: updated };
        res.json(response);
    })
);

router.get(
    '/today',
    requireFirebaseAuth(),
    requirePermission('canManageReservations'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const reservationRepo = createReservationRepository(tenantId);
        const reservations = await reservationRepo.findToday();

        const response: ApiResponse<Reservation[]> = { success: true, data: reservations };
        res.json(response);
    })
);

router.get(
    '/by-date/:date',
    requireFirebaseAuth(),
    requirePermission('canManageReservations'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const date = req.params.date as string;
        const reservationRepo = createReservationRepository(tenantId);
        const reservations = await reservationRepo.findByDate(date);

        const response: ApiResponse<Reservation[]> = { success: true, data: reservations };
        res.json(response);
    })
);

router.get(
    '/stats',
    requireFirebaseAuth(),
    requirePermission('canViewReports'),
    validateQuery(
        z.object({
            startDate: dateSchema,
            endDate: dateSchema,
        })
    ),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const { startDate, endDate } = req.query as { startDate: string; endDate: string };
        const reservationRepo = createReservationRepository(tenantId);

        const stats = await reservationRepo.getStats(startDate, endDate);

        const response: ApiResponse<typeof stats> = { success: true, data: stats };
        res.json(response);
    })
);

router.get(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManageReservations'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const reservationRepo = createReservationRepository(tenantId);
        const reservation = await reservationRepo.findByIdOrFail(req.params.id as string);

        const response: ApiResponse<Reservation> = { success: true, data: reservation };
        res.json(response);
    })
);

router.patch(
    '/:id/status',
    requireFirebaseAuth(),
    requirePermission('canManageReservations'),
    validateParams(idParamSchema),
    validateBody(updateReservationStatusSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const id = req.params.id as string;
        const { status, reason } = req.body;

        const reservationRepo = createReservationRepository(tenantId);
        const customerRepo = createCustomerRepository(tenantId);
        const practitionerRepo = createPractitionerRepository(tenantId);

        const before = await reservationRepo.findByIdOrFail(id);
        if (status === 'canceled') {
            const { policy } = await resolveStoreContext(tenantId, before.storeId);
            enforceCancelPolicy(before, policy);
        }

        const reservation = await reservationRepo.updateStatus(id, status, reason);

        if (status === 'completed') {
            await customerRepo.updateStatsAfterReservation(
                reservation.customerId,
                reservation.totalPrice,
                reservation.date
            );
        } else if (status === 'no_show') {
            await customerRepo.incrementNoShow(reservation.customerId);
        } else if (status === 'canceled') {
            await customerRepo.incrementCancel(reservation.customerId);
        }

        if ((status === 'canceled' || status === 'no_show') && reservation.googleCalendarEventId) {
            const practitioner = await practitionerRepo.findById(reservation.practitionerId);
            if (practitioner?.calendarId) {
                const googleService = createGoogleCalendarService(tenantId);
                const calendarId = reservation.googleCalendarId || practitioner.calendarId;
                googleService
                    .syncDeleteEvent(calendarId, reservation.googleCalendarEventId)
                    .then(() => reservationRepo.clearGoogleCalendarRefs(reservation.id))
                    .catch((error) => {
                        console.error('Failed to delete Google Calendar event', error);
                        const queue = createGoogleCalendarSyncQueueService(tenantId);
                        queue
                            .enqueue({
                                reservationId: reservation.id,
                                action: 'delete',
                                calendarId,
                                eventId: reservation.googleCalendarEventId,
                            })
                            .catch(() => undefined);
                    });
            }
        }

        const customer = await customerRepo.findById(reservation.customerId);
        const targetToken = customer?.lineNotificationToken || customer?.lineUserId;
        if (targetToken) {
            const messageService = createServiceMessageService(tenantId);
            if (status === 'canceled') {
                messageService.sendCancellationNotice(targetToken, reservation, reason).catch(() => undefined);
            } else if (status === 'confirmed') {
                messageService.sendConfirmation(targetToken, reservation).catch(() => undefined);
            } else if (status === 'completed') {
                messageService.sendVisitCompletedNotice(targetToken, reservation).catch(() => undefined);
            }
        }

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'reservation',
            entityId: reservation.id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: before as unknown as Record<string, unknown>,
            newValues: reservation as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Reservation> = { success: true, data: reservation };
        res.json(response);
    })
);

export const reservationAdminRoutes = router;
