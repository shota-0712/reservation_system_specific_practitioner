/**
 * Option Repository (PostgreSQL)
 * CRUD operations for menu options
 */

import { DatabaseService } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import type { Option } from '../types/index.js';

function isUndefinedTableError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: string }).code === '42P01';
}

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

    private async hydrateMenuAssignments(options: Option[]): Promise<Option[]> {
        if (options.length === 0) return options;
        const optionIds = options.map((option) => option.id);

        try {
            const rows = await DatabaseService.query<{ option_id: string; menu_ids: string[] | null }>(
                `SELECT
                    option_id,
                    array_agg(menu_id ORDER BY menu_id) AS menu_ids
                 FROM option_menu_assignments
                 WHERE tenant_id = $1
                   AND option_id = ANY($2)
                 GROUP BY option_id`,
                [this.tenantId, optionIds],
                this.tenantId
            );

            const map = new Map<string, string[]>();
            for (const row of rows) {
                map.set(row.option_id, row.menu_ids ?? []);
            }

            return options.map((option) => ({
                ...option,
                applicableMenuIds: map.has(option.id)
                    ? (map.get(option.id) ?? [])
                    : (option.applicableMenuIds ?? []),
            }));
        } catch (error) {
            if (isUndefinedTableError(error)) {
                return options;
            }
            throw error;
        }
    }

    private async replaceMenuAssignments(optionId: string, menuIds: string[] | undefined): Promise<void> {
        if (menuIds === undefined) return;
        try {
            await DatabaseService.transaction(async (client) => {
                await client.query(
                    `DELETE FROM option_menu_assignments
                     WHERE tenant_id = $1 AND option_id = $2`,
                    [this.tenantId, optionId]
                );
                for (const menuId of menuIds) {
                    await client.query(
                        `INSERT INTO option_menu_assignments (tenant_id, option_id, menu_id)
                         VALUES ($1, $2, $3)
                         ON CONFLICT DO NOTHING`,
                        [this.tenantId, optionId, menuId]
                    );
                }
            }, this.tenantId);
        } catch (error) {
            if (isUndefinedTableError(error)) {
                return;
            }
            throw error;
        }
    }

    /**
     * Find option by ID
     */
    async findById(id: string): Promise<Option | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM menu_options WHERE id = $1 AND tenant_id = $2',
            [id, this.tenantId],
            this.tenantId
        );
        if (!row) return null;
        const [option] = await this.hydrateMenuAssignments([mapOption(row as Record<string, any>)]);
        return option ?? null;
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
        return this.hydrateMenuAssignments(rows.map(mapOption));
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
        try {
            const rows = await DatabaseService.query(
                `SELECT *
                 FROM menu_options o
                 WHERE o.tenant_id = $1
                   AND o.is_active = true
                   AND (
                       EXISTS (
                           SELECT 1
                           FROM option_menu_assignments oma
                           WHERE oma.tenant_id = o.tenant_id
                             AND oma.option_id = o.id
                             AND oma.menu_id = $2
                       )
                       OR NOT EXISTS (
                           SELECT 1
                           FROM option_menu_assignments oma_any
                           WHERE oma_any.tenant_id = o.tenant_id
                             AND oma_any.option_id = o.id
                       )
                   )
                 ORDER BY o.display_order ASC`,
                [this.tenantId, menuId],
                this.tenantId
            );
            return this.hydrateMenuAssignments(rows.map(mapOption));
        } catch (error) {
            if (!isUndefinedTableError(error)) {
                throw error;
            }
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
    }

    /**
     * Create option
     */
    async create(data: Partial<Option>): Promise<Option> {
        const row = await DatabaseService.queryOne(
            `INSERT INTO menu_options (
                tenant_id, name, description, price, duration, is_active, display_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [
                this.tenantId,
                data.name,
                data.description ?? null,
                data.price ?? 0,
                data.duration ?? 0,
                data.isActive ?? true,
                data.displayOrder ?? 0,
            ],
            this.tenantId
        );

        const created = mapOption(row as Record<string, any>);
        await this.replaceMenuAssignments(created.id, data.applicableMenuIds);
        const saved = await this.findById(created.id);
        return saved ?? created;
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
                is_active = COALESCE($7, is_active),
                display_order = COALESCE($8, display_order),
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
                data.isActive ?? null,
                data.displayOrder ?? null,
            ],
            this.tenantId
        );

        if (!row) {
            throw new NotFoundError('オプション', id);
        }

        await this.replaceMenuAssignments(id, data.applicableMenuIds);
        const saved = await this.findById(id);
        return saved ?? mapOption(row as Record<string, any>);
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
