/**
 * Reports Routes
 * 売上・分析レポート API (PostgreSQL)
 */

import { Router, Request, Response } from 'express';
import { requireFirebaseAuth, requireRole } from '../../middleware/auth.js';
import { getTenant } from '../../middleware/tenant.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { DatabaseService } from '../../config/database.js';
import { getMenuRankingData, getPractitionerRevenueData } from '../../services/reports-aggregation.service.js';

const router = Router();

const formatDate = (d: Date): string => d.toISOString().split('T')[0];

const toInt = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    }
    return 0;
};

interface AnalyticsSummaryRow {
    row_count: number | string;
    revenue: number | string;
    bookings: number | string;
    completed_count: number | string;
    unique_customers: number | string;
    new_customers: number | string;
}

interface AnalyticsSummary {
    rowCount: number;
    revenue: number;
    bookings: number;
    completedCount: number;
    uniqueCustomers: number;
    newCustomers: number;
}

async function fetchSummaryFromDailyAnalytics(
    tenantId: string,
    startDate: string,
    endDate: string
): Promise<AnalyticsSummary> {
    const row = await DatabaseService.queryOne<AnalyticsSummaryRow>(
        `SELECT
            COUNT(*) as row_count,
            COALESCE(SUM(total_revenue), 0) as revenue,
            COALESCE(SUM(reservation_count), 0) as bookings,
            COALESCE(SUM(completed_count), 0) as completed_count,
            COALESCE(SUM(unique_customers), 0) as unique_customers,
            COALESCE(SUM(new_customers), 0) as new_customers
         FROM daily_analytics
         WHERE tenant_id = $1
           AND date >= $2
           AND date <= $3`,
        [tenantId, startDate, endDate],
        tenantId
    );

    return {
        rowCount: toInt(row?.row_count),
        revenue: toInt(row?.revenue),
        bookings: toInt(row?.bookings),
        completedCount: toInt(row?.completed_count),
        uniqueCustomers: toInt(row?.unique_customers),
        newCustomers: toInt(row?.new_customers),
    };
}

/**
 * レポートサマリー取得
 * @route GET /v1/:storeCode/admin/reports/summary
 * @access Manager+
 */
router.get(
    '/summary',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const period = (req.query.period as string) || 'month'; // 'week', 'month', 'year'

        const today = new Date();
        let startDate: Date;
        let endDate: Date;
        let prevStartDate: Date;
        let prevEndDate: Date;

        if (period === 'week') {
            startDate = new Date(today);
            startDate.setDate(today.getDate() - 7);
            endDate = today;
            prevEndDate = new Date(startDate);
            prevStartDate = new Date(startDate);
            prevStartDate.setDate(startDate.getDate() - 7);
        } else if (period === 'year') {
            startDate = new Date(today.getFullYear(), 0, 1);
            endDate = today;
            prevStartDate = new Date(today.getFullYear() - 1, 0, 1);
            prevEndDate = new Date(today.getFullYear() - 1, 11, 31);
        } else {
            // month
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            endDate = today;
            prevStartDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            prevEndDate = new Date(today.getFullYear(), today.getMonth(), 0);
        }

        const startDateStr = formatDate(startDate);
        const endDateStr = formatDate(endDate);
        const prevStartDateStr = formatDate(prevStartDate);
        const prevEndDateStr = formatDate(prevEndDate);

        const [currentAnalytics, prevAnalytics] = await Promise.all([
            fetchSummaryFromDailyAnalytics(tenant.id, startDateStr, endDateStr),
            fetchSummaryFromDailyAnalytics(tenant.id, prevStartDateStr, prevEndDateStr),
        ]);

        let currentRevenue = currentAnalytics.revenue;
        let prevRevenue = prevAnalytics.revenue;
        let currentBookings = currentAnalytics.bookings;
        let prevBookings = prevAnalytics.bookings;
        let completedCurrent = currentAnalytics.completedCount;
        let completedPrev = prevAnalytics.completedCount;
        let repeatRate = 0;

        if (currentAnalytics.rowCount > 0) {
            const repeatCustomers = Math.max(currentAnalytics.uniqueCustomers - currentAnalytics.newCustomers, 0);
            repeatRate = currentAnalytics.uniqueCustomers > 0
                ? (repeatCustomers / currentAnalytics.uniqueCustomers) * 100
                : 0;
        } else {
            const repeatTotals = await DatabaseService.queryOne(
                `SELECT
                    COUNT(*) as total_customers,
                    COUNT(*) FILTER (WHERE visit_count > 1) as repeat_customers
                 FROM (
                    SELECT customer_id, COUNT(*) as visit_count
                    FROM reservations
                    WHERE tenant_id = $1
                      AND date >= $2 AND date <= $3
                      AND status IN ('completed','confirmed','pending')
                    GROUP BY customer_id
                 ) t`,
                [tenant.id, startDateStr, endDateStr],
                tenant.id
            );

            const totalCustomers = toInt(repeatTotals?.total_customers);
            const repeatCustomers = toInt(repeatTotals?.repeat_customers);
            repeatRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;
        }

        if (currentAnalytics.rowCount === 0 || prevAnalytics.rowCount === 0) {
            const [currentStats, prevStats] = await Promise.all([
                DatabaseService.queryOne(
                    `SELECT
                        COUNT(*) as bookings,
                        COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
                        COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as revenue
                     FROM reservations
                     WHERE tenant_id = $1
                       AND date >= $2 AND date <= $3
                       AND status IN ('completed','confirmed','pending')`,
                    [tenant.id, startDateStr, endDateStr],
                    tenant.id
                ),
                DatabaseService.queryOne(
                    `SELECT
                        COUNT(*) as bookings,
                        COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
                        COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as revenue
                     FROM reservations
                     WHERE tenant_id = $1
                       AND date >= $2 AND date <= $3
                       AND status IN ('completed','confirmed','pending')`,
                    [tenant.id, prevStartDateStr, prevEndDateStr],
                    tenant.id
                ),
            ]);

            currentRevenue = currentAnalytics.rowCount > 0 ? currentRevenue : toInt(currentStats?.revenue);
            prevRevenue = prevAnalytics.rowCount > 0 ? prevRevenue : toInt(prevStats?.revenue);
            currentBookings = currentAnalytics.rowCount > 0 ? currentBookings : toInt(currentStats?.bookings);
            prevBookings = prevAnalytics.rowCount > 0 ? prevBookings : toInt(prevStats?.bookings);
            completedCurrent = currentAnalytics.rowCount > 0 ? completedCurrent : toInt(currentStats?.completed_count);
            completedPrev = prevAnalytics.rowCount > 0 ? completedPrev : toInt(prevStats?.completed_count);
        }

        const avgSpendCurrent = completedCurrent > 0 ? currentRevenue / completedCurrent : 0;
        const avgSpendPrev = completedPrev > 0 ? prevRevenue / completedPrev : 0;

        const calculateChange = (current: number, prev: number): number => {
            if (prev === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - prev) / prev) * 100);
        };

        const summary = {
            revenue: {
                value: currentRevenue,
                change: calculateChange(currentRevenue, prevRevenue),
            },
            bookings: {
                value: currentBookings,
                change: calculateChange(currentBookings, prevBookings),
            },
            avgSpend: {
                value: Math.round(avgSpendCurrent),
                change: calculateChange(avgSpendCurrent, avgSpendPrev),
            },
            repeatRate: {
                value: Math.round(repeatRate * 10) / 10,
                change: 0,
            },
        };

        res.json({
            success: true,
            data: summary,
        });
    })
);

