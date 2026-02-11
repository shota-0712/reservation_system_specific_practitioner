import { Request } from 'express';
import { DatabaseService } from '../config/database.js';
import { logger } from '../utils/logger.js';

export type AuditActorType = 'admin' | 'customer' | 'system';

export interface AuditLogInput {
    tenantId: string;
    action: string;
    entityType: string;
    entityId?: string;
    actorType: AuditActorType;
    actorId?: string;
    actorName?: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
    try {
        await DatabaseService.query(
            `INSERT INTO audit_logs (
                tenant_id, action, entity_type, entity_id,
                actor_type, actor_id, actor_name,
                old_values, new_values,
                ip_address, user_agent
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
                input.tenantId,
                input.action,
                input.entityType,
                input.entityId ?? null,
                input.actorType,
                input.actorId ?? null,
                input.actorName ?? null,
                input.oldValues ?? null,
                input.newValues ?? null,
                input.ipAddress ?? null,
                input.userAgent ?? null,
            ],
            input.tenantId
        );
    } catch (error) {
        logger.warn('Failed to write audit log', {
            tenantId: input.tenantId,
            action: input.action,
            entityType: input.entityType,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export function getRequestMeta(req: Request): { ipAddress?: string; userAgent?: string } {
    const userAgent = typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : undefined;
    const ipAddress = req.ip || undefined;

    return { ipAddress, userAgent };
}
