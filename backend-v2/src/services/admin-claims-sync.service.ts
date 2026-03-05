import type { PoolClient } from 'pg';
import { DatabaseService } from '../config/database.js';
import { AuthorizationError } from '../utils/errors.js';

const ADMIN_UID_SCOPE_GUC = 'app.current_firebase_uid';

async function setAdminUidScope(client: PoolClient, firebaseUid: string): Promise<void> {
    await client.query(`SELECT set_config('${ADMIN_UID_SCOPE_GUC}', $1, true)`, [firebaseUid]);
}

export async function resolveTenantIdForClaimsSync(firebaseUid: string): Promise<string> {
    const tenantId = await DatabaseService.transaction<string | null>(async (client) => {
        await setAdminUidScope(client, firebaseUid);

        const result = await client.query<{ tenant_id: string }>(
            `SELECT tenant_id
             FROM admins
             WHERE firebase_uid = $1
               AND is_active = true
             LIMIT 1`,
            [firebaseUid]
        );

        return result.rows[0]?.tenant_id ?? null;
    });

    if (!tenantId) {
        throw new AuthorizationError('管理者として登録されていません');
    }

    return tenantId;
}
