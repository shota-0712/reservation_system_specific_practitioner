import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
    asyncHandler,
    validateBody,
    validateParams,
    idParamSchema,
    dateSchema,
    timeSchema,
} from '../../middleware/index.js';
import { getTenantId } from '../../middleware/tenant.js';
import { requireLineAuth, getUser } from '../../middleware/auth.js';
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
import { ConflictError, ValidationError, AuthenticationError } from '../../utils/errors.js';
import type { ApiResponse, Reservation } from '../../types/index.js';

const router = Router();

const createReservationSchema = z.object({
    practitionerId: z.string().min(1, '施術者を選択してください'),
    menuIds: z.array(z.string()).min(1, 'メニューを選択してください'),
    optionIds: z.array(z.string()).optional().default([]),
    date: dateSchema,
    startTime: timeSchema,
    customerNote: z.string().max(500).optional(),
    isNomination: z.boolean().optional(),
    notificationToken: z.string().optional(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    storeId: z.string().optional(),
});

const updateReservationSchema = z.object({
    practitionerId: z.string().optional(),
    menuIds: z.array(z.string()).min(1, 'メニューを選択してください').optional(),
    optionIds: z.array(z.string()).optional().default([]),
    date: dateSchema,
    startTime: timeSchema,
    customerNote: z.string().max(500).optional(),
    isNomination: z.boolean().optional(),
    notificationToken: z.string().optional(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    storeId: z.string().optional(),
});

	router.post(
    '/',
    requireLineAuth(),
    validateBody(createReservationSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const user = getUser(req);
        if (!user) throw new AuthenticationError('認証が必要です');

        const {
            practitionerId,
            menuIds,
            optionIds,
            date,
            startTime,
            customerNote,
            notificationToken,
            customerName,
            customerPhone,
            isNomination,
            storeId,
        } = req.body;

        const { store, policy } = await resolveStoreContext(tenantId, storeId || (req as { storeId?: string }).storeId);
        enforceAdvanceBookingPolicy(date, policy);

        const reservationRepo = createReservationRepository(tenantId);
        const customerRepo = createCustomerRepository(tenantId);
        const menuRepo = createMenuRepository(tenantId);
        const practitionerRepo = createPractitionerRepository(tenantId);
        const optionRepo = createOptionRepository(tenantId);

        const practitioner = await practitionerRepo.findByIdOrFail(practitionerId);

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

        const customer = await customerRepo.findOrCreate(user.uid, user.name || 'ゲスト', user.picture);

        await customerRepo.update(customer.id, {
            name: customerName || customer.name,
            phone: customerPhone || customer.phone,
            lineNotificationToken: notificationToken || customer.lineNotificationToken,
        });

        const reservation = await reservationRepo.create({
            storeId: store.id,
            customerId: customer.id,
            customerName: customerName || customer.name || 'ゲスト',
            customerPhone: customerPhone || customer.phone,
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
            status: 'pending',
            source: 'line',
            customerNote,
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
            actorType: 'customer',
            actorId: user.uid,
            actorName: customerName || user.name,
            newValues: reservation as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Reservation> = {
            success: true,
            data: reservation,
        };

        res.status(201).json(response);
    })
);

	router.get(
	    '/my',
	    requireLineAuth(),
	    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const user = getUser(req);
        if (!user) throw new AuthenticationError('認証が必要です');

        const customerRepo = createCustomerRepository(tenantId);
        const reservationRepo = createReservationRepository(tenantId);

        const customer = await customerRepo.findByLineUserId(user.uid);
        if (!customer) {
            const response: ApiResponse<Reservation[]> = { success: true, data: [] };
            res.json(response);
            return;
        }

        const upcoming = await reservationRepo.findUpcomingByCustomer(customer.id);
        const past = await reservationRepo.findPastByCustomer(customer.id, 50);
        const reservations = [...upcoming, ...past].sort((a, b) => {
            const aKey = `${a.date} ${a.startTime}`;
            const bKey = `${b.date} ${b.startTime}`;
            return aKey.localeCompare(bKey);
        });

	        const response: ApiResponse<Reservation[]> = { success: true, data: reservations };
	        res.json(response);
	    })
	);

router.get(
    '/:id',
    requireLineAuth(),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const user = getUser(req);
        if (!user) throw new AuthenticationError('認証が必要です');

        const customerRepo = createCustomerRepository(tenantId);
        const reservationRepo = createReservationRepository(tenantId);

        const customer = await customerRepo.findByLineUserId(user.uid);
        if (!customer) throw new ValidationError('顧客情報が見つかりません');

        const reservation = await reservationRepo.findByIdOrFail(req.params.id as string);
        if (reservation.customerId !== customer.id) {
            throw new ValidationError('この予約を参照する権限がありません');
        }

        const response: ApiResponse<Reservation> = { success: true, data: reservation };
        res.json(response);
    })
);

