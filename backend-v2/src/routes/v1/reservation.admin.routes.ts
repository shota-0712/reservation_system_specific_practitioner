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
import { requirePermission } from '../../middleware/auth.js';
import {
    createReservationRepository,
    createCustomerRepository,
    createPractitionerRepository,
} from '../../repositories/index.js';
import { createServiceMessageService } from '../../services/service-message.service.js';
import { createGoogleCalendarSyncService } from '../../services/google-calendar-sync.service.js';
import { createReservationService } from '../../services/reservation.service.js';
import {
    enforceAdvanceBookingPolicy,
    enforceCancelPolicy,
    resolveStoreContext,
} from '../../services/reservation-policy.service.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import { ValidationError } from '../../utils/errors.js';
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
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    timezone: z.string().max(100).optional(),
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
    date: dateSchema.optional(),
    startTime: timeSchema.optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    timezone: z.string().max(100).optional(),
    status: z.enum(['pending', 'confirmed']).optional(),
    isNomination: z.boolean().optional(),
    customerNote: z.string().max(500).optional(),
    staffNote: z.string().max(500).optional(),
    source: z.enum(['line', 'phone', 'walk_in', 'salonboard', 'hotpepper', 'web', 'admin', 'google_calendar']).optional(),
    storeId: z.string().optional(),
}).superRefine((value, ctx) => {
    if (!(value.startsAt || (value.date && value.startTime))) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'date/startTime または startsAt のいずれかを指定してください',
            path: ['startsAt'],
        });
    }
});

const reservationFiltersSchema = paginationSchema.extend({
    status: z.enum(['pending', 'confirmed', 'completed', 'canceled', 'no_show']).optional(),
    practitionerId: z.string().optional(),
    customerId: z.string().optional(),
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
    date: dateSchema.optional(),
});

router.get(
    '/',
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
            startsAt,
            timezone,
            status,
            isNomination,
            customerNote,
            staffNote,
            source,
            storeId,
        } = req.body;

        const { store, policy } = await resolveStoreContext(tenantId, storeId || (req as { storeId?: string }).storeId);

        const customerRepo = createCustomerRepository(tenantId);

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

        const svc = createReservationService(tenantId);
        const resolvedDateTime = svc.resolveDateTimeInput(
            { date, startTime, startsAt, timezone },
            policy.timezone
        );
        enforceAdvanceBookingPolicy(resolvedDateTime.date, policy);
        const practitioner = await svc.validatePractitioner(practitionerId, store.id);
        const resolved = await svc.resolveMenusAndOptions(menuIds, optionIds || []);
        const nominationFee = isNomination ? (practitioner.nominationFee ?? 0) : 0;
        const totalPrice = resolved.menuPrice + resolved.optionPrice + nominationFee;
        const endTime = svc.calcEndTime(resolvedDateTime.startTime, resolved.totalDuration);

        await svc.assertNoConflict(practitionerId, resolvedDateTime.date, resolvedDateTime.startTime, endTime, {
            timezone: resolvedDateTime.timezone,
        });

        const reservation = await svc.persistCreate(
            {
                storeId: store.id,
                customerId: customer.id,
                customerName: customer.name,
                customerPhone: customer.phone,
                practitionerId,
                practitionerName: practitioner.name,
                menus: resolved.menus,
                options: resolved.options,
                date: resolvedDateTime.date,
                startTime: resolvedDateTime.startTime,
                endTime,
                totalDuration: resolved.totalDuration,
                totalPrice,
                menuPrice: resolved.menuPrice,
                optionPrice: resolved.optionPrice,
                nominationFee,
                status: status ?? 'confirmed',
                source: source ?? 'admin',
                customerNote,
                staffNote,
            },
            { actorType: 'admin', actorId: (req as any).user?.uid, actorName: (req as any).user?.name },
            practitioner,
            customer,
            resolvedDateTime.timezone,
            req
        );

        const response: ApiResponse<Reservation> = { success: true, data: reservation };
        res.status(201).json(response);
    })
);

