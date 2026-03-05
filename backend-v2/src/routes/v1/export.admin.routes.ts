import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
    asyncHandler,
    validateBody,
    validateParams,
    validateQuery,
    idParamSchema,
} from '../../middleware/index.js';
import { requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createExportJobService, type ExportType } from '../../services/export-job.service.js';
import type { ApiResponse } from '../../types/index.js';

const router = Router();

const exportTypeSchema = z.enum([
    'operations_reservations',
    'operations_customers',
    'analytics_store_daily_kpi',
    'analytics_menu_performance',
]);

const createExportSchema = z.object({
    storeId: z.string().uuid().optional(),
    exportType: exportTypeSchema,
    format: z.literal('csv').optional().default('csv'),
    params: z.record(z.unknown()).optional().default({}),
});

const listExportsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});

interface ExportJobResponse {
    id: string;
    tenantId: string;
    storeId?: string;
    exportType: ExportType;
    format: 'csv';
    params: Record<string, unknown>;
    status: 'queued' | 'running' | 'completed' | 'failed';
    requestedBy?: string;
    rowCount?: number;
    errorMessage?: string;
    requestedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

router.post(
    '/',
    requirePermission('canViewReports'),
    validateBody(createExportSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createExportJobService(tenantId);
        const body = req.body as z.infer<typeof createExportSchema>;

        const requestedBy = (req as { user?: { uid?: string } }).user?.uid;
        const job = await service.create({
            storeId: body.storeId,
            exportType: body.exportType,
            format: body.format,
            params: body.params,
            requestedBy,
        });

        const response: ApiResponse<ExportJobResponse> = {
            success: true,
            data: job,
        };
        res
            .status(202)
            .setHeader('Location', `/api/v1/admin/exports/${job.id}`)
            .json(response);
    })
);

router.get(
    '/',
    requirePermission('canViewReports'),
    validateQuery(listExportsQuerySchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createExportJobService(tenantId);
        const query = req.query as unknown as { page?: number; limit?: number };
        const { jobs, total, page, limit } = await service.listWithTotal({
            page: query.page,
            limit: query.limit,
        });

        const response: ApiResponse<ExportJobResponse[]> = {
            success: true,
            data: jobs,
            meta: {
                page,
                limit,
                total,
                hasMore: page * limit < total,
            },
        };
        res.json(response);
    })
);

router.get(
    '/:id',
    requirePermission('canViewReports'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createExportJobService(tenantId);
        const id = req.params.id as string;
        const job = await service.findByIdOrFail(id);

        const response: ApiResponse<ExportJobResponse> = {
            success: true,
            data: job,
        };
        res.json(response);
    })
);

router.get(
    '/:id/download',
    requirePermission('canViewReports'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const service = createExportJobService(tenantId);
        const id = req.params.id as string;

        const payload = await service.getDownload(id);

        if (payload.redirectUrl) {
            res.redirect(302, payload.redirectUrl);
            return;
        }

        res.setHeader('Content-Type', payload.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
        res.status(200).send(payload.content ?? '');
    })
);

export const exportAdminRoutes = router;
