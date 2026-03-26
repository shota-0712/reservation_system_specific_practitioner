/**
 * Reservation Repository (PostgreSQL)
 * CRUD operations for reservations with double-booking prevention
 */

import { DatabaseService } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import type { Reservation, ReservationStatus, PaginationParams } from '../types/index.js';
import { buildReservationFilterSql, type ReservationFilters } from './reservation-filters.js';

const DEFAULT_TIMEZONE = 'Asia/Tokyo';

function buildPeriodRangeSql(
    dateIdx: number,
    startTimeIdx: number,
    endTimeIdx: number,
    timezoneIdx: number
): string {
    return `tstzrange(
        ($${dateIdx}::date || ' ' || $${startTimeIdx} || ':00')::timestamp AT TIME ZONE $${timezoneIdx},
        ($${dateIdx}::date || ' ' || $${endTimeIdx} || ':00')::timestamp AT TIME ZONE $${timezoneIdx},
        '[)'
    )`;
}

interface ReservationMenuRow {
    reservation_id: string;
    menu_id: string;
    menu_name: string;
    menu_price: number;
    menu_duration: number;
    sort_order: number;
}

interface ReservationOptionRow {
    reservation_id: string;
    option_id: string;
    option_name: string;
    option_price: number;
    option_duration: number;
}

export interface ReservationItemInput {
    menuItems?: Array<{
        menuId: string;
        menuName: string;
        menuPrice: number;
        menuDuration: number;
        sortOrder: number;
        isMain: boolean;
    }>;
    optionItems?: Array<{
        optionId: string;
        optionName: string;
        optionPrice: number;
        optionDuration: number;
    }>;
}

export type { ReservationFilters } from './reservation-filters.js';

