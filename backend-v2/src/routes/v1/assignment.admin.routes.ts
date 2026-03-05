import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
    asyncHandler,
    validateBody,
    validateParams,
    idParamSchema,
} from '../../middleware/index.js';
import { requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import {
    createPractitionerRepository,
    createMenuRepository,
    createOptionRepository,
} from '../../repositories/index.js';
import { DatabaseService } from '../../config/database.js';
import { NotFoundError } from '../../utils/errors.js';
import type { ApiResponse } from '../../types/index.js';

const router = Router();

const idArraySchema = z.object({
    ids: z.array(z.string().uuid()).default([]),
});

async function replaceAssignments(params: {
    tenantId: string;
    table: 'practitioner_store_assignments' | 'menu_practitioner_assignments' | 'option_menu_assignments' | 'admin_store_assignments';
    leftColumn: 'practitioner_id' | 'menu_id' | 'option_id' | 'admin_id';
    rightColumn: 'store_id' | 'practitioner_id' | 'menu_id';
    leftId: string;
    rightIds: string[];
}): Promise<void> {
    const { tenantId, table, leftColumn, rightColumn, leftId, rightIds } = params;
    const dedupedRightIds = Array.from(new Set(rightIds));
    await DatabaseService.transaction(async (client) => {
        await client.query(
            `DELETE FROM ${table}
             WHERE tenant_id = $1
               AND ${leftColumn} = $2`,
            [tenantId, leftId]
        );

        if (dedupedRightIds.length === 0) {
            return;
        }

        await client.query(
            `INSERT INTO ${table} (tenant_id, ${leftColumn}, ${rightColumn})
             SELECT $1::uuid, $2::uuid, v.id
             FROM unnest($3::uuid[]) AS v(id)
             ON CONFLICT DO NOTHING`,
            [tenantId, leftId, dedupedRightIds]
        );
    }, tenantId);
}

async function assertAdminExists(tenantId: string, adminId: string): Promise<void> {
    const row = await DatabaseService.queryOne<{ id: string }>(
        `SELECT id
         FROM admins
         WHERE tenant_id = $1
           AND id = $2`,
        [tenantId, adminId],
        tenantId
    );
    if (!row) {
        throw new NotFoundError('管理者', adminId);
    }
}

router.get(
    '/practitioners/:id/stores',
    requirePermission('canManagePractitioners'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const practitionerId = req.params.id as string;
        await createPractitionerRepository(tenantId).findByIdOrFail(practitionerId);

        const rows = await DatabaseService.query<{ store_id: string }>(
            `SELECT store_id
             FROM practitioner_store_assignments
             WHERE tenant_id = $1 AND practitioner_id = $2
             ORDER BY store_id`,
            [tenantId, practitionerId],
            tenantId
        );

        const response: ApiResponse<{ practitionerId: string; storeIds: string[] }> = {
            success: true,
            data: {
                practitionerId,
                storeIds: rows.map((r) => r.store_id),
            },
        };
        res.json(response);
    })
);

router.put(
    '/practitioners/:id/stores',
    requirePermission('canManagePractitioners'),
    validateParams(idParamSchema),
    validateBody(idArraySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const practitionerId = req.params.id as string;
        const { ids } = req.body as z.infer<typeof idArraySchema>;

        await createPractitionerRepository(tenantId).findByIdOrFail(practitionerId);

        await replaceAssignments({
            tenantId,
            table: 'practitioner_store_assignments',
            leftColumn: 'practitioner_id',
            rightColumn: 'store_id',
            leftId: practitionerId,
            rightIds: ids,
        });

        // Legacy compatibility
        await DatabaseService.query(
            `UPDATE practitioners
             SET store_ids = $3::uuid[], updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, practitionerId, ids],
            tenantId
        );

        const response: ApiResponse<{ practitionerId: string; storeIds: string[] }> = {
            success: true,
            data: { practitionerId, storeIds: ids },
        };
        res.json(response);
    })
);

router.get(
    '/menus/:id/practitioners',
    requirePermission('canManageMenus'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const menuId = req.params.id as string;
        await createMenuRepository(tenantId).findByIdOrFail(menuId);

        const rows = await DatabaseService.query<{ practitioner_id: string }>(
            `SELECT practitioner_id
             FROM menu_practitioner_assignments
             WHERE tenant_id = $1 AND menu_id = $2
             ORDER BY practitioner_id`,
            [tenantId, menuId],
            tenantId
        );

        const response: ApiResponse<{ menuId: string; practitionerIds: string[] }> = {
            success: true,
            data: {
                menuId,
                practitionerIds: rows.map((r) => r.practitioner_id),
            },
        };
        res.json(response);
    })
);

router.put(
    '/menus/:id/practitioners',
    requirePermission('canManageMenus'),
    validateParams(idParamSchema),
    validateBody(idArraySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const menuId = req.params.id as string;
        const { ids } = req.body as z.infer<typeof idArraySchema>;
        await createMenuRepository(tenantId).findByIdOrFail(menuId);

        await replaceAssignments({
            tenantId,
            table: 'menu_practitioner_assignments',
            leftColumn: 'menu_id',
            rightColumn: 'practitioner_id',
            leftId: menuId,
            rightIds: ids,
        });

        // Legacy compatibility
        await DatabaseService.query(
            `UPDATE menus
             SET practitioner_ids = $3::uuid[], updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, menuId, ids],
            tenantId
        );

        const response: ApiResponse<{ menuId: string; practitionerIds: string[] }> = {
            success: true,
            data: { menuId, practitionerIds: ids },
        };
        res.json(response);
    })
);

