import { createGoogleCalendarService } from './google-calendar.service.js';
import { createGoogleCalendarSyncQueueService } from './google-calendar-sync-queue.service.js';
import { createReservationRepository } from '../repositories/index.js';
import { logger } from '../utils/logger.js';
import type { Reservation, Practitioner } from '../types/index.js';

export class GoogleCalendarSyncService {
    constructor(private tenantId: string) {}

    /**
     * Fire-and-forget: sync a new reservation to Google Calendar.
     * On failure, enqueues a retry task.
     */
    syncReservationCreation(
        reservation: Reservation,
        practitioner: Practitioner,
        timezone: string
    ): void {
        if (!practitioner.calendarId) return;

        const googleService = createGoogleCalendarService(this.tenantId);
        const reservationRepo = createReservationRepository(this.tenantId);
        const queue = createGoogleCalendarSyncQueueService(this.tenantId);

        googleService
            .syncCreateEvent(practitioner.calendarId, reservation, timezone)
            .then(async (eventId) => {
                if (!eventId) return;
                await reservationRepo.setGoogleCalendarRefs(reservation.id, {
                    calendarId: practitioner.calendarId as string,
                    eventId,
                });
            })
            .catch((error) => {
                logger.error('Failed to sync reservation to Google Calendar', {
                    reservationId: reservation.id,
                    error: error instanceof Error ? error.message : String(error),
                });
                queue
                    .enqueue({
                        reservationId: reservation.id,
                        action: 'create',
                        calendarId: practitioner.calendarId,
                    })
                    .catch((enqueueErr) => {
                        logger.warn('Failed to enqueue Google Calendar sync task', {
                            reservationId: reservation.id,
                            action: 'create',
                            error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
                        });
                    });
            });
    }

    /**
     * Fire-and-forget: sync a reservation update to Google Calendar.
     * Handles three cases:
     *   1. Practitioner changed → delete old event, create new one
     *   2. Same practitioner, event exists → update in place
     *   3. Same practitioner, no event yet → create new
     */
    syncReservationUpdate(
        existing: Reservation,
        updated: Reservation,
        oldPractitioner: Practitioner | null,
        newPractitioner: Practitioner,
        timezone: string
    ): void {
        if (!oldPractitioner?.calendarId && !newPractitioner.calendarId) return;

        const googleService = createGoogleCalendarService(this.tenantId);
        const reservationRepo = createReservationRepository(this.tenantId);
        const queue = createGoogleCalendarSyncQueueService(this.tenantId);

        if (
            existing.googleCalendarEventId &&
            oldPractitioner?.calendarId &&
            oldPractitioner.calendarId !== newPractitioner.calendarId
        ) {
            // Practitioner changed: delete from old calendar, create on new
            googleService
                .syncDeleteEvent(oldPractitioner.calendarId, existing.googleCalendarEventId)
                .then(() => reservationRepo.clearGoogleCalendarRefs(updated.id))
                .catch((error) => {
                    logger.error('Failed to delete Google Calendar event', {
                        reservationId: updated.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    queue
                        .enqueue({
                            reservationId: updated.id,
                            action: 'delete',
                            calendarId: oldPractitioner.calendarId,
                            eventId: existing.googleCalendarEventId,
                        })
                        .catch((enqueueErr) => {
                            logger.warn('Failed to enqueue Google Calendar sync task', {
                                reservationId: updated.id,
                                action: 'delete',
                                error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
                            });
                        });
                });

            if (newPractitioner.calendarId) {
                googleService
                    .syncCreateEvent(newPractitioner.calendarId, updated, timezone)
                    .then(async (eventId) => {
                        if (!eventId) return;
                        await reservationRepo.setGoogleCalendarRefs(updated.id, {
                            calendarId: newPractitioner.calendarId as string,
                            eventId,
                        });
                    })
                    .catch((error) => {
                        logger.error('Failed to create Google Calendar event', {
                            reservationId: updated.id,
                            error: error instanceof Error ? error.message : String(error),
                        });
                        queue
                            .enqueue({
                                reservationId: updated.id,
                                action: 'create',
                                calendarId: newPractitioner.calendarId,
                            })
                            .catch((enqueueErr) => {
                                logger.warn('Failed to enqueue Google Calendar sync task', {
                                    reservationId: updated.id,
                                    action: 'create',
                                    error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
                                });
                            });
                    });
            }
        } else if (existing.googleCalendarEventId && newPractitioner.calendarId) {
            // Same practitioner: update existing event
            const calendarId = updated.googleCalendarId || newPractitioner.calendarId;
            googleService
                .syncUpdateEvent(calendarId, existing.googleCalendarEventId, updated, timezone)
                .catch((error) => {
                    logger.error('Failed to update Google Calendar event', {
                        reservationId: updated.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    queue
                        .enqueue({
                            reservationId: updated.id,
                            action: 'update',
                            calendarId,
                            eventId: existing.googleCalendarEventId,
                        })
                        .catch((enqueueErr) => {
                            logger.warn('Failed to enqueue Google Calendar sync task', {
                                reservationId: updated.id,
                                action: 'update',
                                error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
                            });
                        });
                });
        } else if (!existing.googleCalendarEventId && newPractitioner.calendarId) {
            // No existing event yet: create new
            googleService
                .syncCreateEvent(newPractitioner.calendarId, updated, timezone)
                .then(async (eventId) => {
                    if (!eventId) return;
                    await reservationRepo.setGoogleCalendarRefs(updated.id, {
                        calendarId: newPractitioner.calendarId as string,
                        eventId,
                    });
                })
                .catch((error) => {
                    logger.error('Failed to create Google Calendar event', {
                        reservationId: updated.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    queue
                        .enqueue({
                            reservationId: updated.id,
                            action: 'create',
                            calendarId: newPractitioner.calendarId,
                        })
                        .catch((enqueueErr) => {
                            logger.warn('Failed to enqueue Google Calendar sync task', {
                                reservationId: updated.id,
                                action: 'create',
                                error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
                            });
                        });
                });
        }
    }

    /**
     * Fire-and-forget: delete a Google Calendar event for a canceled/no-show reservation.
     */
    syncReservationDeletion(
        reservation: Reservation,
        practitioner: Practitioner | null
    ): void {
        if (!reservation.googleCalendarEventId) return;
        if (!practitioner?.calendarId) return;

        const googleService = createGoogleCalendarService(this.tenantId);
        const reservationRepo = createReservationRepository(this.tenantId);
        const queue = createGoogleCalendarSyncQueueService(this.tenantId);

        const calendarId = reservation.googleCalendarId || practitioner.calendarId;

        googleService
            .syncDeleteEvent(calendarId, reservation.googleCalendarEventId)
            .then(() => reservationRepo.clearGoogleCalendarRefs(reservation.id))
            .catch((error) => {
                logger.error('Failed to delete Google Calendar event', {
                    reservationId: reservation.id,
                    error: error instanceof Error ? error.message : String(error),
                });
                queue
                    .enqueue({
                        reservationId: reservation.id,
                        action: 'delete',
                        calendarId,
                        eventId: reservation.googleCalendarEventId,
                    })
                    .catch((enqueueErr) => {
                        logger.warn('Failed to enqueue Google Calendar sync task', {
                            reservationId: reservation.id,
                            action: 'delete',
                            error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
                        });
                    });
            });
    }
}

export function createGoogleCalendarSyncService(tenantId: string): GoogleCalendarSyncService {
    return new GoogleCalendarSyncService(tenantId);
}
