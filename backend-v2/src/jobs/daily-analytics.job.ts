/**
 * Daily Analytics Job
 * 日次集計テーブル(daily_analytics)を更新するジョブ
 */

import { addDays } from 'date-fns';
import { format, toZonedTime } from 'date-fns-tz';
import { DatabaseService } from '../config/database.js';
import { logger } from '../utils/logger.js';

const TIMEZONE = 'Asia/Tokyo';

interface TenantRow {
    id: string;
}

interface StoreRow {
    id: string;
}

interface AnalyticsAggregateRow {
    store_id: string;
    total_revenue: number | string;
    reservation_count: number | string;
    completed_count: number | string;
    canceled_count: number | string;
    no_show_count: number | string;
    new_customers: number | string;
    returning_customers: number | string;
    unique_customers: number | string;
    average_order_value: number | string;
    revenue_by_practitioner: Record<string, unknown> | null;
    revenue_by_menu: Record<string, unknown> | null;
    reservations_count_by_menu: Record<string, unknown> | null;
    unique_customers_by_practitioner: Record<string, unknown> | null;
    reservations_by_hour: Record<string, unknown> | null;
}

interface AnalyticsUpsertRow {
    storeId: string;
    totalRevenue: number;
    reservationCount: number;
    completedCount: number;
    canceledCount: number;
    noShowCount: number;
    newCustomers: number;
    returningCustomers: number;
    uniqueCustomers: number;
    averageOrderValue: number;
    revenueByPractitioner: Record<string, number>;
    revenueByMenu: Record<string, number>;
    reservationsCountByMenu: Record<string, number>;
    uniqueCustomersByPractitioner: Record<string, number>;
    reservationsByHour: Record<string, number>;
}

export interface DailyAnalyticsStats {
    targetDate: string;
    tenantsProcessed: number;
    storesProcessed: number;
    rowsUpserted: number;
    failedTenants: number;
}

function toInt(value: unknown): number {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? Math.trunc(value) : 0;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    }
    return 0;
}

function toNumericMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const result: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const parsed = toInt(raw);
        if (parsed !== 0) {
            result[key] = parsed;
        }
    }
    return result;
}

function createEmptyUpsertRow(storeId: string): AnalyticsUpsertRow {
    return {
        storeId,
        totalRevenue: 0,
        reservationCount: 0,
        completedCount: 0,
        canceledCount: 0,
        noShowCount: 0,
        newCustomers: 0,
        returningCustomers: 0,
        uniqueCustomers: 0,
        averageOrderValue: 0,
        revenueByPractitioner: {},
        revenueByMenu: {},
        reservationsCountByMenu: {},
        uniqueCustomersByPractitioner: {},
        reservationsByHour: {},
    };
}

export function resolveDailyAnalyticsTargetDate(date?: string): string {
    if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new Error('date must be YYYY-MM-DD format');
        }
        return date;
    }

    const now = new Date();
    const jstNow = toZonedTime(now, TIMEZONE);
    const target = addDays(jstNow, -1);
    return format(target, 'yyyy-MM-dd', { timeZone: TIMEZONE });
}

