import { formatInTimeZone } from 'date-fns-tz';
import { createPractitionerRepository, createReservationRepository } from '../repositories/index.js';
import { createSalonboardConfigRepository, type SalonboardConfigRecord, type SalonboardSyncDirection, type SalonboardSyncStatus } from '../repositories/salonboard.repository.js';
import { writeAuditLog } from './audit-log.service.js';
import type { Reservation } from '../types/index.js';

export interface SalonboardIntegrationView {
    connected: boolean;
    isEnabled: boolean;
    syncDirection: SalonboardSyncDirection;
    hasCredentials: boolean;
    lastSyncAt?: string;
    lastSyncStatus?: SalonboardSyncStatus;
    lastSyncError?: string;
}

export interface SalonboardExternalReservation {
    externalId: string;
    practitionerStaffId: string;
    customerId: string;
    customerName?: string;
    customerPhone?: string;
    storeId?: string;
    startsAt: string;
    endsAt: string;
    timezone?: string;
    status?: Reservation['status'];
    source?: Reservation['source'];
    totalPrice?: number;
    duration?: number;
    customerNote?: string;
    staffNote?: string;
    menuIds?: string[];
    menuNames?: string[];
    optionIds?: string[];
    optionNames?: string[];
}

export interface SalonboardClient {
    fetchReservations(input: {
        config: SalonboardConfigRecord;
        since?: Date;
        trigger: 'manual' | 'scheduler';
    }): Promise<SalonboardExternalReservation[]>;
}

export interface SalonboardSyncResult {
    trigger: 'manual' | 'scheduler';
    fetched: number;
    created: number;
    updated: number;
    conflicts: number;
    skipped: number;
    status: 'success' | 'partial' | 'failed' | 'skipped';
}

export interface SalonboardServiceDependencies {
    configRepository?: ReturnType<typeof createSalonboardConfigRepository>;
    reservationRepository?: ReturnType<typeof createReservationRepository>;
    practitionerRepository?: ReturnType<typeof createPractitionerRepository>;
    client?: SalonboardClient;
    auditLogWriter?: typeof writeAuditLog;
}

function isReservationStatus(value: unknown): value is Reservation['status'] {
    return value === 'pending'
        || value === 'confirmed'
        || value === 'canceled'
        || value === 'completed'
        || value === 'no_show';
}

function toView(config: SalonboardConfigRecord): SalonboardIntegrationView {
    const hasCredentials = Boolean(config.username || config.password || config.sessionCookie);
    return {
        connected: config.isEnabled && hasCredentials,
        isEnabled: config.isEnabled,
        syncDirection: config.syncDirection,
        hasCredentials,
        lastSyncAt: config.lastSyncAt ? config.lastSyncAt.toISOString() : undefined,
        lastSyncStatus: config.lastSyncStatus,
        lastSyncError: config.lastSyncError,
    };
}

function buildReservationInput(
    reservation: SalonboardExternalReservation,
    practitionerId: string,
    practitionerName: string
): Partial<Reservation> {
    const timezone = reservation.timezone || 'Asia/Tokyo';
    const startsAt = new Date(reservation.startsAt);
    const endsAt = new Date(reservation.endsAt);
    const menuIds = reservation.menuIds ?? [];
    const menuNames = reservation.menuNames ?? [];
    const optionIds = reservation.optionIds ?? [];
    const optionNames = reservation.optionNames ?? [];

    return {
        storeId: reservation.storeId,
        customerId: reservation.customerId,
        customerName: reservation.customerName,
        customerPhone: reservation.customerPhone,
        practitionerId,
        practitionerName,
        startsAt: startsAt,
        endsAt: endsAt,
        timezone,
        duration: reservation.duration ?? Math.max(0, Math.round((endsAt.getTime() - startsAt.getTime()) / 60000)),
        totalPrice: reservation.totalPrice ?? 0,
        menuIds,
        menuNames,
        optionIds,
        optionNames,
        customerNote: reservation.customerNote,
        staffNote: reservation.staffNote,
        status: isReservationStatus(reservation.status) ? reservation.status : 'confirmed',
        source: reservation.source ?? 'salonboard',
    };
}

export class SalonboardService {
    private readonly configRepository: ReturnType<typeof createSalonboardConfigRepository>;
    private readonly reservationRepository: ReturnType<typeof createReservationRepository>;
    private readonly practitionerRepository: ReturnType<typeof createPractitionerRepository>;
    private readonly client: SalonboardClient;
    private readonly auditLogWriter: typeof writeAuditLog;

    constructor(
        private readonly tenantId: string,
        dependencies: SalonboardServiceDependencies = {}
    ) {
        this.configRepository = dependencies.configRepository ?? createSalonboardConfigRepository(tenantId);
        this.reservationRepository = dependencies.reservationRepository ?? createReservationRepository(tenantId);
        this.practitionerRepository = dependencies.practitionerRepository ?? createPractitionerRepository(tenantId);
        this.client = dependencies.client ?? {
            async fetchReservations() {
                return [];
            },
        };
        this.auditLogWriter = dependencies.auditLogWriter ?? writeAuditLog;
    }

    async getStatus(): Promise<SalonboardIntegrationView> {
        return toView(await this.configRepository.get());
    }

