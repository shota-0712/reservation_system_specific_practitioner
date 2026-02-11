import { beforeAll, describe, expect, it } from 'vitest';

let resolveDailyAnalyticsTargetDate: (date?: string) => string;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }
    const module = await import('../../src/jobs/daily-analytics.job.js');
    resolveDailyAnalyticsTargetDate = module.resolveDailyAnalyticsTargetDate;
});

describe('daily-analytics-job', () => {
    it('returns explicit date when valid format is provided', () => {
        expect(resolveDailyAnalyticsTargetDate('2026-02-08')).toBe('2026-02-08');
    });

    it('throws validation error when date format is invalid', () => {
        expect(() => resolveDailyAnalyticsTargetDate('2026/02/08')).toThrowError(
            'date must be YYYY-MM-DD format'
        );
    });

    it('returns YYYY-MM-DD for default target date', () => {
        expect(resolveDailyAnalyticsTargetDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
