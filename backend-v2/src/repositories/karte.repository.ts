import { DatabaseService } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';

export interface KarteRecord {
    id: string;
    tenantId: string;
    customerId: string;
    reservationId?: string;
    storeId?: string;
    practitionerId: string;
    customerName?: string;
    customerPictureUrl?: string;
    visitDate: string;
    menuIds: string[];
    menuNames: string[];
    optionIds: string[];
    duration?: number;
    totalAmount?: number;
    treatmentDescription?: string;
    colorFormula?: string;
    productsUsed: string[];
    customerRequest?: string;
    conversationMemo?: string;
    nextVisitNote?: string;
    customFields: Record<string, unknown>;
    photosBefore: string[];
    photosAfter: string[];
    photosOther: Array<Record<string, unknown>>;
    status: 'draft' | 'completed';
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
}

export interface KarteTemplateRecord {
    id: string;
    tenantId: string;
    name: string;
    description?: string;
    isDefault: boolean;
    fields: Array<Record<string, unknown>>;
    applicableMenuCategories: string[];
    isActive: boolean;
    displayOrder: number;
    createdAt: Date;
    updatedAt: Date;
}

function mapKarte(row: Record<string, any>): KarteRecord {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        customerId: row.customer_id,
        reservationId: row.reservation_id ?? undefined,
        storeId: row.store_id ?? undefined,
        practitionerId: row.practitioner_id,
        customerName: row.customer_name ?? undefined,
        customerPictureUrl: row.customer_picture_url ?? undefined,
        visitDate: row.visit_date instanceof Date ? row.visit_date.toISOString().split('T')[0] : row.visit_date,
        menuIds: row.menu_ids ?? [],
        menuNames: row.menu_names ?? [],
        optionIds: row.option_ids ?? [],
        duration: row.duration ?? undefined,
        totalAmount: row.total_amount ?? undefined,
        treatmentDescription: row.treatment_description ?? undefined,
        colorFormula: row.color_formula ?? undefined,
        productsUsed: row.products_used ?? [],
        customerRequest: row.customer_request ?? undefined,
        conversationMemo: row.conversation_memo ?? undefined,
        nextVisitNote: row.next_visit_note ?? undefined,
        customFields: row.custom_fields ?? {},
        photosBefore: row.photos_before ?? [],
        photosAfter: row.photos_after ?? [],
        photosOther: row.photos_other ?? [],
        status: row.status,
        tags: row.tags ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapTemplate(row: Record<string, any>): KarteTemplateRecord {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        description: row.description ?? undefined,
        isDefault: row.is_default ?? false,
        fields: row.fields ?? [],
        applicableMenuCategories: row.applicable_menu_categories ?? [],
        isActive: row.is_active ?? true,
        displayOrder: row.display_order ?? 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export class KarteRepository {
    constructor(private tenantId: string) {}

    async findAll(limit = 100): Promise<KarteRecord[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM kartes
             WHERE tenant_id = $1
             ORDER BY visit_date DESC, created_at DESC
             LIMIT $2`,
            [this.tenantId, limit],
            this.tenantId
        );
        return rows.map(mapKarte);
    }

    async findById(id: string): Promise<KarteRecord | null> {
        const row = await DatabaseService.queryOne(
            `SELECT * FROM kartes WHERE tenant_id = $1 AND id = $2`,
            [this.tenantId, id],
            this.tenantId
        );
        return row ? mapKarte(row as Record<string, any>) : null;
    }

    async findByIdOrFail(id: string): Promise<KarteRecord> {
        const karte = await this.findById(id);
        if (!karte) throw new NotFoundError('カルテ', id);
        return karte;
    }

    async create(data: Partial<KarteRecord>): Promise<KarteRecord> {
        const row = await DatabaseService.queryOne(
            `INSERT INTO kartes (
                tenant_id, customer_id, reservation_id, store_id, practitioner_id,
                customer_name, customer_picture_url,
                visit_date, menu_ids, menu_names, option_ids,
                duration, total_amount,
                treatment_description, color_formula, products_used,
                customer_request, conversation_memo, next_visit_note,
                custom_fields, photos_before, photos_after, photos_other,
                status, tags, created_by
            ) VALUES (
                $1,$2,$3,$4,$5,
                $6,$7,
                $8,$9,$10,$11,
                $12,$13,
                $14,$15,$16,
                $17,$18,$19,
                $20,$21,$22,$23,
                $24,$25,$26
            ) RETURNING *`,
            [
                this.tenantId,
                data.customerId,
                data.reservationId ?? null,
                data.storeId ?? null,
                data.practitionerId,
                data.customerName ?? null,
                data.customerPictureUrl ?? null,
                data.visitDate,
                data.menuIds ?? [],
                data.menuNames ?? [],
                data.optionIds ?? [],
                data.duration ?? null,
                data.totalAmount ?? null,
                data.treatmentDescription ?? null,
                data.colorFormula ?? null,
                data.productsUsed ?? [],
                data.customerRequest ?? null,
                data.conversationMemo ?? null,
                data.nextVisitNote ?? null,
                data.customFields ?? {},
                data.photosBefore ?? [],
                data.photosAfter ?? [],
                data.photosOther ?? [],
                data.status ?? 'draft',
                data.tags ?? [],
                data.practitionerId,
            ],
            this.tenantId
        );

        if (!row) throw new Error('カルテ作成に失敗しました');
        return mapKarte(row as Record<string, any>);
    }

    async update(id: string, data: Partial<KarteRecord>): Promise<KarteRecord> {
        const row = await DatabaseService.queryOne(
            `UPDATE kartes SET
                customer_id = COALESCE($3, customer_id),
                reservation_id = COALESCE($4, reservation_id),
                store_id = COALESCE($5, store_id),
                practitioner_id = COALESCE($6, practitioner_id),
                customer_name = COALESCE($7, customer_name),
                customer_picture_url = COALESCE($8, customer_picture_url),
                visit_date = COALESCE($9, visit_date),
                menu_ids = COALESCE($10, menu_ids),
                menu_names = COALESCE($11, menu_names),
                option_ids = COALESCE($12, option_ids),
                duration = COALESCE($13, duration),
                total_amount = COALESCE($14, total_amount),
                treatment_description = COALESCE($15, treatment_description),
                color_formula = COALESCE($16, color_formula),
                products_used = COALESCE($17, products_used),
                customer_request = COALESCE($18, customer_request),
                conversation_memo = COALESCE($19, conversation_memo),
                next_visit_note = COALESCE($20, next_visit_note),
                custom_fields = COALESCE($21, custom_fields),
                photos_before = COALESCE($22, photos_before),
                photos_after = COALESCE($23, photos_after),
                photos_other = COALESCE($24, photos_other),
                status = COALESCE($25, status),
                tags = COALESCE($26, tags),
                updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2
             RETURNING *`,
            [
                this.tenantId,
                id,
                data.customerId ?? null,
                data.reservationId ?? null,
                data.storeId ?? null,
                data.practitionerId ?? null,
                data.customerName ?? null,
                data.customerPictureUrl ?? null,
                data.visitDate ?? null,
                data.menuIds ?? null,
                data.menuNames ?? null,
                data.optionIds ?? null,
                data.duration ?? null,
                data.totalAmount ?? null,
                data.treatmentDescription ?? null,
                data.colorFormula ?? null,
                data.productsUsed ?? null,
                data.customerRequest ?? null,
                data.conversationMemo ?? null,
                data.nextVisitNote ?? null,
                data.customFields ?? null,
                data.photosBefore ?? null,
                data.photosAfter ?? null,
                data.photosOther ?? null,
                data.status ?? null,
                data.tags ?? null,
            ],
            this.tenantId
        );

        if (!row) throw new NotFoundError('カルテ', id);
        return mapKarte(row as Record<string, any>);
    }

    async delete(id: string): Promise<void> {
        await DatabaseService.query(
            `DELETE FROM kartes WHERE tenant_id = $1 AND id = $2`,
            [this.tenantId, id],
            this.tenantId
        );
    }
}

export class KarteTemplateRepository {
    constructor(private tenantId: string) {}

    async findAll(includeInactive = true): Promise<KarteTemplateRecord[]> {
        const rows = await DatabaseService.query(
            `SELECT * FROM karte_templates
             WHERE tenant_id = $1 ${includeInactive ? '' : 'AND is_active = true'}
             ORDER BY display_order ASC, created_at DESC`,
            [this.tenantId],
            this.tenantId
        );
        return rows.map(mapTemplate);
    }

    async findById(id: string): Promise<KarteTemplateRecord | null> {
        const row = await DatabaseService.queryOne(
            `SELECT * FROM karte_templates WHERE tenant_id = $1 AND id = $2`,
            [this.tenantId, id],
            this.tenantId
        );
        return row ? mapTemplate(row as Record<string, any>) : null;
    }

    async findByIdOrFail(id: string): Promise<KarteTemplateRecord> {
        const template = await this.findById(id);
        if (!template) throw new NotFoundError('カルテテンプレート', id);
        return template;
    }

    async create(data: Partial<KarteTemplateRecord>): Promise<KarteTemplateRecord> {
        const row = await DatabaseService.queryOne(
            `INSERT INTO karte_templates (
                tenant_id, name, description, is_default,
                fields, applicable_menu_categories, is_active, display_order
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *`,
            [
                this.tenantId,
                data.name,
                data.description ?? null,
                data.isDefault ?? false,
                data.fields ?? [],
                data.applicableMenuCategories ?? [],
                data.isActive ?? true,
                data.displayOrder ?? 0,
            ],
            this.tenantId
        );

        if (!row) throw new Error('テンプレート作成に失敗しました');
        return mapTemplate(row as Record<string, any>);
    }

    async update(id: string, data: Partial<KarteTemplateRecord>): Promise<KarteTemplateRecord> {
        const row = await DatabaseService.queryOne(
            `UPDATE karte_templates SET
                name = COALESCE($3, name),
                description = COALESCE($4, description),
                is_default = COALESCE($5, is_default),
                fields = COALESCE($6, fields),
                applicable_menu_categories = COALESCE($7, applicable_menu_categories),
                is_active = COALESCE($8, is_active),
                display_order = COALESCE($9, display_order),
                updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2
             RETURNING *`,
            [
                this.tenantId,
                id,
                data.name ?? null,
                data.description ?? null,
                data.isDefault ?? null,
                data.fields ?? null,
                data.applicableMenuCategories ?? null,
                data.isActive ?? null,
                data.displayOrder ?? null,
            ],
            this.tenantId
        );

        if (!row) throw new NotFoundError('カルテテンプレート', id);
        return mapTemplate(row as Record<string, any>);
    }

    async delete(id: string): Promise<void> {
        await DatabaseService.query(
            `DELETE FROM karte_templates WHERE tenant_id = $1 AND id = $2`,
            [this.tenantId, id],
            this.tenantId
        );
    }
}

export function createKarteRepository(tenantId: string): KarteRepository {
    return new KarteRepository(tenantId);
}

export function createKarteTemplateRepository(tenantId: string): KarteTemplateRepository {
    return new KarteTemplateRepository(tenantId);
}