    async updateSettings(input: {
        isEnabled?: boolean;
        syncDirection?: SalonboardSyncDirection;
        username?: string;
        password?: string;
        sessionCookie?: string;
    }): Promise<SalonboardIntegrationView> {
        const config = await this.configRepository.upsert(input);
        return toView(config);
    }

    async sync(trigger: 'manual' | 'scheduler'): Promise<SalonboardSyncResult> {
        const config = await this.configRepository.get();
        if (!config.isEnabled) {
            const result: SalonboardSyncResult = {
                trigger,
                fetched: 0,
                created: 0,
                updated: 0,
                conflicts: 0,
                skipped: 0,
                status: 'skipped',
            };

            await this.auditLogWriter({
                tenantId: this.tenantId,
                action: 'SKIP',
                entityType: 'salonboard_sync',
                entityId: this.tenantId,
                actorType: 'system',
                actorId: trigger,
                newValues: result as unknown as Record<string, unknown>,
            });

            return result;
        }

        try {
            const reservations = await this.client.fetchReservations({
                config,
                since: config.lastSyncAt,
                trigger,
            });

            let created = 0;
            let updated = 0;
            let conflicts = 0;
            let skipped = 0;

            for (const external of reservations) {
                const practitioner = await this.practitionerRepository.findBySalonboardStaffId(external.practitionerStaffId);
                if (!practitioner) {
                    skipped += 1;
                    await this.auditLogWriter({
                        tenantId: this.tenantId,
                        action: 'SKIP',
                        entityType: 'salonboard_reservation',
                        entityId: external.externalId,
                        actorType: 'system',
                        actorId: trigger,
                        newValues: {
                            reason: 'practitioner_not_found',
                            externalId: external.externalId,
                            practitionerStaffId: external.practitionerStaffId,
                        },
                    });
                    continue;
                }

                const existing = await this.reservationRepository.findBySalonboardReservationId(external.externalId);
                const timezone = external.timezone || 'Asia/Tokyo';
                const startsAt = new Date(external.startsAt);
                const endsAt = new Date(external.endsAt);
                const date = formatInTimeZone(startsAt, timezone, 'yyyy-MM-dd');
                const startTime = formatInTimeZone(startsAt, timezone, 'HH:mm');
                const endTime = formatInTimeZone(endsAt, timezone, 'HH:mm');

                const conflict = await this.reservationRepository.hasConflict(
                    practitioner.id,
                    date,
                    startTime,
                    endTime,
                    {
                        excludeReservationId: existing?.id,
                        timezone,
                    }
                );

                if (conflict) {
                    conflicts += 1;
                    await this.auditLogWriter({
                        tenantId: this.tenantId,
                        action: 'CONFLICT',
                        entityType: 'salonboard_reservation',
                        entityId: external.externalId,
                        actorType: 'system',
                        actorId: trigger,
                        newValues: {
                            externalId: external.externalId,
                            practitionerId: practitioner.id,
                            startsAt: external.startsAt,
                            endsAt: external.endsAt,
                        },
                    });
                    continue;
                }

                const payload = buildReservationInput(external, practitioner.id, practitioner.name);

                let persisted: Reservation;
                if (existing) {
                    persisted = await this.reservationRepository.update(existing.id, {
                        ...payload,
                    } as Partial<Reservation>);
                    updated += 1;
                } else {
                    persisted = await this.reservationRepository.create({
                        ...payload,
                        salonboardReservationId: external.externalId,
                    } as Partial<Reservation>);
                    created += 1;
                }

                await this.auditLogWriter({
                    tenantId: this.tenantId,
                    action: existing ? 'UPDATE' : 'CREATE',
                    entityType: 'salonboard_reservation',
                    entityId: persisted.id,
                    actorType: 'system',
                    actorId: trigger,
                    newValues: {
                        salonboardReservationId: external.externalId,
                        practitionerId: practitioner.id,
                        status: persisted.status,
                    },
                });
            }

            const status: SalonboardSyncResult['status'] = (conflicts > 0 || skipped > 0) ? 'partial' : 'success';
            await this.configRepository.recordSyncOutcome({
                lastSyncAt: new Date(),
                lastSyncStatus: status,
                lastSyncError: null,
            });

            const result: SalonboardSyncResult = {
                trigger,
                fetched: reservations.length,
                created,
                updated,
                conflicts,
                skipped,
                status,
            };

            await this.auditLogWriter({
                tenantId: this.tenantId,
                action: 'SYNC',
                entityType: 'salonboard_sync',
                entityId: this.tenantId,
                actorType: 'system',
                actorId: trigger,
                newValues: result as unknown as Record<string, unknown>,
            });

            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.configRepository.recordSyncOutcome({
                lastSyncAt: new Date(),
                lastSyncStatus: 'failed',
                lastSyncError: message,
            });
            await this.auditLogWriter({
                tenantId: this.tenantId,
                action: 'SYNC_FAILED',
                entityType: 'salonboard_sync',
                entityId: this.tenantId,
                actorType: 'system',
                actorId: trigger,
                newValues: { error: message },
            });
            throw error;
        }
    }
}

export function createSalonboardService(
    tenantId: string,
    dependencies?: SalonboardServiceDependencies
): SalonboardService {
    return new SalonboardService(tenantId, dependencies);
}