/**
 * 月次売上推移取得
 * @route GET /v1/:storeCode/admin/reports/revenue
 * @access Manager+
 */
router.get(
    '/revenue',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);

        const today = new Date();
        const months: Array<{ key: string; label: string; start: string; end: string }> = [];

        for (let i = 5; i >= 0; i--) {
            const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const endDate = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            months.push({
                key,
                label: `${date.getMonth() + 1}月`,
                start: formatDate(date),
                end: formatDate(endDate),
            });
        }

        const startRange = months[0].start;
        const endRange = months[months.length - 1].end;

        const rows = await DatabaseService.query(
            `SELECT
                to_char(date_trunc('month', date::timestamp), 'YYYY-MM') as month_key,
                COALESCE(SUM(total_revenue), 0) as revenue
             FROM daily_analytics
             WHERE tenant_id = $1
               AND date >= $2 AND date <= $3
             GROUP BY month_key
             ORDER BY month_key`,
            [tenant.id, startRange, endRange],
            tenant.id
        );

        let sourceRows = rows;
        if (sourceRows.length === 0) {
            sourceRows = await DatabaseService.query(
                `SELECT
                    to_char(date_trunc('month', date), 'YYYY-MM') as month_key,
                    COALESCE(SUM(total_price), 0) as revenue
                 FROM reservations
                 WHERE tenant_id = $1
                   AND status = 'completed'
                   AND date >= $2 AND date <= $3
                 GROUP BY month_key
                 ORDER BY month_key`,
                [tenant.id, startRange, endRange],
                tenant.id
            );
        }

        const revenueByMonth = new Map<string, number>();
        sourceRows.forEach((r: any) => revenueByMonth.set(r.month_key, toInt(r.revenue)));

        const revenueData = months.map(m => ({
            month: m.label,
            revenue: revenueByMonth.get(m.key) ?? 0,
        }));

        res.json({
            success: true,
            data: revenueData,
        });
    })
);

/**
 * メニュー別ランキング取得
 * @route GET /v1/:storeCode/admin/reports/menu-ranking
 * @access Manager+
 */
router.get(
    '/menu-ranking',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);

        const today = new Date();
        const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        const startDateStr = formatDate(startDate);

        const ranking = await getMenuRankingData(tenant.id, startDateStr);

        res.json({
            success: true,
            data: ranking,
        });
    })
);

/**
 * スタッフ別売上取得
 * @route GET /v1/:storeCode/admin/reports/practitioner-revenue
 * @access Manager+
 */
router.get(
    '/practitioner-revenue',
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);

        const today = new Date();
        const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        const startDateStr = formatDate(startDate);

        const data = await getPractitionerRevenueData(tenant.id, startDateStr);

        res.json({
            success: true,
            data,
        });
    })
);

export default router;
