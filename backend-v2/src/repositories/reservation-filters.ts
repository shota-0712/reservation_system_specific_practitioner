import type { ReservationStatus } from '../types/index.js';

export interface ReservationFilters {
    status?: ReservationStatus | ReservationStatus[];
    practitionerId?: string;
    customerId?: string;
    dateFrom?: string;
    dateTo?: string;
    date?: string;
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

    if (filters.date) {
        clauses.push(` AND date = $${paramIndex}`);
        params.push(filters.date);
        paramIndex++;
    }

    if (filters.dateFrom) {
        clauses.push(` AND date >= $${paramIndex}`);
        params.push(filters.dateFrom);
        paramIndex++;
    }

    if (filters.dateTo) {
        clauses.push(` AND date <= $${paramIndex}`);
        params.push(filters.dateTo);
        paramIndex++;
    }

    return {
        sql: clauses.join(''),
        params,
        nextParamIndex: paramIndex,
    };
}
