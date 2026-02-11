/**
 * Option Repository (PostgreSQL)
 * CRUD operations for menu options
 */

import { DatabaseService } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import type { Option } from '../types/index.js';

function mapOption(row: Record<string, any>): Option {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        description: row.description ?? undefined,
        duration: row.duration ?? 0,
        price: row.price ?? 0,
        applicableMenuIds: row.applicable_menu_ids ?? [],
        displayOrder: row.display_order ?? 0,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * Option Repository
 */
export class OptionRepository {
    constructor(private tenantId: string) {}

    /**
     * Find option by ID
     */
    async findById(id: string): Promise<Option | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM menu_options WHERE id = $1 AND tenant_id = $2',
            [id, this.tenantId],
            this.tenantId
        );
        return row ? mapOption(row as Record<string, any>) : null;
    }

    /**
     * Find by ID or throw
     */
    async findByIdOrFail(id: string): Promise<Option> {
        const option = await this.findById(id);
        if (!option) {
            throw new NotFoundError('オプション', id);
        }
        return option;
    }

    /**
     * Find all options
     */
    async findAll(options?: { includeInactive?: boolean }): Promise<Option[]> {
        const includeInactive = options?.includeInactive ?? false;
        const rows = await DatabaseService.query(
            `SELECT * FROM menu_options
             WHERE tenant_id = $1 ${includeInactive ? '' : 'AND is_active = true'}
             ORDER BY display_order ASC, created_at DESC`,
            [this.tenantId],
            this.tenantId
        );
        return rows.map(mapOption);
    }

    /**
     * Find all active options
     */
    async findAllActive(): Promise<Option[]> {
        return this.findAll({ includeInactive: false });
    }

    /**
     * Find options applicable to a specific menu
     */
    async findByMenuId(menuId: string): Promise<Option[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM menu_options
             WHERE tenant_id = $1
               AND is_active = true
               AND (cardinality(applicable_menu_ids) = 0 OR $2 = ANY(applicable_menu_ids))
             ORDER BY display_order ASC`,
            [this.tenantId, menuId],
            this.tenantId
        );
        return rows.map(mapOption);
    }

    /**
     * Create option
     */
    async create(data: Partial<Option>): Promise<Option> {
        const row = await DatabaseService.queryOne(
            `INSERT INTO menu_options (
                tenant_id, name, description, price, duration, applicable_menu_ids, is_active, display_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [
                this.tenantId,
                data.name,
                data.description ?? null,
                data.price ?? 0,
                data.duration ?? 0,
                data.applicableMenuIds ?? [],
                data.isActive ?? true,
                data.displayOrder ?? 0,
            ],
            this.tenantId
        );

        return mapOption(row as Record<string, any>);
    }

    /**
     * Update option
     */
    async update(id: string, data: Partial<Option>): Promise<Option> {
        const row = await DatabaseService.queryOne(
            `UPDATE menu_options SET
                name = COALESCE($3, name),
                description = COALESCE($4, description),
                price = COALESCE($5, price),
                duration = COALESCE($6, duration),
                applicable_menu_ids = COALESCE($7, applicable_menu_ids),
                is_active = COALESCE($8, is_active),
                display_order = COALESCE($9, display_order),
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [
                id,
                this.tenantId,
                data.name ?? null,
                data.description ?? null,
                data.price ?? null,
                data.duration ?? null,
                data.applicableMenuIds ?? null,
                data.isActive ?? null,
                data.displayOrder ?? null,
            ],
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('オプション', id);
        }

        return mapOption(row as Record<string, any>);
    }

    /**
     * Soft delete option
     */
    async softDelete(id: string): Promise<void> {
        await DatabaseService.query(
            'UPDATE menu_options SET is_active = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
            [id, this.tenantId],
            this.tenantId
        );
    }

    /**
     * Update display orders
     */
    async updateDisplayOrders(orders: Array<{ id: string; displayOrder: number }>): Promise<void> {
        await DatabaseService.transaction(async (client) => {
            for (const order of orders) {
                await client.query(
                    'UPDATE menu_options SET display_order = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
                    [order.displayOrder, order.id, this.tenantId]
                );
            }
        }, this.tenantId);
    }
}

/**
 * Factory function
 */
export function createOptionRepository(tenantId: string): OptionRepository {
    return new OptionRepository(tenantId);
}