router.get(
    '/options/:id/menus',
    requirePermission('canManageMenus'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const optionId = req.params.id as string;
        await createOptionRepository(tenantId).findByIdOrFail(optionId);

        const rows = await DatabaseService.query<{ menu_id: string }>(
            `SELECT menu_id
             FROM option_menu_assignments
             WHERE tenant_id = $1 AND option_id = $2
             ORDER BY menu_id`,
            [tenantId, optionId],
            tenantId
        );

        const response: ApiResponse<{ optionId: string; menuIds: string[] }> = {
            success: true,
            data: {
                optionId,
                menuIds: rows.map((r) => r.menu_id),
            },
        };
        res.json(response);
    })
);

router.put(
    '/options/:id/menus',
    requirePermission('canManageMenus'),
    validateParams(idParamSchema),
    validateBody(idArraySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const optionId = req.params.id as string;
        const { ids } = req.body as z.infer<typeof idArraySchema>;
        await createOptionRepository(tenantId).findByIdOrFail(optionId);

        await replaceAssignments({
            tenantId,
            table: 'option_menu_assignments',
            leftColumn: 'option_id',
            rightColumn: 'menu_id',
            leftId: optionId,
            rightIds: ids,
        });

        // Legacy compatibility
        await DatabaseService.query(
            `UPDATE menu_options
             SET applicable_menu_ids = $3::uuid[], updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, optionId, ids],
            tenantId
        );

        const response: ApiResponse<{ optionId: string; menuIds: string[] }> = {
            success: true,
            data: { optionId, menuIds: ids },
        };
        res.json(response);
    })
);

router.get(
    '/admins/:id/stores',
    requirePermission('canManageSettings'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const adminId = req.params.id as string;
        await assertAdminExists(tenantId, adminId);

        const rows = await DatabaseService.query<{ store_id: string }>(
            `SELECT store_id
             FROM admin_store_assignments
             WHERE tenant_id = $1 AND admin_id = $2
             ORDER BY store_id`,
            [tenantId, adminId],
            tenantId
        );

        const response: ApiResponse<{ adminId: string; storeIds: string[] }> = {
            success: true,
            data: {
                adminId,
                storeIds: rows.map((r) => r.store_id),
            },
        };
        res.json(response);
    })
);

router.put(
    '/admins/:id/stores',
    requirePermission('canManageSettings'),
    validateParams(idParamSchema),
    validateBody(idArraySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const adminId = req.params.id as string;
        const { ids } = req.body as z.infer<typeof idArraySchema>;
        await assertAdminExists(tenantId, adminId);

        await replaceAssignments({
            tenantId,
            table: 'admin_store_assignments',
            leftColumn: 'admin_id',
            rightColumn: 'store_id',
            leftId: adminId,
            rightIds: ids,
        });

        // Legacy compatibility
        await DatabaseService.query(
            `UPDATE admins
             SET store_ids = $3::uuid[], updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, adminId, ids],
            tenantId
        );

        const response: ApiResponse<{ adminId: string; storeIds: string[] }> = {
            success: true,
            data: { adminId, storeIds: ids },
        };
        res.json(response);
    })
);

export const assignmentAdminRoutes = router;
