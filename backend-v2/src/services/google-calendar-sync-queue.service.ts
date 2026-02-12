import { DatabaseService } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { createReservationRepository, createPractitionerRepository, createStoreRepository } from '../repositories/index.js';
import { createGoogleCalendarService } from './google-calendar.service.js';

export type GoogleCalendarSyncAction = 'create' | 'update' | 'delete';

export interface EnqueueGoogleCalendarSyncTaskInput {
    reservationId: string;
    action: GoogleCalendarSyncAction;
    calendarId?: string | null;
    eventId?: string | null;
}

export interface GoogleCalendarSyncQueueSummary {
    pending: number;
    running: number;
    failed: number;
    dead: number;
    nextRunAt?: string;
    lastError?: string;
    lastAttemptAt?: string;
    lastSuccessAt?: string;
}

export interface ProcessGoogleCalendarSyncQueueResult {
    processed: number;
    succeeded: number;
    failed: number;
    dead: number;
    skipped: number;
    remainingPending: number;
}

export interface RetryGoogleCalendarSyncQueueResult {
    reset: number;
    fromDead: number;
    fromFailed: number;
}

type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'dead';

interface TaskRow {
    id: string;
    reservation_id: string | null;
    action: GoogleCalendarSyncAction;
    calendar_id: string | null;
    event_id: string | null;
    attempts: number;
    max_attempts: number;
}

function toInt(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    }
    return 0;
}

function formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function computeBackoffSeconds(attempts: number): number {
    // 60s, 120s, 240s... capped at 1h
    const base = 30;
    const max = 60 * 60;
    const seconds = Math.min(max, Math.round(base * Math.pow(2, Math.max(1, attempts))));
    return seconds;
}

export class GoogleCalendarSyncQueueService {
    constructor(private tenantId: string) {}

    async enqueue(input: EnqueueGoogleCalendarSyncTaskInput): Promise<{ taskId: string }> {
        const row = await DatabaseService.queryOne<{ id: string }>(
            `INSERT INTO google_calendar_sync_tasks (
                tenant_id, reservation_id, action,
                calendar_id, event_id,
                status, attempts, max_attempts, next_run_at
             ) VALUES (
                $1, $2, $3,
                $4, $5,
                'pending', 0, 10, NOW()
             )
             ON CONFLICT (tenant_id, reservation_id, action)
             WHERE status IN ('pending', 'running')
             DO UPDATE SET
                calendar_id = COALESCE(EXCLUDED.calendar_id, google_calendar_sync_tasks.calendar_id),
                event_id = COALESCE(EXCLUDED.event_id, google_calendar_sync_tasks.event_id),
                -- if already running, keep running; otherwise ensure it will be picked up soon
                status = CASE WHEN google_calendar_sync_tasks.status = 'running' THEN 'running' ELSE 'pending' END,
                next_run_at = LEAST(google_calendar_sync_tasks.next_run_at, EXCLUDED.next_run_at),
                updated_at = NOW()
             RETURNING id`,
            [
                this.tenantId,
                input.reservationId,
                input.action,
                input.calendarId ?? null,
                input.eventId ?? null,
            ],
            this.tenantId
        );

        return { taskId: row?.id as string };
    }

