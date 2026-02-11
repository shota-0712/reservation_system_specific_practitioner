/**
 * Dashboard Routes
 * 管理画面ダッシュボード用 API (PostgreSQL)
 */

import { Router, Request, Response } from 'express';
import { requireFirebaseAuth, requireRole } from '../../middleware/auth.js';
import { getTenant } from '../../middleware/tenant.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { DatabaseService } from '../../config/database.js';
import { createReservationRepository, createPractitionerRepository } from '../../repositories/index.js';
import type { Reservation, Practitioner } from '../../types/index.js';

const router = Router();

const formatDate = (d: Date): string => d.toISOString().split('T')[0];

const minutesBetween = (start: string, end: string): number => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
};

/**
 * ダッシュボード KPI 取得
 * @route GET /v1/:storeCode/admin/dashboard/kpi
 * @access Manager+
 */
router.get(
    '/kpi',
    requireFirebaseAuth(),
    requireRole('staff', 'manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);

        const today = new Date();
        const todayStr = formatDate(today);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = formatDate(yesterday);

        const todayStats = await DatabaseService.queryOne(
            `SELECT
                COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as revenue,
                COUNT(*) FILTER (WHERE status IN ('confirmed','pending','completed')) as bookings,
                COUNT(*) FILTER (WHERE status = 'completed') as completed_count
             FROM reservations
             WHERE tenant_id = $1 AND date = $2`,
            [tenant.id, todayStr],
            tenant.id
        );

        const yesterdayStats = await DatabaseService.queryOne(
            `SELECT
                COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as revenue,
                COUNT(*) FILTER (WHERE status IN ('confirmed','pending','completed')) as bookings,
                COUNT(*) FILTER (WHERE status = 'completed') as completed_count
             FROM reservations
             WHERE tenant_id = $1 AND date = $2`,
            [tenant.id, yesterdayStr],
            tenant.id
        );

        const todayRevenue = parseInt(todayStats?.revenue || '0', 10);
        const yesterdayRevenue = parseInt(yesterdayStats?.revenue || '0', 10);
        const todayBookings = parseInt(todayStats?.bookings || '0', 10);
        const yesterdayBookings = parseInt(yesterdayStats?.bookings || '0', 10);
        const completedToday = parseInt(todayStats?.completed_count || '0', 10);
        const completedYesterday = parseInt(yesterdayStats?.completed_count || '0', 10);

        // 新規顧客
        const todayStart = new Date(todayStr);
        const tomorrowStart = new Date(todayStart);
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);
        const yesterdayStart = new Date(yesterdayStr);

        const newCustomersTodayRow = await DatabaseService.queryOne(
            `SELECT COUNT(*) as count
             FROM customers
             WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
            [tenant.id, todayStart, tomorrowStart],
            tenant.id
        );
        const newCustomersYesterdayRow = await DatabaseService.queryOne(
            `SELECT COUNT(*) as count
             FROM customers
             WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
            [tenant.id, yesterdayStart, todayStart],
            tenant.id
        );

        const newCustomersToday = parseInt(newCustomersTodayRow?.count || '0', 10);
        const newCustomersYesterday = parseInt(newCustomersYesterdayRow?.count || '0', 10);

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
    requireFirebaseAuth(),
    requireRole('staff', 'manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const todayStr = formatDate(new Date());

        const reservationRepo = createReservationRepository(tenant.id);
        const reservations = await reservationRepo.findByDate(todayStr);

        const data = reservations
            .filter(r => ['confirmed', 'pending', 'completed'].includes(r.status))
            .sort((a, b) => a.startTime.localeCompare(b.startTime))
            .map((r: Reservation) => ({
                id: r.id,
                startTime: r.startTime,
                endTime: r.endTime,
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
    requireFirebaseAuth(),
    requireRole('manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const todayStr = formatDate(new Date());

        const practitionerRepo = createPractitionerRepository(tenant.id);
        const reservationRepo = createReservationRepository(tenant.id);

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
    requireFirebaseAuth(),
    requireRole('staff', 'manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);

        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 6);

        const summaryRows = await DatabaseService.query(
            `SELECT
                date,
                COUNT(*) FILTER (WHERE status IN ('confirmed','pending','completed')) as bookings,
                COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
                COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as revenue
             FROM reservations
             WHERE tenant_id = $1
               AND date >= $2
               AND date <= $3
             GROUP BY date
             ORDER BY date ASC`,
            [tenant.id, formatDate(startDate), formatDate(today)],
            tenant.id
        );

        const rowsByDate = new Map<string, Record<string, unknown>>();
        summaryRows.forEach((row) => {
            const key = row.date instanceof Date
                ? row.date.toISOString().split('T')[0]
                : String(row.date);
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
    requireFirebaseAuth(),
    requireRole('staff', 'manager', 'owner'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenant = getTenant(req);
        const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);

        const rows = await DatabaseService.query(
            `SELECT action, entity_type, entity_id, actor_type, actor_id, actor_name, created_at
             FROM audit_logs
             WHERE tenant_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [tenant.id, limit],
            tenant.id
        );

        const data = rows.map((row) => ({
            action: row.action,
            entityType: row.entity_type,
            entityId: row.entity_id,
            actorType: row.actor_type,
            actorId: row.actor_id,
            actorName: row.actor_name,
            createdAt: row.created_at,
        }));

        res.json({ success: true, data });
    })
);
