import {
    createReservationRepository,
    createMenuRepository,
    createPractitionerRepository,
    createOptionRepository,
    createCustomerRepository,
} from '../repositories/index.js';
import { createServiceMessageService } from './service-message.service.js';
import { createGoogleCalendarSyncService } from './google-calendar-sync.service.js';
import { getRequestMeta, writeAuditLog } from './audit-log.service.js';
import { ConflictError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatInTimeZone } from 'date-fns-tz';
import type { Request } from 'express';
import type { Menu, Option, Practitioner, Reservation } from '../types/index.js';

export interface ResolvedMenusAndOptions {
    menus: Menu[];
    options: Option[];
    totalDuration: number;
    menuPrice: number;
    optionPrice: number;
}

export interface ActorContext {
    actorType: 'admin' | 'customer';
    actorId?: string;
    actorName?: string;
}

export interface ReservationCreateParams {
    storeId: string;
    customerId: string;
    customerName?: string;
    customerPhone?: string;
    practitionerId: string;
    practitionerName: string;
    menus: Menu[];
    options: Option[];
    startsAt: string;          // ISO timestamp
    endsAt: string;            // ISO timestamp (server-computed)
    timezone: string;
    totalDuration: number;
    totalPrice: number;
    menuPrice: number;
    optionPrice: number;
    nominationFee: number;
    status: Reservation['status'];
    source: Reservation['source'];
    customerNote?: string;
    staffNote?: string;
}

export interface ReservationUpdateParams extends ReservationCreateParams {
    existingGoogleCalendarId?: string;
    existingGoogleCalendarEventId?: string;
    existingSalonboardReservationId?: string;
}

export interface ReservationTimeInput {
    date?: string;
    startTime?: string;
    startsAt?: string;
    timezone?: string;
}

function practitionerMatchesStore(storeIds: string[] | undefined, storeId: string): boolean {
    const ids = storeIds ?? [];
    if (ids.length === 0) return true;
    return ids.includes(storeId);
}

export class ReservationService {
    constructor(private tenantId: string) {}

    resolveDateTimeInput(
        input: ReservationTimeInput,
        fallbackTimezone: string
    ): { date: string; startTime: string; timezone: string } {
        const timezone = input.timezone || fallbackTimezone || 'Asia/Tokyo';
        if (input.date && input.startTime) {
            return {
                date: input.date,
                startTime: input.startTime,
                timezone,
            };
        }
        if (input.startsAt) {
            const startsAt = new Date(input.startsAt);
            if (Number.isNaN(startsAt.getTime())) {
                throw new ValidationError('startsAt の形式が不正です');
            }
            return {
                date: formatInTimeZone(startsAt, timezone, 'yyyy-MM-dd'),
                startTime: formatInTimeZone(startsAt, timezone, 'HH:mm'),
                timezone,
            };
        }
        throw new ValidationError('date/startTime または startsAt のいずれかが必要です');
    }

    /**
     * Calculate end time string (HH:mm) from start time + duration minutes.
     */
    calcEndTime(startTime: string, durationMinutes: number): string {
        const [hours, minutes] = startTime.split(':').map(Number);
        const endMinutes = hours * 60 + minutes + durationMinutes;
        return `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60)
            .toString()
            .padStart(2, '0')}`;
    }

    /**
     * Fetch and validate practitioner; throw ValidationError if not assigned to the given store.
     */
    async validatePractitioner(practitionerId: string, storeId: string): Promise<Practitioner> {
        const practitionerRepo = createPractitionerRepository(this.tenantId);
        const practitioner = await practitionerRepo.findByIdOrFail(practitionerId);
        if (!practitionerMatchesStore(practitioner.storeIds, storeId)) {
            throw new ValidationError('選択された施術者はこの店舗では利用できません');
        }
        return practitioner;
    }

    /**
     * Fetch menus and options, computing price/duration totals.
     */
    async resolveMenusAndOptions(menuIds: string[], optionIds: string[]): Promise<ResolvedMenusAndOptions> {
        const menuRepo = createMenuRepository(this.tenantId);
        const optionRepo = createOptionRepository(this.tenantId);

        const menus = await Promise.all(menuIds.map((id) => menuRepo.findByIdOrFail(id)));
        const options = await Promise.all(optionIds.map((id) => optionRepo.findByIdOrFail(id)));

        return {
            menus,
            options,
            totalDuration:
                menus.reduce((sum, m) => sum + m.duration, 0) +
                options.reduce((sum, o) => sum + o.duration, 0),
            menuPrice: menus.reduce((sum, m) => sum + m.price, 0),
            optionPrice: options.reduce((sum, o) => sum + o.price, 0),
        };
    }

    /**
     * Throw ConflictError if the practitioner already has an overlapping booking.
     */
    async assertNoConflict(
        practitionerId: string,
        date: string,
        startTime: string,
        endTime: string,
        options?: { excludeReservationId?: string; timezone?: string }
    ): Promise<void> {
        const reservationRepo = createReservationRepository(this.tenantId);
        const hasConflict = await reservationRepo.hasConflict(
            practitionerId,
            date,
            startTime,
            endTime,
            options
        );
        if (hasConflict) {
            throw new ConflictError('選択された時間帯はすでに予約が入っています');
        }
    }

