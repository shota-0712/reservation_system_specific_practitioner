/**
 * CRM-BE-001: RFM閾値サービス
 * テナントごとのRFM閾値設定の取得・保存・バリデーションを担う。
 */

import { DatabaseService } from '../config/database.js';
import type { RfmThresholds, RfmSegment } from '../types/index.js';
import { ValidationError } from '../utils/errors.js';

// ──────────────────────────────────────────────
// デフォルト値（ロードマップで確定）
// ──────────────────────────────────────────────
export const DEFAULT_RFM_THRESHOLDS: RfmThresholds = {
    recency: { score5: 30, score4: 60, score3: 90, score2: 180 },
    frequency: { score5: 12, score4: 8, score3: 4, score2: 2 },
    monetary: { score5: 100000, score4: 50000, score3: 20000, score2: 10000 },
};

interface RfmSettingsRow {
    recency_score5: number;
    recency_score4: number;
    recency_score3: number;
    recency_score2: number;
    frequency_score5: number;
    frequency_score4: number;
    frequency_score3: number;
    frequency_score2: number;
    monetary_score5: number;
    monetary_score4: number;
    monetary_score3: number;
    monetary_score2: number;
    updated_at: Date;
    updated_by: string | null;
}

function mapRfmThresholds(row: RfmSettingsRow): RfmThresholds {
    return {
        recency: {
            score5: row.recency_score5,
            score4: row.recency_score4,
            score3: row.recency_score3,
            score2: row.recency_score2,
        },
        frequency: {
            score5: row.frequency_score5,
            score4: row.frequency_score4,
            score3: row.frequency_score3,
            score2: row.frequency_score2,
        },
        monetary: {
            score5: row.monetary_score5,
            score4: row.monetary_score4,
            score3: row.monetary_score3,
            score2: row.monetary_score2,
        },
        updatedAt: row.updated_at,
        updatedBy: row.updated_by ?? undefined,
    };
}

/**
 * テナントのRFM閾値を取得する。
 * DB にレコードが存在しない場合はデフォルト値を返す（DBへの書き込みは行わない）。
 */
export async function getRfmThresholds(tenantId: string): Promise<RfmThresholds> {
    const rows = await DatabaseService.query<RfmSettingsRow>(
        `SELECT * FROM tenant_rfm_settings WHERE tenant_id = $1`,
        [tenantId],
        tenantId
    );
    return rows[0] ? mapRfmThresholds(rows[0]) : { ...DEFAULT_RFM_THRESHOLDS };
}

/**
 * RFM閾値のバリデーション。
 * 各ディメンションで score5 > score4 > score3 > score2 の順序制約を確認する。
 * recency は「小さいほど良い」なので score5 < score4 < score3 < score2。
 * frequency/monetary は「大きいほど良い」なので score5 > score4 > score3 > score2。
 */
export function validateRfmThresholds(t: RfmThresholds): void {
    const errors: string[] = [];

    // recency: 昇順制約（日数なので小さい値が上位）
    const r = t.recency;
    if (r.score5 <= 0 || r.score4 <= 0 || r.score3 <= 0 || r.score2 <= 0) {
        errors.push('recency scores must be positive integers');
    }
    if (!(r.score5 < r.score4 && r.score4 < r.score3 && r.score3 < r.score2)) {
        errors.push('recency must satisfy score5 < score4 < score3 < score2 (fewer days = higher score)');
    }

    // frequency: 降順制約（回数なので大きい値が上位）
    const f = t.frequency;
    if (f.score5 <= 0 || f.score4 <= 0 || f.score3 <= 0 || f.score2 <= 0) {
        errors.push('frequency scores must be positive integers');
    }
    if (!(f.score5 > f.score4 && f.score4 > f.score3 && f.score3 > f.score2)) {
        errors.push('frequency must satisfy score5 > score4 > score3 > score2 (more visits = higher score)');
    }

    // monetary: 降順制約（金額なので大きい値が上位）
    const m = t.monetary;
    if (m.score5 <= 0 || m.score4 <= 0 || m.score3 <= 0 || m.score2 <= 0) {
        errors.push('monetary scores must be positive integers');
    }
    if (!(m.score5 > m.score4 && m.score4 > m.score3 && m.score3 > m.score2)) {
        errors.push('monetary must satisfy score5 > score4 > score3 > score2 (more spend = higher score)');
    }

    if (errors.length > 0) {
        throw new ValidationError(errors.join('; '));
    }
}

// ──────────────────────────────────────────────
// スコア計算 & セグメント判定（純粋関数）
// ──────────────────────────────────────────────

/** Recency スコア (1-5)。daysSince が少ないほど高スコア。 */
export function calcRecencyScore(daysSince: number, t: RfmThresholds['recency']): number {
    if (daysSince <= t.score5) return 5;
    if (daysSince <= t.score4) return 4;
    if (daysSince <= t.score3) return 3;
    if (daysSince <= t.score2) return 2;
    return 1;
}

/** Frequency スコア (1-5)。visits が多いほど高スコア。 */
export function calcFrequencyScore(visits: number, t: RfmThresholds['frequency']): number {
    if (visits >= t.score5) return 5;
    if (visits >= t.score4) return 4;
    if (visits >= t.score3) return 3;
    if (visits >= t.score2) return 2;
    return 1;
}

