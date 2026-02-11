/**
 * Practitioner Repository (SQL)
 */

import { DatabaseService } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import type { Practitioner } from '../types/index.js';

type WorkScheduleDay = {
    isWorking: boolean;
    startTime?: string;
    endTime?: string;
    breakStartTime?: string;
    breakEndTime?: string;
};

type WorkSchedule = Record<string, WorkScheduleDay>;

function mapWorkScheduleToSchedule(workSchedule?: WorkSchedule): Practitioner['schedule'] | undefined {
    if (!workSchedule) return undefined;
    const workDays: number[] = [];
    let firstDay: WorkScheduleDay | undefined;
    const dayConfigs: NonNullable<Practitioner['schedule']>['dayConfigs'] = {};

    for (let day = 0; day <= 6; day += 1) {
        const dayConfig = workSchedule[String(day)];
        dayConfigs[String(day)] = {
            isWorking: Boolean(dayConfig?.isWorking),
            startTime: dayConfig?.startTime,
            endTime: dayConfig?.endTime,
            breakStartTime: dayConfig?.breakStartTime,
            breakEndTime: dayConfig?.breakEndTime,
        };
        if (dayConfig?.isWorking) {
            workDays.push(day);
            if (!firstDay) firstDay = dayConfig;
        }
    }

    if (!firstDay) return undefined;

    return {
        workDays,
        workHours: {
            start: firstDay.startTime || '10:00',
            end: firstDay.endTime || '20:00',
        },
        breakTime: firstDay.breakStartTime && firstDay.breakEndTime
            ? { start: firstDay.breakStartTime, end: firstDay.breakEndTime }
            : undefined,
        dayConfigs,
    };
}

function scheduleToWorkSchedule(schedule?: Practitioner['schedule']): WorkSchedule {
    const workSchedule: WorkSchedule = {};
    const dayConfigs = schedule?.dayConfigs;
    for (let day = 0; day <= 6; day += 1) {
        const dayKey = String(day);
        const dayConfig = dayConfigs?.[dayKey];
        if (dayConfig) {
            workSchedule[dayKey] = {
                isWorking: dayConfig.isWorking,
                startTime: dayConfig.startTime || schedule?.workHours.start,
                endTime: dayConfig.endTime || schedule?.workHours.end,
                breakStartTime: dayConfig.breakStartTime || schedule?.breakTime?.start,
                breakEndTime: dayConfig.breakEndTime || schedule?.breakTime?.end,
            };
            continue;
        }

        if (schedule?.workDays?.includes(day)) {
            workSchedule[String(day)] = {
                isWorking: true,
                startTime: schedule.workHours.start,
                endTime: schedule.workHours.end,
                breakStartTime: schedule.breakTime?.start,
                breakEndTime: schedule.breakTime?.end,
            };
        } else {
            workSchedule[String(day)] = { isWorking: false };
        }
    }
    return workSchedule;
}

function mapPractitioner(row: Record<string, any>): Practitioner {
    const schedule = mapWorkScheduleToSchedule(row.work_schedule as WorkSchedule | undefined);

    return {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        nameKana: row.name_kana ?? undefined,
        role: row.role ?? 'stylist',
        phone: row.phone ?? undefined,
        email: row.email ?? undefined,
        imageUrl: row.image_url ?? undefined,
        color: row.color ?? '#3b82f6',
        title: row.title ?? undefined,
        description: row.description ?? undefined,
        experience: row.experience ?? undefined,
        prTitle: row.pr_title ?? undefined,
        specialties: row.specialties ?? [],
        snsInstagram: row.sns_instagram ?? undefined,
        snsTwitter: row.sns_twitter ?? undefined,
        nominationFee: row.nomination_fee ?? 0,
        storeIds: row.store_ids ?? [],
        schedule,
        availableMenuIds: row.available_menu_ids ?? undefined,
        calendarId: row.google_calendar_id ?? undefined,
        salonboardStaffId: row.salonboard_staff_id ?? undefined,
        displayOrder: row.display_order ?? 0,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    } as Practitioner;
}

export class PractitionerRepository {
    constructor(private tenantId: string) {}

    async findById(id: string): Promise<Practitioner | null> {
        const row = await DatabaseService.queryOne(
            'SELECT * FROM practitioners WHERE id = $1 AND tenant_id = $2',
            [id, this.tenantId],
            this.tenantId
        );
        return row ? mapPractitioner(row as Record<string, any>) : null;
    }

    async findByIdOrFail(id: string): Promise<Practitioner> {
        const p = await this.findById(id);
        if (!p) throw new NotFoundError('施術者', id);
        return p;
    }

    async findAllActive(): Promise<Practitioner[]> {
        const rows = await DatabaseService.query(
            'SELECT * FROM practitioners WHERE tenant_id = $1 AND is_active = true ORDER BY display_order ASC',
            [this.tenantId],
            this.tenantId
        );
        return rows.map(mapPractitioner);
    }

    async findAll(): Promise<Practitioner[]> {
        const rows = await DatabaseService.query(
            'SELECT * FROM practitioners WHERE tenant_id = $1 ORDER BY display_order ASC',
            [this.tenantId],
            this.tenantId
        );
        return rows.map(mapPractitioner);
    }