    async getSummary(): Promise<GoogleCalendarSyncQueueSummary> {
        const counts = await DatabaseService.queryOne<Record<string, unknown>>(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE status = 'running')::int AS running,
                COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
                COUNT(*) FILTER (WHERE status = 'dead')::int AS dead,
                MIN(next_run_at) FILTER (WHERE status = 'pending') AS next_run_at,
                MAX(last_attempt_at) AS last_attempt_at,
                MAX(succeeded_at) AS last_success_at
             FROM google_calendar_sync_tasks
             WHERE tenant_id = $1`,
            [this.tenantId],
            this.tenantId
        );

        const lastErrorRow = await DatabaseService.queryOne<{ last_error?: string | null }>(
            `SELECT last_error
             FROM google_calendar_sync_tasks
             WHERE tenant_id = $1
               AND last_error IS NOT NULL
             ORDER BY updated_at DESC
             LIMIT 1`,
            [this.tenantId],
            this.tenantId
        );

        return {
            pending: toInt(counts?.pending),
            running: toInt(counts?.running),
            failed: toInt(counts?.failed),
            dead: toInt(counts?.dead),
            nextRunAt: counts?.next_run_at ? String(counts.next_run_at) : undefined,
            lastAttemptAt: counts?.last_attempt_at ? String(counts.last_attempt_at) : undefined,
            lastSuccessAt: counts?.last_success_at ? String(counts.last_success_at) : undefined,
            lastError: lastErrorRow?.last_error ?? undefined,
        };
    }

    async processPending(options: { limit?: number } = {}): Promise<ProcessGoogleCalendarSyncQueueResult> {
        const limit = Number.isFinite(options.limit as number) ? Math.max(1, Math.trunc(options.limit as number)) : 50;

        const stats: Omit<ProcessGoogleCalendarSyncQueueResult, 'remainingPending'> = {
            processed: 0,
            succeeded: 0,
            failed: 0,
            dead: 0,
            skipped: 0,
        };

        for (let i = 0; i < limit; i++) {
            const task = await this.claimNextTask();
            if (!task) break;

            stats.processed++;

            const result = await this.executeTask(task);
            stats[result]++;
        }

        const remaining = await DatabaseService.queryOne<{ count?: string | number }>(
            `SELECT COUNT(*) as count
             FROM google_calendar_sync_tasks
             WHERE tenant_id = $1
               AND status = 'pending'
               AND next_run_at <= NOW()`,
            [this.tenantId],
            this.tenantId
        );

        return {
            ...stats,
            remainingPending: toInt(remaining?.count),
        };
    }

    async retryDeadTasks(options: { limit?: number; includeFailed?: boolean } = {}): Promise<RetryGoogleCalendarSyncQueueResult> {
        const includeFailed = options.includeFailed === true;
        const limit = Number.isFinite(options.limit as number) ? Math.max(1, Math.trunc(options.limit as number)) : 100;
        const statuses = includeFailed ? ['dead', 'failed'] : ['dead'];

        const result = await DatabaseService.query<{ previous_status: TaskStatus }>(
            `WITH candidates AS (
                SELECT id, status
                FROM google_calendar_sync_tasks
                WHERE tenant_id = $1
                  AND status = ANY($2::text[])
                ORDER BY updated_at DESC
                LIMIT $3
             )
             UPDATE google_calendar_sync_tasks t
             SET status = 'pending',
                 attempts = 0,
                 next_run_at = NOW(),
                 locked_at = NULL,
                 last_error = NULL,
                 updated_at = NOW()
             FROM candidates c
             WHERE t.id = c.id
             RETURNING c.status AS previous_status`,
            [this.tenantId, statuses, limit],
            this.tenantId
        );

        const fromDead = result.filter((row) => row.previous_status === 'dead').length;
        const fromFailed = result.filter((row) => row.previous_status === 'failed').length;

        return {
            reset: result.length,
            fromDead,
            fromFailed,
        };
    }

    private async claimNextTask(): Promise<TaskRow | null> {
        return DatabaseService.transaction(async (client) => {
            const result = await client.query(
                `SELECT id, reservation_id, action, calendar_id, event_id, attempts, max_attempts
                 FROM google_calendar_sync_tasks
                 WHERE tenant_id = $1
                   AND status = 'pending'
                   AND next_run_at <= NOW()
                 ORDER BY next_run_at ASC, created_at ASC
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1`,
                [this.tenantId]
            );

            const row = result.rows[0] as TaskRow | undefined;
            if (!row) return null;

            const nextAttempts = (row.attempts ?? 0) + 1;

            await client.query(
                `UPDATE google_calendar_sync_tasks
                 SET status = 'running',
                     attempts = $2,
                     locked_at = NOW(),
                     last_attempt_at = NOW(),
                     updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $3`,
                [row.id, nextAttempts, this.tenantId]
            );

            return { ...row, attempts: nextAttempts };
        }, this.tenantId);
    }

    private async executeTask(task: TaskRow): Promise<'succeeded' | 'failed' | 'dead' | 'skipped'> {
        const reservationId = task.reservation_id;
        if (!reservationId) {
            await this.markSucceeded(task.id, { calendarId: task.calendar_id, eventId: task.event_id });
            return 'skipped';
        }

        const reservationRepo = createReservationRepository(this.tenantId);
        const practitionerRepo = createPractitionerRepository(this.tenantId);
        const storeRepo = createStoreRepository(this.tenantId);

        const reservation = await reservationRepo.findById(reservationId).catch(() => null);
        if (!reservation) {
            await this.markSucceeded(task.id, { calendarId: task.calendar_id, eventId: task.event_id });
            return 'skipped';
        }

        const store = reservation.storeId ? await storeRepo.findById(reservation.storeId) : null;
        const timezone = store?.timezone || 'Asia/Tokyo';

        const practitioner = await practitionerRepo.findById(reservation.practitionerId).catch(() => null);
        const practitionerCalendarId = practitioner?.calendarId || null;

        const calendarId = task.calendar_id || reservation.googleCalendarId || practitionerCalendarId;
        const eventId = task.event_id || reservation.googleCalendarEventId || null;

        const googleService = createGoogleCalendarService(this.tenantId);

        try {
            if (task.action === 'delete') {
                if (!eventId || !calendarId) {
                    await this.markSucceeded(task.id, { calendarId, eventId });
                    return 'skipped';
                }

                await googleService.syncDeleteEvent(calendarId, eventId);
                await reservationRepo.clearGoogleCalendarRefs(reservation.id);

                await this.markSucceeded(task.id, { calendarId, eventId });
                return 'succeeded';
            }

            // create/update should not run for canceled reservations (delete should handle clean-up).
            if (reservation.status === 'canceled' || reservation.status === 'no_show') {
                await this.markSucceeded(task.id, { calendarId, eventId });
                return 'skipped';
            }

            if (!calendarId) {
                await this.markSucceeded(task.id, { calendarId, eventId });
                return 'skipped';
            }

            if (task.action === 'create' || !eventId) {
                const createdEventId = await googleService.syncCreateEvent(calendarId, reservation, timezone);
                if (!createdEventId) {
                    throw new Error('Google Calendar integration is not connected');
                }

                await reservationRepo.setGoogleCalendarRefs(reservation.id, { calendarId, eventId: createdEventId });
                await this.markSucceeded(task.id, { calendarId, eventId: createdEventId });
                return 'succeeded';
            }

            await googleService.syncUpdateEvent(calendarId, eventId, reservation, timezone);
            await reservationRepo.setGoogleCalendarRefs(reservation.id, { calendarId, eventId });
            await this.markSucceeded(task.id, { calendarId, eventId });
            return 'succeeded';
        } catch (error) {
            const message = formatError(error);
            logger.warn('Google Calendar sync task failed', {
                tenantId: this.tenantId,
                taskId: task.id,
                action: task.action,
                reservationId,
                attempts: task.attempts,
                message,
            });

            const outcome = await this.markFailed(task, message);
            return outcome;
        }
    }

    private async markSucceeded(
        taskId: string,
        refs: { calendarId: string | null; eventId: string | null }
    ): Promise<void> {
        await DatabaseService.query(
            `UPDATE google_calendar_sync_tasks
             SET status = 'succeeded',
                 calendar_id = COALESCE($3, calendar_id),
                 event_id = COALESCE($4, event_id),
                 succeeded_at = NOW(),
                 last_error = NULL,
                 locked_at = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2`,
            [taskId, this.tenantId, refs.calendarId ?? null, refs.eventId ?? null],
            this.tenantId
        );
    }

    private async markFailed(task: TaskRow, message: string): Promise<'failed' | 'dead'> {
        const shouldDead = task.attempts >= (task.max_attempts ?? 10);
        const backoffSeconds = computeBackoffSeconds(task.attempts);

        const nextStatus: TaskStatus = shouldDead ? 'dead' : 'pending';

        await DatabaseService.query(
            `UPDATE google_calendar_sync_tasks
             SET status = $3,
                 last_error = $4,
                 locked_at = NULL,
                 next_run_at = CASE
                    WHEN $3 = 'pending' THEN NOW() + ($5 * INTERVAL '1 second')
                    ELSE next_run_at
                 END,
                 updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2`,
            [task.id, this.tenantId, nextStatus, message, backoffSeconds],
            this.tenantId
        );

        return shouldDead ? 'dead' : 'failed';
    }
}

export function createGoogleCalendarSyncQueueService(tenantId: string): GoogleCalendarSyncQueueService {
    return new GoogleCalendarSyncQueueService(tenantId);
}
