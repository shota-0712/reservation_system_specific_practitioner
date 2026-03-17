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
                timezone: 'Asia/Tokyo',
            },
            2
        );

        expect(result).toEqual({
            sql:
                ' AND status = ANY($2)' +
                ' AND practitioner_id = $3' +
                ' AND customer_id = $4' +
                ' AND (starts_at AT TIME ZONE $5)::date = $6::date' +
                ' AND (starts_at AT TIME ZONE $7)::date >= $8::date' +
                ' AND (starts_at AT TIME ZONE $9)::date <= $10::date',
            params: [
                ['pending', 'confirmed'],
                'pr-1',
                'cu-1',
                'Asia/Tokyo',
                '2026-03-06',
                'Asia/Tokyo',
                '2026-03-01',
                'Asia/Tokyo',
                '2026-03-31',
            ],
            nextParamIndex: 11,
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
            sql: ' AND status = $4 AND (starts_at AT TIME ZONE $5)::date = $6::date',
            params: ['completed', 'Asia/Tokyo', '2026-03-06'],
            nextParamIndex: 7,
        });
    });
});
