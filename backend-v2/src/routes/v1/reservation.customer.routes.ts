import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { formatInTimeZone } from 'date-fns-tz';
import {
    asyncHandler,
    validateBody,
    validateParams,
    idParamSchema,
} from '../../middleware/index.js';
import { getTenantId } from '../../middleware/tenant.js';
import { requireLineAuth, getUser } from '../../middleware/auth.js';
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
import { createBookingLinkTokenService } from '../../services/booking-link-token.service.js';
import { ValidationError, AuthenticationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { ApiResponse, Reservation } from '../../types/index.js';

const router = Router();

const createReservationSchema = z.object({
    practitionerId: z.string().min(1, '施術者を選択してください'),
    menuIds: z.array(z.string()).min(1, 'メニューを選択してください'),
    optionIds: z.array(z.string()).optional().default([]),
    startsAt: z.string().datetime({ message: 'startsAt は ISO 8601 形式で指定してください' }),
    timezone: z.string().max(100).optional(),
    customerNote: z.string().max(500).optional(),
    isNomination: z.boolean().optional(),
    notificationToken: z.string().optional(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    storeId: z.string().optional(),
    // Opaque token from the booking link URL (?t=TOKEN).
    // When present, the server validates that the practitionerId and storeId
    // in the request match the token so the nominated practitioner cannot be swapped.
    bookingToken: z.string().optional(),
});

const updateReservationSchema = z.object({
    practitionerId: z.string().optional(),
    menuIds: z.array(z.string()).min(1, 'メニューを選択してください').optional(),
    optionIds: z.array(z.string()).optional().default([]),
    startsAt: z.string().datetime().optional(),
    timezone: z.string().max(100).optional(),
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
            startsAt,
            timezone,
            customerNote,
            notificationToken,
            customerName,
            customerPhone,
            isNomination,
            storeId,
            bookingToken,
        } = req.body;

        // When a booking link token is supplied, validate it server-side so the
        // nominated practitioner cannot be swapped by a manipulated request body.
        let tokenStoreId: string | undefined;
        let tokenForcesNomination = false;
        if (bookingToken) {
            const tokenService = createBookingLinkTokenService();
            const resolved = await tokenService.resolve(bookingToken);
            if (!resolved) {
                throw new ValidationError('無効または期限切れの予約URLです');
            }
            if (resolved.practitionerId !== practitionerId) {
                throw new ValidationError('この予約URLで指定された施術者と一致しません');
            }
            if (resolved.storeId && storeId && resolved.storeId !== storeId) {
                throw new ValidationError('この予約URLで指定された店舗と一致しません');
            }
            tokenStoreId = resolved.storeId;
            tokenForcesNomination = true;
        }

        const effectiveStoreId = storeId || tokenStoreId || (req as { storeId?: string }).storeId;
        const { store, policy } = await resolveStoreContext(tenantId, effectiveStoreId);
        const reservationService = createReservationService(tenantId);
        const tz = timezone || policy.timezone || 'Asia/Tokyo';
        const startsAtDate = new Date(startsAt);
        const localDate = formatInTimeZone(startsAtDate, tz, 'yyyy-MM-dd');
        enforceAdvanceBookingPolicy(localDate, policy);

        const customerRepo = createCustomerRepository(tenantId);

        const practitioner = await reservationService.validatePractitioner(practitionerId, store.id);
        const resolved = await reservationService.resolveMenusAndOptions(menuIds, optionIds || []);
        const effectiveIsNomination = tokenForcesNomination || (isNomination ?? false);
        const nominationFee = effectiveIsNomination ? (practitioner.nominationFee ?? 0) : 0;
        const totalPrice = resolved.menuPrice + resolved.optionPrice + nominationFee;
        const endsAt = new Date(startsAtDate.getTime() + resolved.totalDuration * 60 * 1000).toISOString();

        const customer = await customerRepo.findOrCreate(user.uid, user.name || 'ゲスト', user.picture);
        await customerRepo.update(customer.id, {
            name: customerName || customer.name,
            phone: customerPhone || customer.phone,
            lineNotificationToken: notificationToken || customer.lineNotificationToken,
        });

        const reservation = await reservationService.persistCreate(
            {
                storeId: store.id,
                customerId: customer.id,
                customerName: customerName || customer.name || 'ゲスト',
                customerPhone: customerPhone || customer.phone,
                practitionerId,
                practitionerName: practitioner.name,
                menus: resolved.menus,
                options: resolved.options,
                startsAt,
                endsAt,
                timezone: tz,
                totalDuration: resolved.totalDuration,
                totalPrice,
                menuPrice: resolved.menuPrice,
                optionPrice: resolved.optionPrice,
                nominationFee,
                status: 'pending',
                source: 'line',
                customerNote,
            },
            { actorType: 'customer', actorId: user.uid, actorName: customerName || user.name },
            practitioner,
            customer,
            req
        );

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
        const reservations = [...upcoming, ...past].sort((a, b) =>
            new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
        );

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

        const customer = await customerRepo.findByLineUserId(user.uid);
        if (!customer) throw new ValidationError('顧客情報が見つかりません');

        const existing = await reservationRepo.findByIdOrFail(id);
        if (existing.customerId !== customer.id) {
            throw new ValidationError('この予約を変更する権限がありません');
        }

        if (existing.status !== 'pending' && existing.status !== 'confirmed') {
            throw new ValidationError('この予約は変更できません');
        }

        const {
            practitionerId,
            menuIds,
            optionIds,
            startsAt,
            timezone,
            customerNote,
            notificationToken,
            customerName,
            customerPhone,
            isNomination,
            storeId,
        } = req.body;

        // Treat reschedule as a cancellation-like operation for policy purposes.
        const existingStoreId = existing.storeId ?? (req as { storeId?: string }).storeId;
        const targetStoreId = storeId ?? existingStoreId;
        const existingContext = await resolveStoreContext(tenantId, existingStoreId);
        enforceCancelPolicy(existing, existingContext.policy);

        const { store, policy } = targetStoreId === existingStoreId
            ? existingContext
            : await resolveStoreContext(tenantId, targetStoreId);
        const reservationService = createReservationService(tenantId);
        const tz = timezone || policy.timezone || 'Asia/Tokyo';
        const resolvedStartsAt = startsAt ?? new Date(existing.startsAt).toISOString();
        const startsAtDate = new Date(resolvedStartsAt);
        enforceAdvanceBookingPolicy(formatInTimeZone(startsAtDate, tz, 'yyyy-MM-dd'), policy);

        const newPractitionerId = practitionerId ?? existing.practitionerId;
        const newMenuIds = menuIds ?? existing.menuIds ?? [];
        const newOptionIds = optionIds ?? existing.optionIds ?? [];

        const practitioner = await reservationService.validatePractitioner(newPractitionerId, store.id);
        const resolved = await reservationService.resolveMenusAndOptions(newMenuIds, newOptionIds);

        const applyNomination = isNomination ?? ((existing.nominationFee ?? 0) > 0);
        const nominationFee = applyNomination ? (practitioner.nominationFee ?? 0) : 0;
        const totalPrice = resolved.menuPrice + resolved.optionPrice + nominationFee;
        const resolvedEndsAt = new Date(startsAtDate.getTime() + resolved.totalDuration * 60 * 1000).toISOString();

        await customerRepo.update(customer.id, {
            name: customerName || customer.name,
            phone: customerPhone || customer.phone,
            lineNotificationToken: notificationToken || customer.lineNotificationToken,
        });

        const updated = await reservationService.persistUpdate(
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
                startsAt: resolvedStartsAt,
                endsAt: resolvedEndsAt,
                timezone: tz,
                totalDuration: resolved.totalDuration,
                totalPrice,
                menuPrice: resolved.menuPrice,
                optionPrice: resolved.optionPrice,
                nominationFee,
                status: existing.status,
                source: existing.source,
                customerNote: customerNote ?? existing.customerNote,
                staffNote: existing.staffNote,
                existingGoogleCalendarId: existing.googleCalendarId,
                existingGoogleCalendarEventId: existing.googleCalendarEventId,
                existingSalonboardReservationId: existing.salonboardReservationId,
            },
            existing,
            { actorType: 'customer', actorId: user.uid, actorName: customerName || user.name },
            practitioner,
            customer,
            req,
            {
                changeType: '日時変更',
                oldValue: formatInTimeZone(new Date(existing.startsAt), tz, 'yyyy-MM-dd HH:mm'),
                newValue: formatInTimeZone(startsAtDate, tz, 'yyyy-MM-dd HH:mm'),
            }
        );

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

        const practitioner = await practitionerRepo.findById(reservation.practitionerId);
        createGoogleCalendarSyncService(tenantId).syncReservationDeletion(reservation, practitioner ?? null);

        const targetToken = customer.lineNotificationToken || customer.lineUserId;
        if (targetToken) {
            const messageService = createServiceMessageService(tenantId);
            messageService.sendCancellationNotice(targetToken, canceled, 'customer-cancel').catch((error) => {
                logger.error('Failed to send cancellation notice', { reservationId: canceled.id, error: error instanceof Error ? error.message : String(error) });
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