    async findByRole(role: string): Promise<Practitioner[]> {
        const rows = await DatabaseService.query(
            'SELECT * FROM practitioners WHERE tenant_id = $1 AND role = $2 AND is_active = true ORDER BY display_order ASC',
            [this.tenantId, role],
            this.tenantId
        );
        return rows.map(mapPractitioner);
    }

    async findByMenuId(menuId: string): Promise<Practitioner[]> {
        const menuRow = await DatabaseService.queryOne(
            'SELECT practitioner_ids FROM menus WHERE id = $1 AND tenant_id = $2',
            [menuId, this.tenantId],
            this.tenantId
        );

        const ids = (menuRow?.practitioner_ids as string[] | null) ?? [];

        let rows: Array<Record<string, any>>;
        if (ids.length === 0) {
            rows = await DatabaseService.query(
                'SELECT * FROM practitioners WHERE tenant_id = $1 AND is_active = true ORDER BY display_order ASC',
                [this.tenantId],
                this.tenantId
            );
        } else {
            rows = await DatabaseService.query(
                'SELECT * FROM practitioners WHERE tenant_id = $1 AND id = ANY($2) AND is_active = true ORDER BY display_order ASC',
                [this.tenantId, ids],
                this.tenantId
            );
        }

        return rows.map(mapPractitioner);
    }

    async findByWorkDay(dayOfWeek: number): Promise<Practitioner[]> {
        const rows = await this.findAllActive();
        return rows.filter(p => p.schedule?.workDays?.includes(dayOfWeek));
    }

    async createPractitioner(data: Partial<Practitioner>): Promise<Practitioner> {
        const workSchedule = scheduleToWorkSchedule(data.schedule);

        const row = await DatabaseService.queryOne(
            `INSERT INTO practitioners (
                tenant_id, name, role, name_kana, title, image_url, description,
                experience, pr_title, specialties, sns_instagram, sns_twitter,
                google_calendar_id, salonboard_staff_id, nomination_fee,
                work_schedule, store_ids, is_active, display_order, color
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            RETURNING *`,
            [
                this.tenantId,
                data.name,
                data.role ?? 'stylist',
                data.nameKana ?? null,
                data.title ?? null,
                data.imageUrl ?? null,
                data.description ?? null,
                data.experience ?? null,
                data.prTitle ?? null,
                data.specialties ?? [],
                data.snsInstagram ?? null,
                data.snsTwitter ?? null,
                data.calendarId ?? null,
                data.salonboardStaffId ?? null,
                data.nominationFee ?? 0,
                workSchedule,
                data.storeIds ?? [],
                data.isActive ?? true,
                data.displayOrder ?? 0,
                data.color ?? '#3b82f6',
            ],
            this.tenantId
        );

        return mapPractitioner(row as Record<string, any>);
    }

    async updatePractitioner(id: string, data: Partial<Practitioner>): Promise<Practitioner> {
        const workSchedule = data.schedule ? scheduleToWorkSchedule(data.schedule) : null;

        const row = await DatabaseService.queryOne(
            `UPDATE practitioners SET
                name = COALESCE($3, name),
                role = COALESCE($4, role),
                name_kana = COALESCE($5, name_kana),
                title = COALESCE($6, title),
                image_url = COALESCE($7, image_url),
                description = COALESCE($8, description),
                experience = COALESCE($9, experience),
                pr_title = COALESCE($10, pr_title),
                specialties = COALESCE($11, specialties),
                sns_instagram = COALESCE($12, sns_instagram),
                sns_twitter = COALESCE($13, sns_twitter),
                google_calendar_id = COALESCE($14, google_calendar_id),
                salonboard_staff_id = COALESCE($15, salonboard_staff_id),
                nomination_fee = COALESCE($16, nomination_fee),
                work_schedule = COALESCE($17, work_schedule),
                store_ids = COALESCE($18, store_ids),
                is_active = COALESCE($19, is_active),
                display_order = COALESCE($20, display_order),
                color = COALESCE($21, color),
                updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [
                id,
                this.tenantId,
                data.name ?? null,
                data.role ?? null,
                data.nameKana ?? null,
                data.title ?? null,
                data.imageUrl ?? null,
                data.description ?? null,
                data.experience ?? null,
                data.prTitle ?? null,
                data.specialties ?? null,
                data.snsInstagram ?? null,
                data.snsTwitter ?? null,
                data.calendarId ?? null,
                data.salonboardStaffId ?? null,
                data.nominationFee ?? null,
                workSchedule,
                data.storeIds ?? null,
                data.isActive ?? null,
                data.displayOrder ?? null,
                data.color ?? null,
            ],
            this.tenantId
        );

        if (!row) throw new NotFoundError('施術者', id);
        return mapPractitioner(row as Record<string, any>);
    }

    async softDelete(id: string): Promise<void> {
        await DatabaseService.query(
            'UPDATE practitioners SET is_active = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
            [id, this.tenantId],
            this.tenantId
        );
    }

    async updateDisplayOrders(orders: Array<{ id: string; displayOrder: number }>): Promise<void> {
        await DatabaseService.transaction(async (client) => {
            for (const order of orders) {
                await client.query(
                    'UPDATE practitioners SET display_order = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
                    [order.displayOrder, order.id, this.tenantId]
                );
            }
        }, this.tenantId);
    }
}

export function createPractitionerRepository(tenantId: string): PractitionerRepository {
    return new PractitionerRepository(tenantId);
}
