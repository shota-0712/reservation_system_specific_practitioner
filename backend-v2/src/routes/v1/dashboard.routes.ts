/**
 * Dashboard Routes
 * 管理画面ダッシュボード用 API (PostgreSQL)
 */

import { Router, Request, Response } from 'express';
import { formatInTimeZone } from 'date-fns-tz';
import { requireRole } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { validateQuery } from '../../middleware/validation.js';
import { DatabaseService } from '../../config/database.js';
import { createReservationRepository, createPractitionerRepository } from '../../repositories/index.js';
import type { Reservation, Practitioner } from '../../types/index.js';
import { getDashboardActivity } from '../../services/dashboard-activity.service.js';
import { z } from 'zod';

const router = Router();
const DEFAULT_DASHBOARD_TIMEZONE = 'Asia/Tokyo';

const formatDate = (d: Date): string => d.toISOString().split('T')[0];
const reservationLocalDateSql = (alias: string): string =>
    `(${alias}.starts_at AT TIME ZONE COALESCE(${alias}.timezone, '${DEFAULT_DASHBOARD_TIMEZONE}'))::date`;

const minutesBetween = (start: string, end: string): number => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
};

const dashboardActivityQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

interface DashboardAnalyticsRow {
    row_count: number | string;
    revenue: number | string;
    bookings: number | string;
    completed_count: number | string;
    new_customers: number | string;
}

interface DashboardAnalyticsSummary {
    rowCount: number;
    revenue: number;
    bookings: number;
    completedCount: number;
    newCustomers: number;
}

const toInt = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    }
    return 0;
};

async function fetchDashboardSummaryFromDailyAnalytics(
    tenantId: string,
    date: string
): Promise<DashboardAnalyticsSummary> {
    const row = await DatabaseService.queryOne<DashboardAnalyticsRow>(
        `SELECT
            COUNT(*) as row_count,
            COALESCE(SUM(total_revenue), 0) as revenue,
            COALESCE(SUM(reservation_count), 0) as bookings,
            COALESCE(SUM(completed_count), 0) as completed_count,
            COALESCE(SUM(new_customers), 0) as new_customers
         FROM daily_analytics
         WHERE tenant_id = $1
           AND date = $2`,
        [tenantId, date],
        tenantId
    );

    return {
        rowCount: toInt(row?.row_count),
        revenue: toInt(row?.revenue),
        bookings: toInt(row?.bookings),
        completedCount: toInt(row?.completed_count),
        newCustomers: toInt(row?.new_customers),
    };
}

/**
 * ダッシュボード KPI 取得
 * @route GET /v1/:storeCode/admin/dashboard/kpi
 * @access Manager+
 */