function mapReservation(row: Record<string, any>): Reservation {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        storeId: row.store_id ?? undefined,
        customerId: row.customer_id,
        customerName: row.customer_name ?? undefined,
        customerPhone: row.customer_phone ?? undefined,
        practitionerId: row.practitioner_id,
        practitionerName: row.practitioner_name ?? '',
        menuIds: row.menu_ids ?? [],
        menuNames: row.menu_names ?? [],
        optionIds: row.option_ids ?? [],
        optionNames: row.option_names ?? [],
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        timezone: row.timezone ?? 'Asia/Tokyo',
        duration: row.total_duration ?? 0,
        totalPrice: row.total_price ?? 0,
        subtotal: row.subtotal ?? undefined,
        optionTotal: row.option_total ?? undefined,
        nominationFee: row.nomination_fee ?? undefined,
        discount: row.discount ?? undefined,
        status: row.status,
        source: row.source ?? 'line',
        customerNote: row.notes ?? undefined,
        staffNote: row.internal_note ?? undefined,
        googleCalendarId: row.google_calendar_id ?? undefined,
        googleCalendarEventId: row.google_calendar_event_id ?? undefined,
        salonboardReservationId: row.salonboard_reservation_id ?? undefined,
        canceledAt: row.canceled_at ?? undefined,
        cancelReason: row.cancel_reason ?? undefined,
        reminderSentAt: row.reminder_sent_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * Reservation Repository
 */
export class ReservationRepository {
    constructor(private tenantId: string) {}

    async setGoogleCalendarRefs(id: string, refs: { calendarId: string; eventId: string }): Promise<void> {
        await DatabaseService.query(
            `UPDATE reservations
             SET google_calendar_id = $3,
                 google_calendar_event_id = $4,
                 updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2`,
            [id, this.tenantId, refs.calendarId, refs.eventId],
            this.tenantId
        );
    }

    async clearGoogleCalendarRefs(id: string): Promise<void> {
        await DatabaseService.query(
            `UPDATE reservations
             SET google_calendar_id = NULL,
                 google_calendar_event_id = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2`,
            [id, this.tenantId],
            this.tenantId
        );
    }

    private async attachItems(reservations: Reservation[]): Promise<Reservation[]> {
        if (reservations.length === 0) return reservations;

        const reservationIds = reservations.map(r => r.id);

        const menuRows = await DatabaseService.query<ReservationMenuRow>(
            `SELECT reservation_id, menu_id, menu_name, menu_price, menu_duration, sort_order
             FROM reservation_menus
             WHERE tenant_id = $1 AND reservation_id = ANY($2)
             ORDER BY sort_order ASC, created_at ASC`,
            [this.tenantId, reservationIds],
            this.tenantId
        );

        const optionRows = await DatabaseService.query<ReservationOptionRow>(
            `SELECT reservation_id, option_id, option_name, option_price, option_duration
             FROM reservation_options
             WHERE tenant_id = $1 AND reservation_id = ANY($2)
             ORDER BY created_at ASC`,
            [this.tenantId, reservationIds],
            this.tenantId
        );

        const menuMap = new Map<string, { ids: string[]; names: string[] }>();
        for (const row of menuRows) {
            const entry = menuMap.get(row.reservation_id) || { ids: [], names: [] };
            if (!entry.ids.includes(row.menu_id)) {
                entry.ids.push(row.menu_id);
            }
            entry.names.push(row.menu_name);
            menuMap.set(row.reservation_id, entry);
        }

        const optionMap = new Map<string, { ids: string[]; names: string[] }>();
        for (const row of optionRows) {
            const entry = optionMap.get(row.reservation_id) || { ids: [], names: [] };
            if (!entry.ids.includes(row.option_id)) {
                entry.ids.push(row.option_id);
            }
            entry.names.push(row.option_name);
            optionMap.set(row.reservation_id, entry);
        }

        return reservations.map(reservation => {
            const menuData = menuMap.get(reservation.id);
            const optionData = optionMap.get(reservation.id);
            return {
                ...reservation,
                menuIds: menuData?.ids ?? [],
                menuNames: menuData?.names ?? [],
                optionIds: optionData?.ids ?? [],
                optionNames: optionData?.names ?? [],
            };
        });
    }

    private async insertReservationItems(
        client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
        reservationId: string,
        data: ReservationItemInput
    ): Promise<void> {
        if (data.menuItems && data.menuItems.length > 0) {
            for (const item of data.menuItems) {
                await client.query(
                    `INSERT INTO reservation_menus (
                        tenant_id, reservation_id, menu_id,
                        menu_name, menu_price, menu_duration,
                        sort_order, is_main, quantity
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                    [
                        this.tenantId,
                        reservationId,
                        item.menuId,
                        item.menuName,
                        item.menuPrice,
                        item.menuDuration,
                        item.sortOrder,
                        item.isMain,
                        1,
                    ]
                );
            }
        }

        if (data.optionItems && data.optionItems.length > 0) {
            for (const item of data.optionItems) {
                await client.query(
                    `INSERT INTO reservation_options (
                        tenant_id, reservation_id, option_id,
                        option_name, option_price, option_duration
                    ) VALUES ($1,$2,$3,$4,$5,$6)`,
                    [
                        this.tenantId,
                        reservationId,
                        item.optionId,
                        item.optionName,
                        item.optionPrice,
                        item.optionDuration,
                    ]
                );
            }
        }
    }

    private async replaceReservationItems(
        client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
        reservationId: string,
        data: ReservationItemInput
    ): Promise<void> {
        await client.query(
            'DELETE FROM reservation_menus WHERE tenant_id = $1 AND reservation_id = $2',
            [this.tenantId, reservationId]
        );
        await client.query(
            'DELETE FROM reservation_options WHERE tenant_id = $1 AND reservation_id = $2',
            [this.tenantId, reservationId]
        );

        await this.insertReservationItems(client, reservationId, data);
    }

    private buildReservationItemSnapshot(data: ReservationItemInput) {
        return {
            menuIds: data.menuItems?.map((item) => item.menuId) ?? [],
            menuNames: data.menuItems?.map((item) => item.menuName) ?? [],
            optionIds: data.optionItems?.map((item) => item.optionId) ?? [],
            optionNames: data.optionItems?.map((item) => item.optionName) ?? [],
        };
    }

    /**
     * Find reservation by ID
     */
    async findById(id: string): Promise<Reservation | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM reservations WHERE id = $1 AND tenant_id = $2',
            [id, this.tenantId],
            this.tenantId
        );
        if (!row) return null;
        const [withItems] = await this.attachItems([mapReservation(row as Record<string, any>)]);
        return withItems ?? null;
    }

    /**
     * Find by ID or throw
     */
    async findByIdOrFail(id: string): Promise<Reservation> {
        const reservation = await this.findById(id);
        if (!reservation) {
            throw new NotFoundError('予約', id);
        }
        return reservation;
    }

    async findBySalonboardReservationId(salonboardReservationId: string): Promise<Reservation | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM reservations WHERE tenant_id = $1 AND salonboard_reservation_id = $2 LIMIT 1',
            [this.tenantId, salonboardReservationId],
            this.tenantId
        );
        if (!row) return null;
        const [withItems] = await this.attachItems([mapReservation(row as Record<string, any>)]);
        return withItems ?? null;
    }

    /**
     * Find reservations with filters
     */
    async findWithFilters(filters: ReservationFilters): Promise<Reservation[]> {
        let sql = 'SELECT * FROM reservations WHERE tenant_id = $1';
        const params: unknown[] = [this.tenantId];
        const filterSql = buildReservationFilterSql(filters, 2);

        sql += filterSql.sql;
        params.push(...filterSql.params);
        sql += ' ORDER BY starts_at ASC';

        const rows = await DatabaseService.query(sql, params, this.tenantId);
        const reservations = rows.map(mapReservation);
        return this.attachItems(reservations);
    }

    /**
     * Find reservations with pagination
     */
    async findPaginatedWithFilters(
        filters: ReservationFilters,
        pagination: PaginationParams
    ): Promise<{
        data: Reservation[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            hasMore: boolean;
        };
    }> {
        const page = pagination.page || 1;
        const limit = pagination.limit || 20;
        const offset = (page - 1) * limit;

        // Count query
        let countSql = 'SELECT COUNT(*) as count FROM reservations WHERE tenant_id = $1';
        let sql = 'SELECT * FROM reservations WHERE tenant_id = $1';
        const params: unknown[] = [this.tenantId];
        const filterSql = buildReservationFilterSql(filters, 2);

        countSql += filterSql.sql;
        sql += filterSql.sql;
        params.push(...filterSql.params);

        // Get total count
        const countRow = await DatabaseService.queryOne(countSql, params, this.tenantId);
        const total = parseInt(countRow?.count || '0', 10);

        // Get paginated data
        const sortField = pagination.sortBy === 'date' ? 'starts_at' : 'created_at';
        const sortOrder = pagination.sortOrder === 'asc' ? 'ASC' : 'DESC';
        sql += ` ORDER BY ${sortField} ${sortOrder}`;
        sql += ` LIMIT $${filterSql.nextParamIndex} OFFSET $${filterSql.nextParamIndex + 1}`;
        params.push(limit, offset);

        const rows = await DatabaseService.query(sql, params, this.tenantId);

        const reservations = await this.attachItems(rows.map(mapReservation));

        return {
            data: reservations,
            pagination: {
                page,
                limit,
                total,
                hasMore: offset + rows.length < total,
            },
        };
    }

    /**
     * Find reservations by date
     */
    async findByDate(date: string): Promise<Reservation[]> {
        return this.findWithFilters({ date });
    }

    /**
     * Find reservations by date range
     */
    async findByDateRange(startDate: string, endDate: string): Promise<Reservation[]> {
        return this.findWithFilters({ dateFrom: startDate, dateTo: endDate });
    }

    /**
     * Find today's reservations
     */
    async findToday(timezone: string = 'Asia/Tokyo'): Promise<Reservation[]> {
        const { format } = await import('date-fns');
        const { toZonedTime } = await import('date-fns-tz');
        const today = format(toZonedTime(new Date(), timezone), 'yyyy-MM-dd');
        return this.findByDate(today);
    }

    /**
     * Find reservations by practitioner and date
     */
    async findByPractitionerAndDate(
        practitionerId: string,
        date: string
    ): Promise<Reservation[]> {
        return this.findWithFilters({ practitionerId, date });
    }

    /**
     * Find upcoming reservations for a customer
     */
    async findUpcomingByCustomer(customerId: string): Promise<Reservation[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM reservations
             WHERE tenant_id = $1
               AND customer_id = $2
               AND starts_at >= NOW()
               AND status IN ('pending', 'confirmed')
             ORDER BY starts_at ASC
             LIMIT 10`,
            [this.tenantId, customerId],
            this.tenantId
        );

        const reservations = rows.map(mapReservation);
        return this.attachItems(reservations);
    }

    /**
     * Find past reservations for a customer
     */
    async findPastByCustomer(
        customerId: string,
        limit = 20
    ): Promise<Reservation[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM reservations
             WHERE tenant_id = $1
               AND customer_id = $2
               AND starts_at < NOW()
             ORDER BY starts_at DESC
             LIMIT $3`,
            [this.tenantId, customerId, limit],
            this.tenantId
        );

        const reservations = rows.map(mapReservation);
        return this.attachItems(reservations);
    }

    /**
     * Create a new reservation
     * Uses TSTZRANGE for double-booking prevention via GIST exclusion constraint
     */
    async create(
        data: Partial<Reservation> & ReservationItemInput
    ): Promise<Reservation> {
        return DatabaseService.transaction(async (client) => {
            const subtotal = (data as any).subtotal ?? data.totalPrice ?? 0;
            const optionTotal = (data as any).optionTotal ?? 0;
            const nominationFee = (data as any).nominationFee ?? 0;
            const discount = (data as any).discount ?? 0;
            const totalPrice = data.totalPrice ?? (subtotal + optionTotal + nominationFee - discount);

            const row = await client.query(
                `INSERT INTO reservations (
                    tenant_id, store_id, customer_id, practitioner_id,
                    starts_at, ends_at, timezone,
                    status, source,
                    subtotal, option_total, nomination_fee, discount, total_price,
                    total_duration,
                    customer_name, customer_phone, practitioner_name,
                    notes, internal_note,
                    google_calendar_id, google_calendar_event_id, salonboard_reservation_id
                ) VALUES (
                    $1, $2, $3, $4,
                    $5::timestamptz, $6::timestamptz, $7,
                    $8, $9,
                    $10, $11, $12, $13, $14,
                    $15,
                    $16, $17, $18,
                    $19, $20,
                    $21, $22, $23
                )
                RETURNING *`,
                [
                    this.tenantId,
                    data.storeId ?? null,
                    data.customerId,
                    data.practitionerId,
                    (data as any).startsAt ?? null,
                    (data as any).endsAt ?? null,
                    (data as any).timezone ?? 'Asia/Tokyo',
                    data.status ?? 'pending',
                    data.source ?? 'line',
                    subtotal,
                    optionTotal,
                    nominationFee,
                    discount,
                    totalPrice,
                    data.duration ?? 0,
                    data.customerName ?? null,
                    data.customerPhone ?? null,
                    data.practitionerName ?? null,
                    data.customerNote ?? null,
                    data.staffNote ?? null,
                    data.googleCalendarId ?? null,
                    data.googleCalendarEventId ?? null,
                    data.salonboardReservationId ?? null,
                ]
            );

            const inserted = row.rows[0];
            if (!inserted) {
                throw new Error('予約の作成に失敗しました');
            }

            const reservationId = inserted.id as string;

            await this.insertReservationItems(client, reservationId, data);

            const reservation = mapReservation(inserted as Record<string, any>);

            return {
                ...reservation,
                ...this.buildReservationItemSnapshot(data),
            };
        }, this.tenantId);
    }

    /**
     * Update reservation (partial fields)
     */
    async update(
        id: string,
        data: Partial<Reservation>
    ): Promise<Reservation> {
        const params: any[] = [
            id,
            this.tenantId,
            data.storeId ?? null,
            data.customerId ?? null,
            data.practitionerId ?? null,
            (data as any).startsAt ?? null,
            (data as any).endsAt ?? null,
            (data as any).timezone ?? null,
            data.status ?? null,
            data.source ?? null,
            data.totalPrice ?? null,
            data.duration ?? null,
            data.customerName ?? null,
            data.customerPhone ?? null,
            data.practitionerName ?? null,
            data.customerNote ?? null,
        ];

        const row = await DatabaseService.queryOne(
            `UPDATE reservations SET
                store_id = COALESCE($3, store_id),
                customer_id = COALESCE($4, customer_id),
                practitioner_id = COALESCE($5, practitioner_id),
                starts_at = COALESCE($6::timestamptz, starts_at),
                ends_at = COALESCE($7::timestamptz, ends_at),
                timezone = COALESCE($8, timezone),
                status = COALESCE($9, status),
                source = COALESCE($10, source),
                total_price = COALESCE($11, total_price),
                total_duration = COALESCE($12, total_duration),
                customer_name = COALESCE($13, customer_name),
                customer_phone = COALESCE($14, customer_phone),
                practitioner_name = COALESCE($15, practitioner_name),
                notes = COALESCE($16, notes),
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            params,
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('予約', id);
        }

        return mapReservation(row as Record<string, any>);
    }

    /**
     * Update reservation details and sync menu/option snapshots
     */
    async updateWithItems(
        id: string,
        data: Partial<Reservation> & ReservationItemInput
    ): Promise<Reservation> {
        return DatabaseService.transaction(async (client) => {
            const subtotal = (data as any).subtotal ?? data.totalPrice ?? 0;
            const optionTotal = (data as any).optionTotal ?? 0;
            const nominationFee = (data as any).nominationFee ?? 0;
            const discount = (data as any).discount ?? 0;
            const totalPrice = data.totalPrice ?? (subtotal + optionTotal + nominationFee - discount);

            const row = await client.query(
                `UPDATE reservations SET
                    store_id = $3,
                    customer_id = $4,
                    practitioner_id = $5,
                    starts_at = $6::timestamptz,
                    ends_at = $7::timestamptz,
                    timezone = $8,
                    status = $9,
                    source = $10,
                    subtotal = $11,
                    option_total = $12,
                    nomination_fee = $13,
                    discount = $14,
                    total_price = $15,
                    total_duration = $16,
                    customer_name = $17,
                    customer_phone = $18,
                    practitioner_name = $19,
                    notes = $20,
                    internal_note = $21,
                    google_calendar_id = $22,
                    google_calendar_event_id = $23,
                    salonboard_reservation_id = $24,
                    updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2
                 RETURNING *`,
                [
                    id,
                    this.tenantId,
                    data.storeId ?? null,
                    data.customerId,
                    data.practitionerId,
                    (data as any).startsAt ?? null,
                    (data as any).endsAt ?? null,
                    (data as any).timezone ?? 'Asia/Tokyo',
                    data.status ?? 'pending',
                    data.source ?? 'line',
                    subtotal,
                    optionTotal,
                    nominationFee,
                    discount,
                    totalPrice,
                    data.duration ?? 0,
                    data.customerName ?? null,
                    data.customerPhone ?? null,
                    data.practitionerName ?? null,
                    data.customerNote ?? null,
                    data.staffNote ?? null,
                    data.googleCalendarId ?? null,
                    data.googleCalendarEventId ?? null,
                    data.salonboardReservationId ?? null,
                ]
            );

            const updated = row.rows[0];
            if (!updated) {
                throw new NotFoundError('予約', id);
            }

            await this.replaceReservationItems(client, id, data);

            const reservation = mapReservation(updated as Record<string, any>);
            const [withItems] = await this.attachItems([reservation]);
            return withItems ?? reservation;
        }, this.tenantId);
    }

    /**
     * Update reservation status
     */
    async updateStatus(
        id: string,
        status: ReservationStatus,
        reason?: string
    ): Promise<Reservation> {
        let sql = `UPDATE reservations SET status = $3, updated_at = NOW()`;
        const params: any[] = [id, this.tenantId, status];

        if (status === 'canceled') {
            sql += `, canceled_at = NOW(), cancel_reason = $4`;
            params.push(reason ?? null);
        }

        sql += ` WHERE id = $1 AND tenant_id = $2 RETURNING *`;

        const row = await DatabaseService.queryOne(sql, params, this.tenantId);

        if (!row) {
            throw new NotFoundError('予約', id);
        }

        return mapReservation(row as Record<string, any>);
    }

    /**
     * Confirm reservation
     */
    async confirm(id: string): Promise<Reservation> {
        return this.updateStatus(id, 'confirmed');
    }

    /**
     * Cancel reservation
     */
    async cancel(id: string, reason?: string): Promise<Reservation> {
        return this.updateStatus(id, 'canceled', reason);
    }

    /**
     * Mark as completed
     */
    async complete(id: string): Promise<Reservation> {
        return this.updateStatus(id, 'completed');
    }

    /**
     * Mark as no-show
     */
    async markNoShow(id: string): Promise<Reservation> {
        return this.updateStatus(id, 'no_show');
    }

    /**
     * Check for time slot conflicts using PostgreSQL TSTZRANGE
     */
    async hasConflict(
        practitionerId: string,
        date: string,
        startTime: string,
        endTime: string,
        opts?: { excludeReservationId?: string; timezone?: string }
    ): Promise<boolean> {
        const tz = opts?.timezone || DEFAULT_TIMEZONE;
        let sql = `
            SELECT COUNT(*) as count
            FROM reservations
            WHERE tenant_id = $1
              AND practitioner_id = $2
              AND status NOT IN ('canceled', 'no_show')
              AND tstzrange(starts_at, ends_at, '[)') && ${buildPeriodRangeSql(3, 4, 5, 6)}
        `;
        const params: any[] = [this.tenantId, practitionerId, date, startTime, endTime, tz];

        if (opts?.excludeReservationId) {
            sql += ` AND id != $7`;
            params.push(opts.excludeReservationId);
        }

        const row = await DatabaseService.queryOne(sql, params, this.tenantId);
        return parseInt(row?.count || '0', 10) > 0;
    }

    /**
     * Get reservation statistics for a date range
     */
    async getStats(startDate: string, endDate: string): Promise<{
        total: number;
        confirmed: number;
        completed: number;
        canceled: number;
        noShow: number;
        totalRevenue: number;
    }> {
        const row = await DatabaseService.queryOne(
            `SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status IN ('confirmed', 'pending')) as confirmed,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'canceled') as canceled,
                COUNT(*) FILTER (WHERE status = 'no_show') as no_show,
                COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as total_revenue
             FROM reservations
             WHERE tenant_id = $1
               AND (starts_at AT TIME ZONE 'Asia/Tokyo')::date >= $2::date
               AND (starts_at AT TIME ZONE 'Asia/Tokyo')::date <= $3::date`,
            [this.tenantId, startDate, endDate],
            this.tenantId
        );

        return {
            total: parseInt(row?.total || '0', 10),
            confirmed: parseInt(row?.confirmed || '0', 10),
            completed: parseInt(row?.completed || '0', 10),
            canceled: parseInt(row?.canceled || '0', 10),
            noShow: parseInt(row?.no_show || '0', 10),
            totalRevenue: parseInt(row?.total_revenue || '0', 10),
        };
    }

    /**
     * Mark reminder as sent
     */
    async markReminderSent(id: string): Promise<Reservation> {
        const row = await DatabaseService.queryOne(
            `UPDATE reservations
             SET reminder_sent_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [id, this.tenantId],
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('予約', id);
        }

        return mapReservation(row as Record<string, any>);
    }

    /**
     * Delete reservation (soft delete by changing status)
     */
    async delete(id: string): Promise<void> {
        await this.updateStatus(id, 'canceled', '管理者による削除');
    }

    /**
     * Get available time slots for a practitioner on a specific date
     */
    async getBookedSlots(
        practitionerId: string,
        date: string,
        timezone: string = DEFAULT_TIMEZONE
    ): Promise<Array<{ startsAt: string; endsAt: string }>> {
        const rows = await DatabaseService.query(
            `SELECT starts_at, ends_at
             FROM reservations
             WHERE tenant_id = $1
               AND practitioner_id = $2
               AND (starts_at AT TIME ZONE $4)::date = $3::date
               AND status NOT IN ('canceled', 'no_show')
             ORDER BY starts_at ASC`,
            [this.tenantId, practitionerId, date, timezone],
            this.tenantId
        );

        return rows.map(r => ({
            startsAt: r.starts_at,
            endsAt: r.ends_at,
        }));
    }
}

/**
 * Factory function
 */
export function createReservationRepository(tenantId: string): ReservationRepository {
    return new ReservationRepository(tenantId);
}