router.put(
    '/:id',
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
            startsAt,
            timezone,
            status,
            isNomination,
            customerNote,
            staffNote,
            source,
            storeId,
        } = req.body;

        const reservationRepo = createReservationRepository(tenantId);
        const customerRepo = createCustomerRepository(tenantId);

        const existing = await reservationRepo.findByIdOrFail(id);

        const targetStoreId = storeId ?? existing.storeId ?? (req as { storeId?: string }).storeId;
        const { store, policy } = await resolveStoreContext(tenantId, targetStoreId);
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

        const svc = createReservationService(tenantId);
        const practitioner = await svc.validatePractitioner(newPractitionerId, store.id);
        const resolved = await svc.resolveMenusAndOptions(newMenuIds, newOptionIds);

        const applyNomination = isNomination ?? ((existing.nominationFee ?? 0) > 0);
        const nominationFee = applyNomination ? (practitioner.nominationFee ?? 0) : 0;
        const totalPrice = resolved.menuPrice + resolved.optionPrice + nominationFee;

        const resolvedDateTime = startsAt || date || startTime || timezone
            ? svc.resolveDateTimeInput(
                {
                    date: date ?? existing.date,
                    startTime: startTime ?? existing.startTime,
                    startsAt,
                    timezone,
                },
                policy.timezone
            )
            : {
                date: existing.date,
                startTime: existing.startTime,
                timezone: policy.timezone,
            };
        const newDate = resolvedDateTime.date;
        const newStartTime = resolvedDateTime.startTime;
        const scheduleChanged = existing.date !== newDate || existing.startTime !== newStartTime;
        if (scheduleChanged) {
            enforceAdvanceBookingPolicy(newDate, policy);
        }
        const endTime = svc.calcEndTime(newStartTime, resolved.totalDuration);

        await svc.assertNoConflict(newPractitionerId, newDate, newStartTime, endTime, {
            excludeReservationId: id,
            timezone: resolvedDateTime.timezone,
        });

        // Build change notification (skip if status is explicitly changed — handled by PATCH /:id/status)
        let notifyChange: { changeType: string; oldValue: string; newValue: string } | undefined;
        if (!status || status === existing.status) {
            let changeType = '予約内容変更';
            let oldValue = `${existing.date} ${existing.startTime}`;
            let newValue = `${newDate} ${newStartTime}`;
            if (scheduleChanged) {
                changeType = '日時変更';
            } else if (JSON.stringify(existing.menuIds || []) !== JSON.stringify(newMenuIds)) {
                changeType = 'メニュー変更';
                oldValue = (existing.menuNames || []).join('、');
                newValue = resolved.menus.map((m) => m.name).join('、');
            }
            notifyChange = { changeType, oldValue, newValue };
        }

        const updated = await svc.persistUpdate(
            id,
            {
                storeId: store.id,
                customerId: customer.id,
                customerName: customerName || existing.customerName || customer.name,
                customerPhone: customerPhone || existing.customerPhone || customer.phone,
                practitionerId: newPractitionerId,
                practitionerName: practitioner.name,
                menus: resolved.menus,
                options: resolved.options,
                date: newDate,
                startTime: newStartTime,
                endTime,
                totalDuration: resolved.totalDuration,
                totalPrice,
                menuPrice: resolved.menuPrice,
                optionPrice: resolved.optionPrice,
                nominationFee,
                status: status ?? existing.status,
                source: source ?? existing.source,
                customerNote: customerNote ?? existing.customerNote,
                staffNote: staffNote ?? existing.staffNote,
                existingGoogleCalendarId: existing.googleCalendarId,
                existingGoogleCalendarEventId: existing.googleCalendarEventId,
            },
            existing,
            { actorType: 'admin', actorId: (req as any).user?.uid, actorName: (req as any).user?.name },
            practitioner,
            customer,
            resolvedDateTime.timezone,
            req,
            notifyChange
        );

        const response: ApiResponse<Reservation> = { success: true, data: updated };
        res.json(response);
    })
);

router.get(
    '/today',
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
    requirePermission('canManageReservations'),
    validateParams(z.object({ date: dateSchema })),
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

        if (status === 'canceled' || status === 'no_show') {
            const practitioner = await practitionerRepo.findById(reservation.practitionerId);
            createGoogleCalendarSyncService(tenantId).syncReservationDeletion(reservation, practitioner ?? null);
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
