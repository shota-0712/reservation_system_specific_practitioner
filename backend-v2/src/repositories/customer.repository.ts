/**
 * Customer Repository (PostgreSQL)
 * CRUD operations for customers with RFM analysis support
 */

import { DatabaseService } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import type { Customer } from '../types/index.js';

export interface CustomerFilters {
    search?: string;
    rfmSegment?: string;
    tags?: string[];
    hasPhone?: boolean;
    hasEmail?: boolean;
}

function mapCustomer(row: Record<string, any>): Customer {
    const lineNotificationToken = row.line_notification_token ?? row.attributes?.notificationToken ?? undefined;
    return {
        id: row.id,
        tenantId: row.tenant_id,
        lineUserId: row.line_user_id ?? undefined,
        lineDisplayName: row.line_display_name ?? undefined,
        linePictureUrl: row.line_picture_url ?? undefined,
        name: row.name,
        nameKana: row.name_kana ?? undefined,
        phone: row.phone ?? undefined,
        email: row.email ?? undefined,
        imageUrl: row.line_picture_url ?? undefined,
        birthDate: row.birthday ? (row.birthday instanceof Date ? row.birthday.toISOString().split('T')[0] : row.birthday) : undefined,
        gender: row.gender ?? undefined,
        totalVisits: row.total_visits ?? 0,
        totalSpend: row.total_spend ?? 0,
        averageSpend: row.average_spend ?? 0,
        lastVisitAt: row.last_visit_at ?? undefined,
        firstVisitAt: row.first_visit_at ?? undefined,
        rfmSegment: row.rfm_segment ?? undefined,
        tags: row.tags ?? [],
        memo: row.notes ?? undefined,
        notificationSettings: {
            reminder: true,
            marketing: true,
        },
        lineNotificationToken,
        lineNotificationTokenExpiresAt: row.line_notification_token_expires_at ?? undefined,
        notificationToken: lineNotificationToken,
        lastAccessAt: row.updated_at,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * Customer Repository
 */
export class CustomerRepository {
    constructor(private tenantId: string) {}

    /**
     * Find customer by ID
     */
    async findById(id: string): Promise<Customer | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM customers WHERE id = $1 AND tenant_id = $2',
            [id, this.tenantId],
            this.tenantId
        );
        return row ? mapCustomer(row as Record<string, any>) : null;
    }

    /**
     * Find by ID or throw
     */
    async findByIdOrFail(id: string): Promise<Customer> {
        const customer = await this.findById(id);
        if (!customer) {
            throw new NotFoundError('顧客', id);
        }
        return customer;
    }

    /**
     * Find customer by LINE User ID
     */
    async findByLineUserId(lineUserId: string): Promise<Customer | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM customers WHERE tenant_id = $1 AND line_user_id = $2',
            [this.tenantId, lineUserId],
            this.tenantId
        );
        return row ? mapCustomer(row as Record<string, any>) : null;
    }

    /**
     * Find customer by phone
     */
    async findByPhone(phone: string): Promise<Customer | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM customers WHERE tenant_id = $1 AND phone = $2',
            [this.tenantId, phone],
            this.tenantId
        );
        return row ? mapCustomer(row as Record<string, any>) : null;
    }

    /**
     * Find customer by email
     */
    async findByEmail(email: string): Promise<Customer | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM customers WHERE tenant_id = $1 AND email = $2',
            [this.tenantId, email],
            this.tenantId
        );
        return row ? mapCustomer(row as Record<string, any>) : null;
    }

    /**
     * Find or create customer by LINE User ID
     */
    async findOrCreate(
        lineUserId: string,
        lineDisplayName: string,
        linePictureUrl?: string
    ): Promise<Customer> {
        const existing = await this.findByLineUserId(lineUserId);

        if (existing) {
            // Update LINE info
            const row = await DatabaseService.queryOne(
                `UPDATE customers SET
                    line_display_name = $3,
                    line_picture_url = $4,
                    updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2
                 RETURNING *`,
                [existing.id, this.tenantId, lineDisplayName, linePictureUrl ?? null],
                this.tenantId
            );
            return mapCustomer(row as Record<string, any>);
        }

        // Create new customer
        const row = await DatabaseService.queryOne(
            `INSERT INTO customers (
                tenant_id, line_user_id, line_display_name, line_picture_url,
                name, is_active, total_visits, total_spend, cancel_count, no_show_count, tags
            ) VALUES ($1, $2, $3, $4, $5, true, 0, 0, 0, 0, '{}')
            RETURNING *`,
            [this.tenantId, lineUserId, lineDisplayName, linePictureUrl ?? null, lineDisplayName],
            this.tenantId
        );

        return mapCustomer(row as Record<string, any>);
    }

    /**
     * Find all customers
     */
    async findAll(options?: { limit?: number }): Promise<Customer[]> {
        const limit = options?.limit ?? 1000;
        const rows = await DatabaseService.query(
            `SELECT * FROM customers
             WHERE tenant_id = $1 AND is_active = true
             ORDER BY created_at DESC
             LIMIT $2`,
            [this.tenantId, limit],
            this.tenantId
        );
        return rows.map(mapCustomer);
    }

    /**
     * Search customers using pg_trgm
     */
    async search(query: string, limit = 20): Promise<Customer[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM customers
             WHERE tenant_id = $1
               AND is_active = true
               AND (
                   name ILIKE $2
                   OR name_kana ILIKE $2
                   OR line_display_name ILIKE $2
                   OR phone ILIKE $2
                   OR email ILIKE $2
               )
             ORDER BY name ASC
             LIMIT $3`,
            [this.tenantId, `%${query}%`, limit],
            this.tenantId
        );
        return rows.map(mapCustomer);
    }

    /**
     * Find customers by RFM segment
     */
    async findByRfmSegment(segment: string): Promise<Customer[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM customers
             WHERE tenant_id = $1
               AND is_active = true
               AND rfm_segment = $2
             ORDER BY total_spend DESC`,
            [this.tenantId, segment],
            this.tenantId
        );
        return rows.map(mapCustomer);
    }

    /**
     * Find customers by tag
     */
    async findByTag(tag: string): Promise<Customer[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM customers
             WHERE tenant_id = $1
               AND is_active = true
               AND $2 = ANY(tags)`,
            [this.tenantId, tag],
            this.tenantId
        );
        return rows.map(mapCustomer);
    }

    /**
     * Find customers with pagination and filters
     */
    async findPaginatedWithFilters(
        filters: Record<string, unknown>,
        options: {
            page?: number;
            limit?: number;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
        } = {}
    ): Promise<{
        data: Customer[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    }> {
        const { page = 1, limit = 20, sortBy = 'created_at', sortOrder = 'desc' } = options;
        const offset = (page - 1) * limit;

        let countSql = 'SELECT COUNT(*) as count FROM customers WHERE tenant_id = $1 AND is_active = true';
        let sql = 'SELECT * FROM customers WHERE tenant_id = $1 AND is_active = true';
        const params: any[] = [this.tenantId];
        let paramIndex = 2;

        if (filters.tag && typeof filters.tag === 'string') {
            const clause = ` AND $${paramIndex} = ANY(tags)`;
            countSql += clause;
            sql += clause;
            params.push(filters.tag);
            paramIndex++;
        }

        if (filters.rfmSegment && typeof filters.rfmSegment === 'string') {
            const clause = ` AND rfm_segment = $${paramIndex}`;
            countSql += clause;
            sql += clause;
            params.push(filters.rfmSegment);
            paramIndex++;
        }

        if (filters.query && typeof filters.query === 'string') {
            const clause = ` AND (name ILIKE $${paramIndex} OR name_kana ILIKE $${paramIndex} OR line_display_name ILIKE $${paramIndex} OR phone ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
            countSql += clause;
            sql += clause;
            params.push(`%${filters.query}%`);
            paramIndex++;
        }

        // Get total count
        const countRow = await DatabaseService.queryOne(countSql, params, this.tenantId);
        const total = parseInt(countRow?.count || '0', 10);

        // Get paginated data
        const validSortFields = ['created_at', 'name', 'total_spend', 'total_visits', 'last_visit_at'];
        const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
        const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

        sql += ` ORDER BY ${sortField} ${order}`;
        sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const rows = await DatabaseService.query(sql, params, this.tenantId);
        const totalPages = Math.ceil(total / limit);

        return {
            data: rows.map(mapCustomer),
            total,
            page,
            limit,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
        };
    }

    /**
     * Create a new customer
     */
    async create(data: Partial<Customer>): Promise<Customer> {
        const row = await DatabaseService.queryOne(
            `INSERT INTO customers (
                tenant_id, line_user_id, line_display_name, line_picture_url,
                name, name_kana, email, phone, birthday, gender,
                hair_type, scalp_condition, allergies, medical_notes, preferences,
                line_notification_token, line_notification_token_expires_at,
                is_active, total_visits, total_spend, cancel_count, no_show_count, tags, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, true, 0, 0, 0, 0, $18, $19)
            RETURNING *`,
            [
                this.tenantId,
                data.lineUserId ?? null,
                data.lineDisplayName ?? null,
                data.linePictureUrl ?? null,
                data.name,
                data.nameKana ?? null,
                data.email ?? null,
                data.phone ?? null,
                data.birthDate ?? null,
                data.gender ?? null,
                null, // hair_type
                null, // scalp_condition
                [], // allergies
                null, // medical_notes
                null, // preferences
                data.lineNotificationToken ?? data.notificationToken ?? null,
                data.lineNotificationTokenExpiresAt ?? null,
                data.tags ?? [],
                data.memo ?? null,
            ],
            this.tenantId
        );

        return mapCustomer(row as Record<string, any>);
    }

    /**
     * Update customer
     */
    async update(id: string, data: Partial<Customer>): Promise<Customer> {
        const params: any[] = [id, this.tenantId];
        const notificationToken = data.lineNotificationToken ?? data.notificationToken;

        params.push(
            data.name ?? null,
            data.nameKana ?? null,
            data.email ?? null,
            data.phone ?? null,
            data.birthDate ?? null,
            data.gender ?? null,
            data.lineDisplayName ?? null,
            data.linePictureUrl ?? null,
            data.tags ?? null,
            data.memo ?? null,
            data.isActive ?? null,
            notificationToken ?? null,
            data.lineNotificationTokenExpiresAt ?? null
        );

        const row = await DatabaseService.queryOne(
            `UPDATE customers SET
                name = COALESCE($3, name),
                name_kana = COALESCE($4, name_kana),
                email = COALESCE($5, email),
                phone = COALESCE($6, phone),
                birthday = COALESCE($7, birthday),
                gender = COALESCE($8, gender),
                line_display_name = COALESCE($9, line_display_name),
                line_picture_url = COALESCE($10, line_picture_url),
                tags = COALESCE($11, tags),
                notes = COALESCE($12, notes),
                is_active = COALESCE($13, is_active),
                line_notification_token = COALESCE($14, line_notification_token),
                line_notification_token_expires_at = COALESCE($15, line_notification_token_expires_at),
                attributes = CASE
                    WHEN $14 IS NULL THEN attributes
                    ELSE COALESCE(attributes, '{}'::jsonb) || jsonb_build_object('notificationToken', $14)
                END,
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            params,
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('顧客', id);
        }

        return mapCustomer(row as Record<string, any>);
    }

    async updateLineNotificationToken(
        customerId: string,
        lineNotificationToken: string | null,
        expiresAt?: Date | null
    ): Promise<Customer> {
        const row = await DatabaseService.queryOne(
            `UPDATE customers SET
                line_notification_token = $3,
                line_notification_token_expires_at = $4,
                attributes = CASE
                    WHEN $3 IS NULL THEN attributes - 'notificationToken'
                    ELSE COALESCE(attributes, '{}'::jsonb) || jsonb_build_object('notificationToken', $3)
                END,
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [customerId, this.tenantId, lineNotificationToken, expiresAt ?? null],
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('顧客', customerId);
        }

        return mapCustomer(row as Record<string, any>);
    }

    /**
     * Update customer stats after a completed reservation
     */
    async updateStatsAfterReservation(
        customerId: string,
        totalPrice: number,
        date: string
    ): Promise<Customer> {
        const row = await DatabaseService.queryOne(
            `UPDATE customers SET
                total_visits = total_visits + 1,
                total_spend = total_spend + $3,
                average_spend = (total_spend + $3) / (total_visits + 1),
                last_visit_at = $4::timestamptz,
                first_visit_at = COALESCE(first_visit_at, $4::timestamptz),
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [customerId, this.tenantId, totalPrice, date],
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('顧客', customerId);
        }

        // Update RFM segment
        const customer = mapCustomer(row as Record<string, any>);
        const rfmSegment = this.calculateRfmSegment(customer);

        if (rfmSegment !== customer.rfmSegment) {
            await DatabaseService.query(
                `UPDATE customers SET rfm_segment = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
                [customerId, this.tenantId, rfmSegment],
                this.tenantId
            );
            customer.rfmSegment = rfmSegment;
        }

        return customer;
    }

    /**
     * Calculate RFM segment
     */
    private calculateRfmSegment(customer: Customer): string {
        const lastVisitDate = customer.lastVisitAt;
        const daysSinceLastVisit = lastVisitDate
            ? Math.floor((Date.now() - new Date(lastVisitDate).getTime()) / (1000 * 60 * 60 * 24))
            : Infinity;

        const visitCount = customer.totalVisits ?? 0;
        const totalSpent = customer.totalSpend ?? 0;

        // VIP: Recent, frequent, high spending
        if (daysSinceLastVisit <= 30 && visitCount >= 10 && totalSpent >= 100000) {
            return 'vip';
        }

        // Loyal: Regular, moderate spending
        if (daysSinceLastVisit <= 60 && visitCount >= 5) {
            return 'loyal';
        }

        // New: First time or very recent
        if (visitCount <= 2) {
            return 'new';
        }

        // Dormant: Haven't visited in a while
        if (daysSinceLastVisit > 60 && daysSinceLastVisit <= 180) {
            return 'dormant';
        }

        // Lost: Haven't visited in a long time
        if (daysSinceLastVisit > 180) {
            return 'lost';
        }

        return 'loyal';
    }

    /**
     * Increment no-show count
     */
    async incrementNoShow(customerId: string): Promise<Customer> {
        const row = await DatabaseService.queryOne(
            `UPDATE customers SET
                no_show_count = no_show_count + 1,
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [customerId, this.tenantId],
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('顧客', customerId);
        }

        return mapCustomer(row as Record<string, any>);
    }

    /**
     * Increment cancel count
     */
    async incrementCancel(customerId: string): Promise<Customer> {
        const row = await DatabaseService.queryOne(
            `UPDATE customers SET
                cancel_count = cancel_count + 1,
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [customerId, this.tenantId],
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('顧客', customerId);
        }

        return mapCustomer(row as Record<string, any>);
    }

    /**
     * Add tag to customer
     */
    async addTag(customerId: string, tag: string): Promise<Customer> {
        const row = await DatabaseService.queryOne(
            `UPDATE customers SET
                tags = array_append(tags, $3),
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2 AND NOT ($3 = ANY(tags))
             RETURNING *`,
            [customerId, this.tenantId, tag],
            this.tenantId
        );

        if (!row) {
            // Tag might already exist, just return current customer
            return this.findByIdOrFail(customerId);
        }

        return mapCustomer(row as Record<string, any>);
    }

    /**
     * Remove tag from customer
     */
    async removeTag(customerId: string, tag: string): Promise<Customer> {
        const row = await DatabaseService.queryOne(
            `UPDATE customers SET
                tags = array_remove(tags, $3),
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [customerId, this.tenantId, tag],
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('顧客', customerId);
        }

        return mapCustomer(row as Record<string, any>);
    }

    /**
     * Get all unique tags
     */
    async getAllTags(): Promise<string[]> {
        const rows = await DatabaseService.query(
            `SELECT DISTINCT unnest(tags) as tag
             FROM customers
             WHERE tenant_id = $1 AND is_active = true
             ORDER BY tag`,
            [this.tenantId],
            this.tenantId
        );
        return rows.map(r => r.tag);
    }

    /**
     * Get customer statistics
     */
    async getCustomerStats(): Promise<{
        total: number;
        vip: number;
        loyal: number;
        new: number;
        dormant: number;
        lost: number;
    }> {
        const row = await DatabaseService.queryOne(
            `SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE rfm_segment = 'vip') as vip,
                COUNT(*) FILTER (WHERE rfm_segment = 'loyal') as loyal,
                COUNT(*) FILTER (WHERE rfm_segment = 'new' OR rfm_segment IS NULL) as new,
                COUNT(*) FILTER (WHERE rfm_segment = 'dormant') as dormant,
                COUNT(*) FILTER (WHERE rfm_segment = 'lost') as lost
             FROM customers
             WHERE tenant_id = $1 AND is_active = true`,
            [this.tenantId],
            this.tenantId
        );

        return {
            total: parseInt(row?.total || '0', 10),
            vip: parseInt(row?.vip || '0', 10),
            loyal: parseInt(row?.loyal || '0', 10),
            new: parseInt(row?.new || '0', 10),
            dormant: parseInt(row?.dormant || '0', 10),
            lost: parseInt(row?.lost || '0', 10),
        };
    }

    /**
     * Soft delete customer
     */
    async softDelete(id: string): Promise<void> {
        await DatabaseService.query(
            `UPDATE customers SET is_active = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
            [id, this.tenantId],
            this.tenantId
        );
    }

    /**
     * Get reservation history for a customer
     */
    async getReservationHistory(customerId: string): Promise<any[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM reservations
             WHERE tenant_id = $1 AND customer_id = $2
             ORDER BY created_at DESC`,
            [this.tenantId, customerId],
            this.tenantId
        );
        return rows;
    }

    /**
     * Get stats summary
     */
    async getStats(): Promise<any> {
        const row = await DatabaseService.queryOne(
            `SELECT
                COUNT(*) as total_customers,
                SUM(total_visits) as total_visits,
                SUM(total_spend) as total_spent
             FROM customers
             WHERE tenant_id = $1 AND is_active = true`,
            [this.tenantId],
            this.tenantId
        );

        const segmentStats = await this.getCustomerStats();

        return {
            totalCustomers: parseInt(row?.total_customers || '0', 10),
            totalVisits: parseInt(row?.total_visits || '0', 10),
            totalSpent: parseInt(row?.total_spent || '0', 10),
            segments: segmentStats,
            avgSpentPerCustomer: row?.total_customers > 0
                ? Math.round(parseInt(row?.total_spent || '0', 10) / parseInt(row?.total_customers, 10))
                : 0,
        };
    }
}

/**
 * Factory function
 */
export function createCustomerRepository(tenantId: string): CustomerRepository {
    return new CustomerRepository(tenantId);
}
