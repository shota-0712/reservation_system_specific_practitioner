import { DatabaseService } from '../config/database.js';

interface RankingRow {
    name: string;
    count: number;
    revenue: number;
}

interface PractitionerRevenueRow {
    name: string;
    revenue: number;
    customers: number;
}

const toInt = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    }
    return 0;
};

function mapMenuRankingRows(rows: Record<string, unknown>[]): RankingRow[] {
    return rows.map((row) => ({
        name: String(row.name ?? ''),
        count: toInt(row.count),
        revenue: toInt(row.revenue),
    }));
}

function mapPractitionerRevenueRows(rows: Record<string, unknown>[]): PractitionerRevenueRow[] {
    return rows.map((row) => ({
        name: String(row.name ?? ''),
        revenue: toInt(row.revenue),
        customers: toInt(row.customers),
    }));
}

async function queryMenuRankingFromDailyAnalytics(
    tenantId: string,
    startDate: string
): Promise<RankingRow[]> {
    const rows = await DatabaseService.query<Record<string, unknown>>(
        `WITH revenue AS (
            SELECT
                kv.key as name,
                SUM((kv.value)::bigint) as revenue
            FROM daily_analytics da
            CROSS JOIN LATERAL jsonb_each_text(COALESCE(da.revenue_by_menu, '{}'::jsonb)) kv
            WHERE da.tenant_id = $1
              AND da.date >= $2
            GROUP BY kv.key
        ),
        counts AS (
            SELECT
                kv.key as name,
                SUM((kv.value)::bigint) as count
            FROM daily_analytics da
            CROSS JOIN LATERAL jsonb_each_text(COALESCE(da.reservations_count_by_menu, '{}'::jsonb)) kv
            WHERE da.tenant_id = $1
              AND da.date >= $2
            GROUP BY kv.key
        )
        SELECT
            COALESCE(revenue.name, counts.name) as name,
            COALESCE(counts.count, 0) as count,
            COALESCE(revenue.revenue, 0) as revenue
        FROM revenue
        FULL JOIN counts
          ON counts.name = revenue.name
        ORDER BY revenue DESC
        LIMIT 10`,
        [tenantId, startDate],
        tenantId
    );
    return mapMenuRankingRows(rows);
}

async function queryMenuRankingFromReservations(
    tenantId: string,
    startDate: string
): Promise<RankingRow[]> {
    const rows = await DatabaseService.query<Record<string, unknown>>(
        `SELECT
            rm.menu_name as name,
            COUNT(*) as count,
            COALESCE(SUM(rm.menu_price * rm.quantity), 0) as revenue
         FROM reservation_menus rm
         JOIN reservations r ON r.id = rm.reservation_id
         WHERE r.tenant_id = $1
           AND r.status = 'completed'
           AND r.date >= $2
         GROUP BY rm.menu_name
         ORDER BY revenue DESC
         LIMIT 10`,
        [tenantId, startDate],
        tenantId
    );
    return mapMenuRankingRows(rows);
}

export async function getMenuRankingData(
    tenantId: string,
    startDate: string
): Promise<RankingRow[]> {
    try {
        const analyticsRows = await queryMenuRankingFromDailyAnalytics(tenantId, startDate);
        if (analyticsRows.length > 0) {
            return analyticsRows;
        }
    } catch (_error) {
        // fallback to reservations aggregation
    }

    return queryMenuRankingFromReservations(tenantId, startDate);
}

async function queryPractitionerRevenueFromDailyAnalytics(
    tenantId: string,
    startDate: string
): Promise<PractitionerRevenueRow[]> {
    const rows = await DatabaseService.query<Record<string, unknown>>(
        `WITH revenue AS (
            SELECT
                kv.key as name,
                SUM((kv.value)::bigint) as revenue
            FROM daily_analytics da
            CROSS JOIN LATERAL jsonb_each_text(COALESCE(da.revenue_by_practitioner, '{}'::jsonb)) kv
            WHERE da.tenant_id = $1
              AND da.date >= $2
            GROUP BY kv.key
        ),
        customers AS (
            SELECT
                kv.key as name,
                SUM((kv.value)::bigint) as customers
            FROM daily_analytics da
            CROSS JOIN LATERAL jsonb_each_text(COALESCE(da.unique_customers_by_practitioner, '{}'::jsonb)) kv
            WHERE da.tenant_id = $1
              AND da.date >= $2
            GROUP BY kv.key
        )
        SELECT
            COALESCE(revenue.name, customers.name) as name,
            COALESCE(revenue.revenue, 0) as revenue,
            COALESCE(customers.customers, 0) as customers
        FROM revenue
        FULL JOIN customers
          ON customers.name = revenue.name
        ORDER BY revenue DESC`,
        [tenantId, startDate],
        tenantId
    );
    return mapPractitionerRevenueRows(rows);
}

async function queryPractitionerRevenueFromReservations(
    tenantId: string,
    startDate: string
): Promise<PractitionerRevenueRow[]> {
    const rows = await DatabaseService.query<Record<string, unknown>>(
        `SELECT
            practitioner_name as name,
            COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as revenue,
            COUNT(DISTINCT customer_id) as customers
         FROM reservations
         WHERE tenant_id = $1
           AND date >= $2
         GROUP BY practitioner_name
         ORDER BY revenue DESC`,
        [tenantId, startDate],
        tenantId
    );
    return mapPractitionerRevenueRows(rows);
}

export async function getPractitionerRevenueData(
    tenantId: string,
    startDate: string
): Promise<PractitionerRevenueRow[]> {
    try {
        const analyticsRows = await queryPractitionerRevenueFromDailyAnalytics(tenantId, startDate);
        if (analyticsRows.length > 0) {
            return analyticsRows;
        }
    } catch (_error) {
        // fallback to reservations aggregation
    }

    return queryPractitionerRevenueFromReservations(tenantId, startDate);
}