/** Monetary スコア (1-5)。spend が多いほど高スコア。 */
export function calcMonetaryScore(spend: number, t: RfmThresholds['monetary']): number {
    if (spend >= t.score5) return 5;
    if (spend >= t.score4) return 4;
    if (spend >= t.score3) return 3;
    if (spend >= t.score2) return 2;
    return 1;
}

/**
 * RFMスコアからセグメントを判定する（新体系）。
 * 返値: champion | loyal | new | atRisk | hibernating
 */
export function calcRfmSegment(
    daysSince: number,
    visits: number,
    spend: number,
    thresholds: RfmThresholds
): RfmSegment {
    if (visits <= 2) return 'new';

    const r = calcRecencyScore(daysSince, thresholds.recency);
    const f = calcFrequencyScore(visits, thresholds.frequency);
    const m = calcMonetaryScore(spend, thresholds.monetary);

    if (r >= 4 && f >= 4 && m >= 4) return 'champion';
    if (r >= 3 && f >= 3) return 'loyal';
    if (r <= 2) return 'hibernating';
    return 'atRisk';
}

/**
 * テナントのRFM閾値を保存（upsert）する。
 * バリデーションに失敗した場合は ValidationError を投げる。
 */
export async function upsertRfmThresholds(
    tenantId: string,
    thresholds: RfmThresholds,
    updatedBy: string
): Promise<RfmThresholds> {
    validateRfmThresholds(thresholds);

    const { recency: r, frequency: f, monetary: m } = thresholds;

    const rows = await DatabaseService.query<RfmSettingsRow>(
        `INSERT INTO tenant_rfm_settings (
            tenant_id,
            recency_score5, recency_score4, recency_score3, recency_score2,
            frequency_score5, frequency_score4, frequency_score3, frequency_score2,
            monetary_score5, monetary_score4, monetary_score3, monetary_score2,
            updated_at, updated_by
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
            recency_score5   = EXCLUDED.recency_score5,
            recency_score4   = EXCLUDED.recency_score4,
            recency_score3   = EXCLUDED.recency_score3,
            recency_score2   = EXCLUDED.recency_score2,
            frequency_score5 = EXCLUDED.frequency_score5,
            frequency_score4 = EXCLUDED.frequency_score4,
            frequency_score3 = EXCLUDED.frequency_score3,
            frequency_score2 = EXCLUDED.frequency_score2,
            monetary_score5  = EXCLUDED.monetary_score5,
            monetary_score4  = EXCLUDED.monetary_score4,
            monetary_score3  = EXCLUDED.monetary_score3,
            monetary_score2  = EXCLUDED.monetary_score2,
            updated_at       = NOW(),
            updated_by       = EXCLUDED.updated_by
        RETURNING *`,
        [
            tenantId,
            r.score5, r.score4, r.score3, r.score2,
            f.score5, f.score4, f.score3, f.score2,
            m.score5, m.score4, m.score3, m.score2,
            updatedBy,
        ],
        tenantId
    );

    return mapRfmThresholds(rows[0]);
}

// ──────────────────────────────────────────────
// CRM-BE-003: 一括再計算ジョブ
// ──────────────────────────────────────────────

interface CustomerRow {
    id: string;
    rfm_segment: string | null;
    last_visit_at: Date | null;
    total_visits: number | null;
    total_spend: number | null;
}

export interface RfmRecalculateResult {
    processed: number;
    updated: number;
    unchanged: number;
}

/**
 * テナントの全顧客に対してRFMセグメントを再計算し、変更分のみ UPDATE する。
 * 閾値はDBから取得し、未設定の場合はデフォルトを使用する。
 */
export async function recalculateRfmForTenant(tenantId: string): Promise<RfmRecalculateResult> {
    const thresholds = await getRfmThresholds(tenantId);

    const customers = await DatabaseService.query<CustomerRow>(
        `SELECT id, rfm_segment, last_visit_at, total_visits, total_spend
         FROM customers
         WHERE tenant_id = $1 AND is_active = TRUE`,
        [tenantId],
        tenantId
    );

    const toUpdate: Array<{ id: string; segment: RfmSegment }> = [];

    for (const c of customers) {
        const daysSince = c.last_visit_at
            ? Math.floor((Date.now() - new Date(c.last_visit_at).getTime()) / (1000 * 60 * 60 * 24))
            : Infinity;
        const newSegment = calcRfmSegment(daysSince, c.total_visits ?? 0, c.total_spend ?? 0, thresholds);
        if (newSegment !== c.rfm_segment) {
            toUpdate.push({ id: c.id, segment: newSegment });
        }
    }

    if (toUpdate.length > 0) {
        const valuesClause = toUpdate.map((_, i) => `($${i * 2 + 1}::uuid, $${i * 2 + 2})`).join(', ');
        const params = toUpdate.flatMap((u) => [u.id, u.segment]);
        await DatabaseService.query(
            `UPDATE customers AS c
             SET rfm_segment = v.segment, updated_at = NOW()
             FROM (VALUES ${valuesClause}) AS v(id, segment)
             WHERE c.id = v.id AND c.tenant_id = $${params.length + 1}`,
            [...params, tenantId],
            tenantId
        );
    }

    return { processed: customers.length, updated: toUpdate.length, unchanged: customers.length - toUpdate.length };
}
