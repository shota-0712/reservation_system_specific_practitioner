import { describe, expect, it } from 'vitest';
import { buildReservationFilterSql } from '../../src/repositories/reservation-filters.js';

describe('buildReservationFilterSql', () => {
    it('builds clauses for all supported filters in a stable order', () => {
        const result = buildReservationFilterSql(
            {
                status: ['pending', 'confirmed'],
                practitionerId: 'pr-1',
                customerId: 'cu-1',
                date: '2026-03-06',
                dateFrom: '2026-03-01',
                dateTo: '2026-03-31',
            },
            2
        );

        expect(result).toEqual({
            sql:
                ' AND status = ANY($2)' +
                ' AND practitioner_id = $3' +
                ' AND customer_id = $4' +
                ' AND date = $5' +
                ' AND date >= $6' +
                ' AND date <= $7',
            params: [
                ['pending', 'confirmed'],
                'pr-1',
                'cu-1',
                '2026-03-06',
                '2026-03-01',
                '2026-03-31',
            ],
            nextParamIndex: 8,
        });
    });

    it('omits empty clauses and keeps scalar status syntax', () => {
        const result = buildReservationFilterSql(
            {
                status: 'completed',
                date: '2026-03-06',
            },
            4
        );

        expect(result).toEqual({
            sql: ' AND status = $4 AND date = $5',
            params: ['completed', '2026-03-06'],
            nextParamIndex: 6,
        });
    });
});