router.get(
    '/kpi',
    requireRole('staff', 'manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);

        const today = new Date();
        const todayStr = formatDate(today);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = formatDate(yesterday);
        const localDateSql = reservationLocalDateSql('r');

        const [todayAnalytics, yesterdayAnalytics] = await Promise.all([
            fetchDashboardSummaryFromDailyAnalytics(tenantId, todayStr),
            fetchDashboardSummaryFromDailyAnalytics(tenantId, yesterdayStr),
        ]);

        let todayRevenue = todayAnalytics.revenue;
        let yesterdayRevenue = yesterdayAnalytics.revenue;
        let todayBookings = todayAnalytics.bookings;
        let yesterdayBookings = yesterdayAnalytics.bookings;
        let completedToday = todayAnalytics.completedCount;
        let completedYesterday = yesterdayAnalytics.completedCount;
        let newCustomersToday = todayAnalytics.newCustomers;
        let newCustomersYesterday = yesterdayAnalytics.newCustomers;

        if (todayAnalytics.rowCount === 0 || yesterdayAnalytics.rowCount === 0) {
            const [todayStats, yesterdayStats] = await Promise.all([
                todayAnalytics.rowCount === 0
                    ? DatabaseService.queryOne(
                        `SELECT
                            COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as revenue,
                            COUNT(*) FILTER (WHERE status IN ('confirmed','pending','completed')) as bookings,
                            COUNT(*) FILTER (WHERE status = 'completed') as completed_count
                         FROM reservations r
                         WHERE r.tenant_id = $1 AND ${localDateSql} = $2::date`,
                        [tenantId, todayStr],
                        tenantId
                    )
                    : Promise.resolve(null),
                yesterdayAnalytics.rowCount === 0
                    ? DatabaseService.queryOne(
                        `SELECT
                            COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as revenue,
                            COUNT(*) FILTER (WHERE status IN ('confirmed','pending','completed')) as bookings,
                            COUNT(*) FILTER (WHERE status = 'completed') as completed_count
                         FROM reservations r
                         WHERE r.tenant_id = $1 AND ${localDateSql} = $2::date`,
                        [tenantId, yesterdayStr],
                        tenantId
                    )
                    : Promise.resolve(null),
            ]);

            const todayStart = new Date(todayStr);
            const tomorrowStart = new Date(todayStart);
            tomorrowStart.setDate(tomorrowStart.getDate() + 1);
            const yesterdayStart = new Date(yesterdayStr);

            const [newCustomersTodayRow, newCustomersYesterdayRow] = await Promise.all([
                todayAnalytics.rowCount === 0
                    ? DatabaseService.queryOne(
                        `SELECT COUNT(*) as count
                         FROM customers
                         WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
                        [tenantId, todayStart, tomorrowStart],
                        tenantId
                    )
                    : Promise.resolve(null),
                yesterdayAnalytics.rowCount === 0
                    ? DatabaseService.queryOne(
                        `SELECT COUNT(*) as count
                         FROM customers
                         WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
                        [tenantId, yesterdayStart, todayStart],
                        tenantId
                    )
                    : Promise.resolve(null),
            ]);

            if (todayAnalytics.rowCount === 0) {
                todayRevenue = toInt(todayStats?.revenue);
                todayBookings = toInt(todayStats?.bookings);
                completedToday = toInt(todayStats?.completed_count);
                newCustomersToday = toInt(newCustomersTodayRow?.count);
            }

            if (yesterdayAnalytics.rowCount === 0) {
                yesterdayRevenue = toInt(yesterdayStats?.revenue);
                yesterdayBookings = toInt(yesterdayStats?.bookings);
                completedYesterday = toInt(yesterdayStats?.completed_count);
                newCustomersYesterday = toInt(newCustomersYesterdayRow?.count);
            }
        }

        const avgSpendToday = completedToday > 0 ? todayRevenue / completedToday : 0;
        const avgSpendYesterday = completedYesterday > 0 ? yesterdayRevenue / completedYesterday : 0;

        const calculateChange = (current: number, prev: number): number => {
            if (prev === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - prev) / prev) * 100);
        };

        const kpi = {
            revenue: {
                value: todayRevenue,
                change: calculateChange(todayRevenue, yesterdayRevenue),
                label: '本日の売上',
            },
            bookings: {
                value: todayBookings,
                change: todayBookings - yesterdayBookings,
                label: '本日の予約',
            },
            newCustomers: {
                value: newCustomersToday,
                change: newCustomersToday - newCustomersYesterday,
                label: '新規顧客',
            },
            avgSpend: {
                value: Math.round(avgSpendToday),
                change: calculateChange(avgSpendToday, avgSpendYesterday),
                label: '平均客単価',
            },
        };

        res.json({
            success: true,
            data: kpi,
        });
    })
);

/**
 * 今日の予約一覧を取得
 * @route GET /v1/:storeCode/admin/dashboard/today
 * @access Staff+
 */
router.get(
    '/today',
    requireRole('staff', 'manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const todayStr = formatDate(new Date());

        const reservationRepo = createReservationRepository(tenantId);
        const reservations = await reservationRepo.findByDate(todayStr);

        const data = reservations
            .filter(r => ['confirmed', 'pending', 'completed'].includes(r.status))
            .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
            .map((r: Reservation) => ({
                id: r.id,
                startTime: formatInTimeZone(new Date(r.startsAt), r.timezone, 'HH:mm'),
                endTime: formatInTimeZone(new Date(r.endsAt), r.timezone, 'HH:mm'),
                customerName: r.customerName,
                menuNames: r.menuNames,
                practitionerName: r.practitionerName,
                status: r.status,
                totalPrice: r.totalPrice,
            }));

        res.json({
            success: true,
            data,
        });
    })
);