async function aggregateTenantDailyAnalytics(
    tenantId: string,
    targetDate: string
): Promise<{ storeCount: number; upserted: number }> {
    const stores = await DatabaseService.query<StoreRow>(
        `SELECT id
         FROM stores
         WHERE tenant_id = $1
         ORDER BY created_at ASC`,
        [tenantId],
        tenantId
    );

    if (stores.length === 0) {
        return { storeCount: 0, upserted: 0 };
    }

    const fallbackStoreId = stores[0].id;

    const rows = await DatabaseService.query<AnalyticsAggregateRow>(
        `WITH reservation_base AS (
            SELECT
                r.id,
                COALESCE(r.store_id, $3::uuid) AS store_id,
                r.customer_id,
                COALESCE(r.practitioner_name, '未設定') AS practitioner_name,
                r.start_time,
                r.status,
                COALESCE(r.total_price, 0) AS total_price
            FROM reservations r
            WHERE r.tenant_id = $1
              AND r.date = $2
        ),
        reservation_stats AS (
            SELECT
                store_id,
                COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0)::int AS total_revenue,
                COUNT(*) FILTER (WHERE status IN ('pending', 'confirmed', 'completed'))::int AS reservation_count,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
                COUNT(*) FILTER (WHERE status = 'canceled')::int AS canceled_count,
                COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show_count
            FROM reservation_base
            GROUP BY store_id
        ),
        customer_stats AS (
            SELECT
                rb.store_id,
                COUNT(DISTINCT rb.customer_id)::int AS unique_customers,
                COUNT(DISTINCT rb.customer_id) FILTER (
                    WHERE rb.customer_id IS NOT NULL
                      AND (c.created_at AT TIME ZONE $4)::date = $2::date
                )::int AS new_customers
            FROM reservation_base rb
            LEFT JOIN customers c
              ON c.tenant_id = $1
             AND c.id = rb.customer_id
            WHERE rb.status IN ('pending', 'confirmed', 'completed')
            GROUP BY rb.store_id
        ),
        practitioner_totals AS (
            SELECT
                store_id,
                practitioner_name,
                SUM(total_price)::bigint AS revenue
            FROM reservation_base
            WHERE status = 'completed'
            GROUP BY store_id, practitioner_name
        ),
        practitioner_json AS (
            SELECT
                store_id,
                COALESCE(jsonb_object_agg(practitioner_name, revenue), '{}'::jsonb) AS revenue_by_practitioner
            FROM practitioner_totals
            GROUP BY store_id
        ),
        practitioner_customer_totals AS (
            SELECT
                store_id,
                practitioner_name,
                COUNT(DISTINCT customer_id)::bigint AS unique_customers
            FROM reservation_base
            WHERE status IN ('pending', 'confirmed', 'completed')
              AND customer_id IS NOT NULL
            GROUP BY store_id, practitioner_name
        ),
        practitioner_customer_json AS (
            SELECT
                store_id,
                COALESCE(jsonb_object_agg(practitioner_name, unique_customers), '{}'::jsonb) AS unique_customers_by_practitioner
            FROM practitioner_customer_totals
            GROUP BY store_id
        ),
        menu_totals AS (
            SELECT
                rb.store_id,
                rm.menu_name,
                SUM((rm.menu_price * rm.quantity))::bigint AS revenue
            FROM reservation_base rb
            JOIN reservation_menus rm
              ON rm.reservation_id = rb.id
            WHERE rb.status = 'completed'
            GROUP BY rb.store_id, rm.menu_name
        ),
        menu_count_totals AS (
            SELECT
                rb.store_id,
                rm.menu_name,
                COUNT(*)::bigint AS reservation_count
            FROM reservation_base rb
            JOIN reservation_menus rm
              ON rm.reservation_id = rb.id
            WHERE rb.status = 'completed'
            GROUP BY rb.store_id, rm.menu_name
        ),
        menu_json AS (
            SELECT
                store_id,
                COALESCE(jsonb_object_agg(menu_name, revenue), '{}'::jsonb) AS revenue_by_menu
            FROM menu_totals
            GROUP BY store_id
        ),
        menu_count_json AS (
            SELECT
                store_id,
                COALESCE(jsonb_object_agg(menu_name, reservation_count), '{}'::jsonb) AS reservations_count_by_menu
            FROM menu_count_totals
            GROUP BY store_id
        ),
        hour_totals AS (
            SELECT
                store_id,
                split_part(start_time, ':', 1) AS hour_key,
                COUNT(*)::bigint AS reservation_count
            FROM reservation_base
            WHERE status IN ('pending', 'confirmed', 'completed')
            GROUP BY store_id, split_part(start_time, ':', 1)
        ),
        hour_json AS (
            SELECT
                store_id,
                COALESCE(jsonb_object_agg(hour_key, reservation_count), '{}'::jsonb) AS reservations_by_hour
            FROM hour_totals
            GROUP BY store_id
        )
        SELECT
            rs.store_id,
            rs.total_revenue,
            rs.reservation_count,
            rs.completed_count,
            rs.canceled_count,
            rs.no_show_count,
            COALESCE(cs.new_customers, 0) AS new_customers,
            GREATEST(COALESCE(cs.unique_customers, 0) - COALESCE(cs.new_customers, 0), 0) AS returning_customers,
            COALESCE(cs.unique_customers, 0) AS unique_customers,
            CASE
                WHEN rs.completed_count > 0 THEN ROUND(rs.total_revenue::numeric / rs.completed_count)::int
                ELSE 0
            END AS average_order_value,
            COALESCE(pj.revenue_by_practitioner, '{}'::jsonb) AS revenue_by_practitioner,
            COALESCE(mj.revenue_by_menu, '{}'::jsonb) AS revenue_by_menu,
            COALESCE(mcj.reservations_count_by_menu, '{}'::jsonb) AS reservations_count_by_menu,
            COALESCE(pcj.unique_customers_by_practitioner, '{}'::jsonb) AS unique_customers_by_practitioner,
            COALESCE(hj.reservations_by_hour, '{}'::jsonb) AS reservations_by_hour
        FROM reservation_stats rs
        LEFT JOIN customer_stats cs USING (store_id)
        LEFT JOIN practitioner_json pj USING (store_id)
        LEFT JOIN practitioner_customer_json pcj USING (store_id)
        LEFT JOIN menu_json mj USING (store_id)
        LEFT JOIN menu_count_json mcj USING (store_id)
        LEFT JOIN hour_json hj USING (store_id)`,
        [tenantId, targetDate, fallbackStoreId, TIMEZONE],
        tenantId
    );

    const upserts = new Map<string, AnalyticsUpsertRow>();

    for (const store of stores) {
        upserts.set(store.id, createEmptyUpsertRow(store.id));
    }

    for (const row of rows) {
        const storeId = row.store_id;
        if (!upserts.has(storeId)) {
            upserts.set(storeId, createEmptyUpsertRow(storeId));
        }

        upserts.set(storeId, {
            storeId,
            totalRevenue: toInt(row.total_revenue),
            reservationCount: toInt(row.reservation_count),
            completedCount: toInt(row.completed_count),
            canceledCount: toInt(row.canceled_count),
            noShowCount: toInt(row.no_show_count),
            newCustomers: toInt(row.new_customers),
            returningCustomers: toInt(row.returning_customers),
            uniqueCustomers: toInt(row.unique_customers),
            averageOrderValue: toInt(row.average_order_value),
            revenueByPractitioner: toNumericMap(row.revenue_by_practitioner),
            revenueByMenu: toNumericMap(row.revenue_by_menu),
            reservationsCountByMenu: toNumericMap(row.reservations_count_by_menu),
            uniqueCustomersByPractitioner: toNumericMap(row.unique_customers_by_practitioner),
            reservationsByHour: toNumericMap(row.reservations_by_hour),
        });
    }

    await DatabaseService.transaction(async (client) => {
        for (const row of upserts.values()) {
            await client.query(
                `INSERT INTO daily_analytics (
                    tenant_id,
                    store_id,
                    date,
                    total_revenue,
                    reservation_count,
                    completed_count,
                    canceled_count,
                    no_show_count,
                    new_customers,
                    returning_customers,
                    unique_customers,
                    average_order_value,
                    revenue_by_practitioner,
                    revenue_by_menu,
                    reservations_count_by_menu,
                    unique_customers_by_practitioner,
                    reservations_by_hour
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8,
                    $9, $10, $11, $12, $13, $14, $15, $16, $17
                )
                ON CONFLICT (tenant_id, store_id, date)
                DO UPDATE SET
                    total_revenue = EXCLUDED.total_revenue,
                    reservation_count = EXCLUDED.reservation_count,
                    completed_count = EXCLUDED.completed_count,
                    canceled_count = EXCLUDED.canceled_count,
                    no_show_count = EXCLUDED.no_show_count,
                    new_customers = EXCLUDED.new_customers,
                    returning_customers = EXCLUDED.returning_customers,
                    unique_customers = EXCLUDED.unique_customers,
                    average_order_value = EXCLUDED.average_order_value,
                    revenue_by_practitioner = EXCLUDED.revenue_by_practitioner,
                    revenue_by_menu = EXCLUDED.revenue_by_menu,
                    reservations_count_by_menu = EXCLUDED.reservations_count_by_menu,
                    unique_customers_by_practitioner = EXCLUDED.unique_customers_by_practitioner,
                    reservations_by_hour = EXCLUDED.reservations_by_hour,
                    updated_at = NOW()`,
                [
                    tenantId,
                    row.storeId,
                    targetDate,
                    row.totalRevenue,
                    row.reservationCount,
                    row.completedCount,
                    row.canceledCount,
                    row.noShowCount,
                    row.newCustomers,
                    row.returningCustomers,
                    row.uniqueCustomers,
                    row.averageOrderValue,
                    row.revenueByPractitioner,
                    row.revenueByMenu,
                    row.reservationsCountByMenu,
                    row.uniqueCustomersByPractitioner,
                    row.reservationsByHour,
                ]
            );
        }
    }, tenantId);

    return {
        storeCount: stores.length,
        upserted: upserts.size,
    };
}

