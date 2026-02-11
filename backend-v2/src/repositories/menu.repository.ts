/**
 * Menu Repository (SQL)
 */

import { DatabaseService } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import type { Menu } from '../types/index.js';

function mapMenu(row: Record<string, any>): Menu {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        description: row.description ?? undefined,
        category: row.category,
        duration: row.duration,
        price: row.price,
        imageUrl: row.image_url ?? undefined,
        availablePractitionerIds: row.practitioner_ids ?? [],
        displayOrder: row.display_order ?? 0,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export class MenuRepository {
    constructor(private tenantId: string) {}

    async findById(id: string): Promise<Menu | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM menus WHERE id = $1 AND tenant_id = $2',
            [id, this.tenantId],
            this.tenantId
        );
        return row ? mapMenu(row as Record<string, any>) : null;
    }

    async findByIdOrFail(id: string): Promise<Menu> {
        const menu = await this.findById(id);
        if (!menu) throw new NotFoundError('メニュー', id);
        return menu;
    }

    async findAll(options?: { includeInactive?: boolean }): Promise<Menu[]> {
        const includeInactive = options?.includeInactive ?? false;
        const rows = await DatabaseService.query(
            `SELECT * FROM menus WHERE tenant_id = $1 ${includeInactive ? '' : 'AND is_active = true'}
             ORDER BY display_order ASC, created_at DESC`,
            [this.tenantId],
            this.tenantId
        );
        return rows.map(mapMenu);
    }

    async findAllActive(): Promise<Menu[]> {
        return this.findAll({ includeInactive: false });
    }

    async getCategories(): Promise<string[]> {
        const rows = await DatabaseService.query(
            `SELECT DISTINCT category FROM menus WHERE tenant_id = $1 AND is_active = true ORDER BY category ASC`,
            [this.tenantId],
            this.tenantId
        );
        return rows.map(r => r.category).filter(Boolean);
    }

    async findByCategory(category: string): Promise<Menu[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM menus WHERE tenant_id = $1 AND category = $2 AND is_active = true
             ORDER BY display_order ASC`,
            [this.tenantId, category],
            this.tenantId
        );
        return rows.map(mapMenu);
    }

    async findByPractitionerId(practitionerId: string): Promise<Menu[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM menus
             WHERE tenant_id = $1 AND is_active = true
               AND (cardinality(practitioner_ids) = 0 OR $2 = ANY(practitioner_ids))
             ORDER BY display_order ASC`,
            [this.tenantId, practitionerId],
            this.tenantId
        );
        return rows.map(mapMenu);
    }

    async createMenu(data: Partial<Menu>): Promise<Menu> {
        const row = await DatabaseService.queryOne(
            `INSERT INTO menus (
                tenant_id, name, description, category, price, duration, image_url,
                is_active, display_order, practitioner_ids
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING *`,
            [
                this.tenantId,
                data.name,
                data.description ?? null,
                data.category,
                data.price ?? 0,
                data.duration ?? 30,
                data.imageUrl ?? null,
                data.isActive ?? true,
                data.displayOrder ?? 0,
                data.availablePractitionerIds ?? [],
            ],
            this.tenantId
        );
        return mapMenu(row as Record<string, any>);
    }

    async updateMenu(id: string, data: Partial<Menu>): Promise<Menu> {
        const row = await DatabaseService.queryOne(
            `UPDATE menus SET
                name = COALESCE($3, name),
                description = COALESCE($4, description),
                category = COALESCE($5, category),
                price = COALESCE($6, price),
                duration = COALESCE($7, duration),
                image_url = COALESCE($8, image_url),
                is_active = COALESCE($9, is_active),
                display_order = COALESCE($10, display_order),
                practitioner_ids = COALESCE($11, practitioner_ids),
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [
                id,
                this.tenantId,
                data.name ?? null,
                data.description ?? null,
                data.category ?? null,
                data.price ?? null,
                data.duration ?? null,
                data.imageUrl ?? null,
                data.isActive ?? null,
                data.displayOrder ?? null,
                data.availablePractitionerIds ?? null,
            ],
            this.tenantId
        );

        if (!row) throw new NotFoundError('メニュー', id);
        return mapMenu(row as Record<string, any>);
    }

    async softDelete(id: string): Promise<void> {
        await DatabaseService.query(
            'UPDATE menus SET is_active = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
            [id, this.tenantId],
            this.tenantId
        );
    }

    async updateDisplayOrders(orders: Array<{ id: string; displayOrder: number }>): Promise<void> {
        await DatabaseService.transaction(async (client) => {
            for (const order of orders) {
                await client.query(
                    'UPDATE menus SET display_order = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
                    [order.displayOrder, order.id, this.tenantId]
                );
            }
        }, this.tenantId);
    }
}

export function createMenuRepository(tenantId: string): MenuRepository {
    return new MenuRepository(tenantId);
}
