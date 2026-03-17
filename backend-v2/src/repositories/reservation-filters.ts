import type { ReservationStatus } from '../types/index.js';

export interface ReservationFilters {
    status?: ReservationStatus | ReservationStatus[];
    practitionerId?: string;
    customerId?: string;
    // Date-based filters (YYYY-MM-DD) – converted internally to starts_at range.
    // `timezone` defaults to 'Asia/Tokyo'. For UX convenience queries only.
    dateFrom?: string;
    dateTo?: string;
    date?: string;
    timezone?: string;
}

export interface ReservationFilterSql {
    sql: string;
    params: unknown[];
    nextParamIndex: number;
}

export function buildReservationFilterSql(
    filters: ReservationFilters,
    startingParamIndex = 2
): ReservationFilterSql {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = startingParamIndex;
    const tz = filters.timezone ?? 'Asia/Tokyo';

    if (filters.status) {
        if (Array.isArray(filters.status)) {
            clauses.push(` AND status = ANY($${paramIndex})`);
        } else {
            clauses.push(` AND status = $${paramIndex}`);
        }
        params.push(filters.status);
        paramIndex++;
    }

    if (filters.practitionerId) {
        clauses.push(` AND practitioner_id = $${paramIndex}`);
        params.push(filters.practitionerId);
        paramIndex++;
    }

    if (filters.customerId) {
        clauses.push(` AND customer_id = $${paramIndex}`);
        params.push(filters.customerId);
        paramIndex++;
    }

    // Exact date: match reservations whose local date (in `tz`) equals the given date.
    if (filters.date) {
        clauses.push(` AND (starts_at AT TIME ZONE $${paramIndex})::date = $${paramIndex + 1}::date`);
        params.push(tz, filters.date);
        paramIndex += 2;
    }

    if (filters.dateFrom) {
        clauses.push(` AND (starts_at AT TIME ZONE $${paramIndex})::date >= $${paramIndex + 1}::date`);
        params.push(tz, filters.dateFrom);
        paramIndex += 2;
    }

    if (filters.dateTo) {
        clauses.push(` AND (starts_at AT TIME ZONE $${paramIndex})::date <= $${paramIndex + 1}::date`);
        params.push(tz, filters.dateTo);
        paramIndex += 2;
    }

    return {
        sql: clauses.join(''),
        params,
        nextParamIndex: paramIndex,
    };
}