/**
 * Run daily analytics job for all active tenants.
 */
export async function runDailyAnalytics(date?: string): Promise<DailyAnalyticsStats> {
    const targetDate = resolveDailyAnalyticsTargetDate(date);
    logger.info('Starting daily analytics job', { targetDate, timezone: TIMEZONE });

    const stats: DailyAnalyticsStats = {
        targetDate,
        tenantsProcessed: 0,
        storesProcessed: 0,
        rowsUpserted: 0,
        failedTenants: 0,
    };

    const tenants = await DatabaseService.query<TenantRow>(
        `SELECT id
         FROM tenants
         WHERE status IN ('active', 'trial')`
    );

    for (const tenant of tenants) {
        try {
            const result = await aggregateTenantDailyAnalytics(tenant.id, targetDate);
            stats.tenantsProcessed += 1;
            stats.storesProcessed += result.storeCount;
            stats.rowsUpserted += result.upserted;
        } catch (error) {
            stats.failedTenants += 1;
            logger.error('Failed to aggregate daily analytics for tenant', {
                tenantId: tenant.id,
                targetDate,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    logger.info('Daily analytics job completed', stats);
    return stats;
}

/**
 * HTTP endpoint handler helper
 */
export async function handleDailyAnalyticsRequest(date?: string): Promise<{
    success: boolean;
    stats: DailyAnalyticsStats;
}> {
    const stats = await runDailyAnalytics(date);
    return { success: true, stats };
}