/**
 * スタッフ稼働状況を取得
 * @route GET /v1/:storeCode/admin/dashboard/staff-utilization
 * @access Manager+
 */
router.get(
    '/staff-utilization',
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const todayStr = formatDate(new Date());

        const practitionerRepo = createPractitionerRepository(tenantId);
        const reservationRepo = createReservationRepository(tenantId);

        const practitioners = await practitionerRepo.findAllActive();
        const reservations = await reservationRepo.findByDate(todayStr);

        const utilization = practitioners.map((practitioner: Practitioner) => {
            const practitionerReservations = reservations.filter(
                r => r.practitionerId === practitioner.id && r.status !== 'canceled'
            );

            const bookedMinutes = practitionerReservations.reduce(
                (sum, r) => sum + (r.duration ?? 0),
                0
            );

            const workMinutes = practitioner.schedule
                ? minutesBetween(practitioner.schedule.workHours.start, practitioner.schedule.workHours.end)
                : 0;

            const utilizationRate = workMinutes > 0
                ? Math.round((bookedMinutes / workMinutes) * 100)
                : 0;

            return {
                id: practitioner.id,
                name: practitioner.name,
                bookedMinutes,
                workMinutes,
                utilizationRate: Math.min(utilizationRate, 100),
                utilization: Math.min(utilizationRate, 100),
                bookingsCount: practitionerReservations.length,
            };
        });

        res.json({
            success: true,
            data: utilization,
        });
    })
);


/**
 * 週次サマリー取得
 * @route GET /v1/:storeCode/admin/dashboard/weekly-summary
 * @access Staff+
 */
router.get(
    '/weekly-summary',
    requireRole('staff', 'manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);

        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 6);
        const localDateSql = reservationLocalDateSql('r');

        const summaryRows = await DatabaseService.query(
            `SELECT
                to_char(r.starts_at AT TIME ZONE COALESCE(r.timezone, '${DEFAULT_DASHBOARD_TIMEZONE}'), 'YYYY-MM-DD') as local_date,
                COUNT(*) FILTER (WHERE r.status IN ('confirmed','pending','completed')) as bookings,
                COUNT(*) FILTER (WHERE r.status = 'completed') as completed_count,
                COALESCE(SUM(r.total_price) FILTER (WHERE r.status = 'completed'), 0) as revenue
             FROM reservations r
             WHERE r.tenant_id = $1
               AND ${localDateSql} >= $2::date
               AND ${localDateSql} <= $3::date
             GROUP BY local_date
             ORDER BY local_date ASC`,
            [tenantId, formatDate(startDate), formatDate(today)],
            tenantId
        );

        const rowsByDate = new Map<string, Record<string, unknown>>();
        summaryRows.forEach((row) => {
            const key = String(row.local_date);
            rowsByDate.set(key, row as Record<string, unknown>);
        });

        const data = Array.from({ length: 7 }).map((_, idx) => {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + idx);
            const key = formatDate(d);
            const row = rowsByDate.get(key);
            return {
                date: key,
                bookings: parseInt(String(row?.bookings || '0'), 10),
                completed: parseInt(String(row?.completed_count || '0'), 10),
                revenue: parseInt(String(row?.revenue || '0'), 10),
            };
        });

        res.json({ success: true, data });
    })
);

export default router;

/**
 * アクティビティログ取得
 * @route GET /v1/:storeCode/admin/dashboard/activity
 * @access Staff+
 */
router.get(
    '/activity',
    requireRole('staff', 'manager', 'owner'),
    validateQuery(dashboardActivityQuerySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const { limit } = dashboardActivityQuerySchema.parse(req.query);
        const data = await getDashboardActivity(tenantId, limit);

        res.json({ success: true, data });
    })
);