router.put(
    '/:id',
    requireLineAuth(),
    validateParams(idParamSchema),
    validateBody(updateReservationSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const user = getUser(req);
        if (!user) throw new AuthenticationError('認証が必要です');

        const id = req.params.id as string;

        const reservationRepo = createReservationRepository(tenantId);
        const customerRepo = createCustomerRepository(tenantId);
        const menuRepo = createMenuRepository(tenantId);
        const practitionerRepo = createPractitionerRepository(tenantId);
        const optionRepo = createOptionRepository(tenantId);

        const customer = await customerRepo.findByLineUserId(user.uid);
        if (!customer) throw new ValidationError('顧客情報が見つかりません');

        const existing = await reservationRepo.findByIdOrFail(id);
        if (existing.customerId !== customer.id) {
            throw new ValidationError('この予約を変更する権限がありません');
        }

        if (existing.status !== 'pending' && existing.status !== 'confirmed') {
            throw new ValidationError('この予約は変更できません');
        }

        // Treat reschedule as a cancellation-like operation for policy purposes.
        const existingStoreId = existing.storeId ?? (req as { storeId?: string }).storeId;
        const { policy: existingPolicy } = await resolveStoreContext(tenantId, existingStoreId);
        enforceCancelPolicy(existing, existingPolicy);

        const {
            practitionerId,
            menuIds,
            optionIds,
            date,
            startTime,
            customerNote,
            notificationToken,
            customerName,
            customerPhone,
            isNomination,
            storeId,
        } = req.body;

        const targetStoreId = storeId ?? existing.storeId ?? (req as { storeId?: string }).storeId;
        const { store, policy } = await resolveStoreContext(tenantId, targetStoreId);
        enforceAdvanceBookingPolicy(date, policy);

        const newPractitionerId = practitionerId ?? existing.practitionerId;
        const newMenuIds = menuIds ?? existing.menuIds ?? [];
        const newOptionIds = optionIds ?? existing.optionIds ?? [];

        const practitioner = await practitionerRepo.findByIdOrFail(newPractitionerId);
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

        const [hours, minutes] = startTime.split(':').map(Number);
        const endMinutes = hours * 60 + minutes + totalDuration;
        const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60)
            .toString()
            .padStart(2, '0')}`;

        const hasConflict = await reservationRepo.hasConflict(newPractitionerId, date, startTime, endTime, {
            excludeReservationId: id,
            timezone: policy.timezone,
        });
        if (hasConflict) {
            throw new ConflictError('選択された時間帯はすでに予約が入っています');
        }

        await customerRepo.update(customer.id, {
            name: customerName || customer.name,
            phone: customerPhone || customer.phone,
            lineNotificationToken: notificationToken || customer.lineNotificationToken,
        });

        const updated = await reservationRepo.updateWithItems(
            id,
            {
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
                date,
                startTime,
                endTime,
                duration: totalDuration,
                totalPrice,
                status: existing.status,
                source: existing.source,
                customerNote: customerNote ?? existing.customerNote,
                staffNote: existing.staffNote,
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
                salonboardReservationId: existing.salonboardReservationId,
            } as Omit<Reservation, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
            policy.timezone
        );

        const targetToken = customer.lineNotificationToken || customer.lineUserId;
        if (targetToken) {
            const messageService = createServiceMessageService(tenantId);
            messageService
                .sendModificationNotice(
                    targetToken,
                    updated,
                    '日時変更',
                    `${existing.date} ${existing.startTime}`,
                    `${updated.date} ${updated.startTime}`
                )
                .catch((err) => {
                    console.error('Failed to send modification notice', err);
                });
        }

        // Google Calendar sync (best-effort)
        const oldPractitioner = existing.practitionerId === newPractitionerId
            ? practitioner
            : await practitionerRepo.findById(existing.practitionerId);
        if (oldPractitioner?.calendarId || practitioner.calendarId) {
            const googleService = createGoogleCalendarService(tenantId);
            const queue = createGoogleCalendarSyncQueueService(tenantId);

            if (
                existing.googleCalendarEventId &&
                oldPractitioner?.calendarId &&
                oldPractitioner.calendarId !== practitioner.calendarId
            ) {
                googleService
                    .syncDeleteEvent(oldPractitioner.calendarId, existing.googleCalendarEventId)
                    .then(() => reservationRepo.clearGoogleCalendarRefs(updated.id))
                    .catch((error) => {
                        console.error('Failed to delete Google Calendar event', error);
                        queue
                            .enqueue({
                                reservationId: updated.id,
                                action: 'delete',
                                calendarId: oldPractitioner.calendarId,
                                eventId: existing.googleCalendarEventId,
                            })
                            .catch(() => undefined);
                    });
                if (practitioner.calendarId) {
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
                            queue
                                .enqueue({
                                    reservationId: updated.id,
                                    action: 'create',
                                    calendarId: practitioner.calendarId,
                                })
                                .catch(() => undefined);
                        });
                }
            } else if (existing.googleCalendarEventId && practitioner.calendarId) {
                const calendarId = existing.googleCalendarId || practitioner.calendarId;
                googleService
                    .syncUpdateEvent(calendarId, existing.googleCalendarEventId, updated, store.timezone || 'Asia/Tokyo')
                    .catch((error) => {
                        console.error('Failed to update Google Calendar event', error);
                        queue
                            .enqueue({
                                reservationId: updated.id,
                                action: 'update',
                                calendarId,
                                eventId: existing.googleCalendarEventId,
                            })
                            .catch(() => undefined);
                    });
            } else if (!existing.googleCalendarEventId && practitioner.calendarId) {
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
            actorType: 'customer',
            actorId: user.uid,
            actorName: customerName || user.name,
            oldValues: existing as unknown as Record<string, unknown>,
            newValues: updated as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Reservation> = { success: true, data: updated };
        res.json(response);
    })
);

	router.delete(
	    '/:id',
	    requireLineAuth(),
	    validateParams(idParamSchema),
	    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const user = getUser(req);
        if (!user) throw new AuthenticationError('認証が必要です');

        const id = req.params.id as string;

        const customerRepo = createCustomerRepository(tenantId);
        const reservationRepo = createReservationRepository(tenantId);
        const practitionerRepo = createPractitionerRepository(tenantId);

        const customer = await customerRepo.findByLineUserId(user.uid);
        if (!customer) throw new ValidationError('顧客情報が見つかりません');

        const reservation = await reservationRepo.findByIdOrFail(id);
        if (reservation.customerId !== customer.id) {
            throw new ValidationError('この予約をキャンセルする権限がありません');
        }

        const { policy } = await resolveStoreContext(tenantId, reservation.storeId);
        enforceCancelPolicy(reservation, policy);

        const canceled = await reservationRepo.cancel(id, 'お客様によるキャンセル');
        await customerRepo.incrementCancel(customer.id);

        if (reservation.googleCalendarEventId) {
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

        const targetToken = customer.lineNotificationToken || customer.lineUserId;
        if (targetToken) {
            const messageService = createServiceMessageService(tenantId);
            messageService.sendCancellationNotice(targetToken, canceled, 'customer-cancel').catch((error) => {
                console.error('Failed to send cancellation notice', error);
            });
        }

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'reservation',
            entityId: canceled.id,
            actorType: 'customer',
            actorId: user.uid,
            actorName: customer.name,
            oldValues: reservation as unknown as Record<string, unknown>,
            newValues: canceled as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Reservation> = {
            success: true,
            data: canceled,
        };

        res.json(response);
    })
);

export const reservationCustomerRoutes = router;