    /**
     * Persist a new reservation, then fire-and-forget LINE notification + GCal sync + audit log.
     */
    async persistCreate(
        params: ReservationCreateParams,
        actor: ActorContext,
        practitioner: Practitioner,
        notificationTarget: { lineNotificationToken?: string; lineUserId?: string } | null,
        req: Request
    ): Promise<Reservation> {
        const reservationRepo = createReservationRepository(this.tenantId);

        const reservation = await reservationRepo.create(
            {
                storeId: params.storeId,
                customerId: params.customerId,
                customerName: params.customerName,
                customerPhone: params.customerPhone,
                practitionerId: params.practitionerId,
                practitionerName: params.practitionerName,
                menuIds: params.menus.map((m) => m.id),
                menuNames: params.menus.map((m) => m.name),
                optionIds: params.options.map((o) => o.id),
                optionNames: params.options.map((o) => o.name),
                startsAt: params.startsAt,
                endsAt: params.endsAt,
                timezone: params.timezone,
                duration: params.totalDuration,
                totalPrice: params.totalPrice,
                status: params.status,
                source: params.source,
                customerNote: params.customerNote,
                staffNote: params.staffNote,
                subtotal: params.menuPrice,
                optionTotal: params.optionPrice,
                nominationFee: params.nominationFee,
                menuItems: params.menus.map((m, idx) => ({
                    menuId: m.id,
                    menuName: m.name,
                    menuPrice: m.price,
                    menuDuration: m.duration,
                    sortOrder: idx,
                    isMain: idx === 0,
                })),
                optionItems: params.options.map((o) => ({
                    optionId: o.id,
                    optionName: o.name,
                    optionPrice: o.price,
                    optionDuration: o.duration,
                })),
            } as unknown as Omit<Reservation, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
        );

        const targetToken =
            notificationTarget?.lineNotificationToken || notificationTarget?.lineUserId;
        if (targetToken) {
            const messageService = createServiceMessageService(this.tenantId);
            messageService.sendConfirmation(targetToken, reservation).catch((err) => {
                logger.error('Failed to send confirmation', {
                    reservationId: reservation.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        }

        createGoogleCalendarSyncService(this.tenantId).syncReservationCreation(
            reservation,
            practitioner,
            params.timezone
        );

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId: this.tenantId,
            action: 'CREATE',
            entityType: 'reservation',
            entityId: reservation.id,
            actorType: actor.actorType,
            actorId: actor.actorId,
            actorName: actor.actorName,
            newValues: reservation as unknown as Record<string, unknown>,
            ...meta,
        });

        return reservation;
    }

    /**
     * Persist a reservation update, then fire-and-forget LINE notification + GCal sync + audit log.
     */
    async persistUpdate(
        id: string,
        params: ReservationUpdateParams,
        existing: Reservation,
        actor: ActorContext,
        practitioner: Practitioner,
        notificationTarget: { lineNotificationToken?: string; lineUserId?: string } | null,
        req: Request,
        notifyChange?: { changeType: string; oldValue: string; newValue: string }
    ): Promise<Reservation> {
        const reservationRepo = createReservationRepository(this.tenantId);
        const practitionerRepo = createPractitionerRepository(this.tenantId);
        const customerRepo = createCustomerRepository(this.tenantId);

        const updated = await reservationRepo.updateWithItems(
            id,
            {
                storeId: params.storeId,
                customerId: params.customerId,
                customerName: params.customerName,
                customerPhone: params.customerPhone,
                practitionerId: params.practitionerId,
                practitionerName: params.practitionerName,
                menuIds: params.menus.map((m) => m.id),
                menuNames: params.menus.map((m) => m.name),
                optionIds: params.options.map((o) => o.id),
                optionNames: params.options.map((o) => o.name),
                startsAt: params.startsAt,
                endsAt: params.endsAt,
                timezone: params.timezone,
                duration: params.totalDuration,
                totalPrice: params.totalPrice,
                status: params.status,
                source: params.source,
                customerNote: params.customerNote,
                staffNote: params.staffNote,
                subtotal: params.menuPrice,
                optionTotal: params.optionPrice,
                nominationFee: params.nominationFee,
                menuItems: params.menus.map((m, idx) => ({
                    menuId: m.id,
                    menuName: m.name,
                    menuPrice: m.price,
                    menuDuration: m.duration,
                    sortOrder: idx,
                    isMain: idx === 0,
                })),
                optionItems: params.options.map((o) => ({
                    optionId: o.id,
                    optionName: o.name,
                    optionPrice: o.price,
                    optionDuration: o.duration,
                })),
                googleCalendarId: params.existingGoogleCalendarId,
                googleCalendarEventId: params.existingGoogleCalendarEventId,
                salonboardReservationId: params.existingSalonboardReservationId,
            } as unknown as Omit<Reservation, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
        );

        const affectedCustomerIds = new Set([existing.customerId, updated.customerId]);
        for (const customerId of affectedCustomerIds) {
            await customerRepo.syncReservationStats(customerId);
        }

        if (notifyChange) {
            const targetToken =
                notificationTarget?.lineNotificationToken || notificationTarget?.lineUserId;
            if (targetToken) {
                const messageService = createServiceMessageService(this.tenantId);
                messageService
                    .sendModificationNotice(
                        targetToken,
                        updated,
                        notifyChange.changeType,
                        notifyChange.oldValue,
                        notifyChange.newValue
                    )
                    .catch(() => undefined);
            }
        }

        const oldPractitioner =
            existing.practitionerId === params.practitionerId
                ? practitioner
                : await practitionerRepo.findById(existing.practitionerId);
        createGoogleCalendarSyncService(this.tenantId).syncReservationUpdate(
            existing,
            updated,
            oldPractitioner,
            practitioner,
            params.timezone
        );

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId: this.tenantId,
            action: 'UPDATE',
            entityType: 'reservation',
            entityId: updated.id,
            actorType: actor.actorType,
            actorId: actor.actorId,
            actorName: actor.actorName,
            oldValues: existing as unknown as Record<string, unknown>,
            newValues: updated as unknown as Record<string, unknown>,
            ...meta,
        });

        return updated;
    }
}

export function createReservationService(tenantId: string): ReservationService {
    return new ReservationService(tenantId);
}
