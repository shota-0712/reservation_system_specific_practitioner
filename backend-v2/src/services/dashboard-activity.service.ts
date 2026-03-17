import { DatabaseService } from '../config/database.js';
import { logger } from '../utils/logger.js';

type DashboardActivityRow = {
    action: string;
    entity_type: string;
    entity_id: string | null;
    actor_type: string | null;
    actor_id: string | null;
    actor_name: string | null;
    created_at: Date | string;
};

export type DashboardActivityItem = {
    action: string;
    entityType: string;
    entityId: string | null;
    actorType: string | null;
    actorId: string | null;
    actorName: string | null;
    createdAt: Date | string;
};

type PgErrorLike = {
    code?: string;
    message?: string;
};

function isRecoverableAuditLogError(error: unknown): boolean {
    const pg = error as PgErrorLike;
    // 42P01: undefined_table
    // 42703: undefined_column
    // 42501: insufficient_privilege
    // 22P02: invalid_text_representation (e.g. legacy RLS current_setting cast issue)
    return pg?.code === '42P01'
        || pg?.code === '42703'
        || pg?.code === '42501'
        || pg?.code === '22P02';
}

export async function getDashboardActivity(
    tenantId: string,
    limit: number
): Promise<DashboardActivityItem[]> {
    try {
        const rows = await DatabaseService.query<DashboardActivityRow>(
            `SELECT action, entity_type, entity_id, actor_type, actor_id, actor_name, created_at
             FROM audit_logs
             WHERE tenant_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [tenantId, limit],
            tenantId
        );

        return rows.map((row) => ({
            action: row.action,
            entityType: row.entity_type,
            entityId: row.entity_id,
            actorType: row.actor_type,
            actorId: row.actor_id,
            actorName: row.actor_name,
            createdAt: row.created_at,
        }));
    } catch (error) {
        if (isRecoverableAuditLogError(error)) {
            const pg = error as PgErrorLike;
            logger.warn('Dashboard activity fallback: audit_logs query unavailable', {
                tenantId,
                code: pg.code,
                message: pg.message,
            });
            return [];
        }
        throw error;
    }
}

