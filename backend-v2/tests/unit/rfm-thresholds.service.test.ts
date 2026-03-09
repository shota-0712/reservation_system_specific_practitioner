import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';

let calcRecencyScore: typeof import('../../src/services/rfm-thresholds.service.js').calcRecencyScore;
let calcFrequencyScore: typeof import('../../src/services/rfm-thresholds.service.js').calcFrequencyScore;
let calcMonetaryScore: typeof import('../../src/services/rfm-thresholds.service.js').calcMonetaryScore;
let calcRfmSegment: typeof import('../../src/services/rfm-thresholds.service.js').calcRfmSegment;
let validateRfmThresholds: typeof import('../../src/services/rfm-thresholds.service.js').validateRfmThresholds;
let getRfmThresholds: typeof import('../../src/services/rfm-thresholds.service.js').getRfmThresholds;
let DEFAULT_RFM_THRESHOLDS: typeof import('../../src/services/rfm-thresholds.service.js').DEFAULT_RFM_THRESHOLDS;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;
let ValidationError: typeof import('../../src/utils/errors.js').ValidationError;


beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }
    ({
        calcRecencyScore,
        calcFrequencyScore,
        calcMonetaryScore,
        calcRfmSegment,
        validateRfmThresholds,
        getRfmThresholds,
        DEFAULT_RFM_THRESHOLDS,
    } = await import('../../src/services/rfm-thresholds.service.js'));
    ({ DatabaseService } = await import('../../src/config/database.js'));
    ({ ValidationError } = await import('../../src/utils/errors.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ──────────────────────────────────────────────
// スコア計算（純粋関数）
// ──────────────────────────────────────────────
describe('calcRecencyScore', () => {
    it('returns 5 for ≤ score5 days', () => {
        expect(calcRecencyScore(30, DEFAULT_RFM_THRESHOLDS.recency)).toBe(5);
    });
    it('returns 4 for ≤ score4 days', () => {
        expect(calcRecencyScore(60, DEFAULT_RFM_THRESHOLDS.recency)).toBe(4);
    });
    it('returns 3 for ≤ score3 days', () => {
        expect(calcRecencyScore(90, DEFAULT_RFM_THRESHOLDS.recency)).toBe(3);
    });
    it('returns 2 for ≤ score2 days', () => {
        expect(calcRecencyScore(180, DEFAULT_RFM_THRESHOLDS.recency)).toBe(2);
    });
    it('returns 1 for > score2 days', () => {
        expect(calcRecencyScore(181, DEFAULT_RFM_THRESHOLDS.recency)).toBe(1);
    });
});

describe('calcFrequencyScore', () => {
    it('returns 5 for ≥ score5 visits', () => {
        expect(calcFrequencyScore(12, DEFAULT_RFM_THRESHOLDS.frequency)).toBe(5);
    });
    it('returns 4 for ≥ score4 visits', () => {
        expect(calcFrequencyScore(8, DEFAULT_RFM_THRESHOLDS.frequency)).toBe(4);
    });
    it('returns 1 for < score2 visits', () => {
        expect(calcFrequencyScore(1, DEFAULT_RFM_THRESHOLDS.frequency)).toBe(1);
    });
});

describe('calcMonetaryScore', () => {
    it('returns 5 for ≥ score5 spend', () => {
        expect(calcMonetaryScore(100000, DEFAULT_RFM_THRESHOLDS.monetary)).toBe(5);
    });
    it('returns 1 for < score2 spend', () => {
        expect(calcMonetaryScore(9999, DEFAULT_RFM_THRESHOLDS.monetary)).toBe(1);
    });
});

// ──────────────────────────────────────────────
// セグメント判定
// ──────────────────────────────────────────────
describe('calcRfmSegment', () => {
    it('returns "new" when visits <= 2 regardless of recency', () => {
        const t = DEFAULT_RFM_THRESHOLDS;
        expect(calcRfmSegment(1, 2, 200000, t)).toBe('new');
        expect(calcRfmSegment(200, 1, 0, t)).toBe('new');
    });

    it('returns "champion" for high R/F/M scores', () => {
        const t = DEFAULT_RFM_THRESHOLDS;
        // R≥4(≤60days), F≥4(≥8visits), M≥4(≥50000spend)
        expect(calcRfmSegment(20, 15, 150000, t)).toBe('champion');
    });

    it('returns "loyal" for moderate R and F', () => {
        const t = DEFAULT_RFM_THRESHOLDS;
        // R=3(≤90days), F=3(≥4visits), M low
        expect(calcRfmSegment(80, 5, 5000, t)).toBe('loyal');
    });

    it('returns "hibernating" for long inactive', () => {
        const t = DEFAULT_RFM_THRESHOLDS;
        // R=1(>180days), F=4
        expect(calcRfmSegment(200, 10, 80000, t)).toBe('hibernating');
    });

    it('returns "atRisk" for R=3 but insufficient F', () => {
        const t = DEFAULT_RFM_THRESHOLDS;
        // R=3(≤90days), F=2(visits=3), M low
        expect(calcRfmSegment(85, 3, 5000, t)).toBe('atRisk');
    });
});

// ──────────────────────────────────────────────
// バリデーション
// ──────────────────────────────────────────────
describe('validateRfmThresholds', () => {
    it('passes for valid default thresholds', () => {
        expect(() => validateRfmThresholds(DEFAULT_RFM_THRESHOLDS)).not.toThrow();
    });

    it('throws ValidationError when recency order is reversed', () => {
        const bad = {
            ...DEFAULT_RFM_THRESHOLDS,
            recency: { score5: 180, score4: 90, score3: 60, score2: 30 }, // wrong order
        };
        expect(() => validateRfmThresholds(bad)).toThrow(ValidationError);
    });

    it('throws ValidationError when frequency order is reversed', () => {
        const bad = {
            ...DEFAULT_RFM_THRESHOLDS,
            frequency: { score5: 2, score4: 4, score3: 8, score2: 12 }, // wrong order
        };
        expect(() => validateRfmThresholds(bad)).toThrow(ValidationError);
    });

    it('throws ValidationError for negative values', () => {
        const bad = {
            ...DEFAULT_RFM_THRESHOLDS,
            recency: { score5: -1, score4: 60, score3: 90, score2: 180 },
        };
        expect(() => validateRfmThresholds(bad)).toThrow(ValidationError);
    });
});

// ──────────────────────────────────────────────
// DB読み書き（テナント分離）
// ──────────────────────────────────────────────
describe('getRfmThresholds', () => {
    it('returns defaults when no row exists for tenant', async () => {
        vi.spyOn(DatabaseService, 'query').mockResolvedValue([]);
        const result = await getRfmThresholds('tenant-a');
        expect(result.recency.score5).toBe(DEFAULT_RFM_THRESHOLDS.recency.score5);
        expect(result.frequency.score5).toBe(DEFAULT_RFM_THRESHOLDS.frequency.score5);
    });

    it('returns DB values when row exists', async () => {
        const fakeRow = {
            recency_score5: 14, recency_score4: 30, recency_score3: 60, recency_score2: 90,
            frequency_score5: 20, frequency_score4: 10, frequency_score3: 5, frequency_score2: 3,
            monetary_score5: 200000, monetary_score4: 100000, monetary_score3: 50000, monetary_score2: 20000,
            updated_at: new Date(),
            updated_by: 'owner@test.com',
        };
        vi.spyOn(DatabaseService, 'query').mockResolvedValue([fakeRow]);
        const result = await getRfmThresholds('tenant-a');
        expect(result.recency.score5).toBe(14);
        expect(result.updatedBy).toBe('owner@test.com');
    });
});

describe('upsertRfmThresholds – tenant isolation', () => {
    it('tenant-A and tenant-B settings do not interfere', async () => {
        const rowA = {
            recency_score5: 14, recency_score4: 30, recency_score3: 60, recency_score2: 90,
            frequency_score5: 20, frequency_score4: 10, frequency_score3: 5, frequency_score2: 3,
            monetary_score5: 200000, monetary_score4: 100000, monetary_score3: 50000, monetary_score2: 20000,
            updated_at: new Date(), updated_by: 'owner-a@test.com',
        };

        const querySpy = vi.spyOn(DatabaseService, 'query').mockImplementation(
            async (_sql: string, _params?: unknown[], tenantId?: string) => {
                if (tenantId === 'tenant-a') return [rowA];
                // tenant-b has no row yet → returns empty
                return [];
            }
        );

        const resultA = await getRfmThresholds('tenant-a');
        const resultB = await getRfmThresholds('tenant-b');

        expect(resultA.recency.score5).toBe(14);       // tenant-a custom value
        expect(resultB.recency.score5).toBe(30);       // tenant-b falls back to default
        expect(querySpy).toHaveBeenCalledTimes(2);
    });
});
