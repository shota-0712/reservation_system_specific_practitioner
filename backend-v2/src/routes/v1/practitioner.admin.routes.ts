import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody, validateParams, idParamSchema, timeSchema } from '../../middleware/index.js';
import { requireFirebaseAuth, requirePermission } from '../../middleware/auth.js';
import { getTenantId } from '../../middleware/tenant.js';
import { createPractitionerRepository } from '../../repositories/index.js';
import { getRequestMeta, writeAuditLog } from '../../services/audit-log.service.js';
import type { ApiResponse, Practitioner } from '../../types/index.js';

const router = Router();

const scheduleSchema = z.object({
    workDays: z.array(z.number().int().min(0).max(6)),
    workHours: z.object({
        start: timeSchema,
        end: timeSchema,
    }),
    breakTime: z.object({
        start: timeSchema,
        end: timeSchema,
    }).optional(),
});

const createPractitionerSchema = z.object({
    name: z.string().min(1, '名前は必須です').max(50),
    nameKana: z.string().max(50).optional(),
    role: z.enum(['stylist', 'assistant', 'owner']),
    phone: z.string().regex(/^0[0-9]{9,10}$/, '電話番号の形式が正しくありません').optional(),
    email: z.string().email('メールアドレスの形式が正しくありません').optional(),
    title: z.string().max(50).optional(),
    imageUrl: z.string().url().optional(),
    description: z.string().max(1000).optional(),
    experience: z.string().max(50).optional(),
    prTitle: z.string().max(200).optional(),
    specialties: z.array(z.string()).optional(),
    snsInstagram: z.string().max(100).optional(),
    snsTwitter: z.string().max(100).optional(),
    nominationFee: z.number().int().min(0).optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'カラーコードの形式が正しくありません').default('#3b82f6'),
    schedule: scheduleSchema,
    availableMenuIds: z.array(z.string()).optional(),
    storeIds: z.array(z.string()).optional(),
    calendarId: z.string().optional(),
    salonboardStaffId: z.string().optional(),
    isActive: z.boolean().default(true),
    displayOrder: z.number().int().min(0).optional(),
});

const updatePractitionerSchema = createPractitionerSchema.partial();

const reorderPractitionersSchema = z.object({
    orders: z.array(z.object({
        id: z.string(),
        displayOrder: z.number().int().min(0),
    })),
});

router.get(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManagePractitioners'),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createPractitionerRepository(tenantId);
        const practitioners = await repo.findAll();

        const response: ApiResponse<Practitioner[]> = { success: true, data: practitioners };
        res.json(response);
    })
);

router.post(
    '/',
    requireFirebaseAuth(),
    requirePermission('canManagePractitioners'),
    validateBody(createPractitionerSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createPractitionerRepository(tenantId);
        const practitioner = await repo.createPractitioner(req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'CREATE',
            entityType: 'practitioner',
            entityId: practitioner.id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            newValues: practitioner as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Practitioner> = { success: true, data: practitioner };
        res.status(201).json(response);
    })
);

router.put(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManagePractitioners'),
    validateParams(idParamSchema),
    validateBody(updatePractitionerSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createPractitionerRepository(tenantId);
        const id = req.params.id as string;

        const before = await repo.findByIdOrFail(id);
        const practitioner = await repo.updatePractitioner(id, req.body);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'UPDATE',
            entityType: 'practitioner',
            entityId: id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: before as unknown as Record<string, unknown>,
            newValues: practitioner as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse<Practitioner> = { success: true, data: practitioner };
        res.json(response);
    })
);

router.delete(
    '/:id',
    requireFirebaseAuth(),
    requirePermission('canManagePractitioners'),
    validateParams(idParamSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createPractitionerRepository(tenantId);
        const id = req.params.id as string;

        const before = await repo.findByIdOrFail(id);
        await repo.softDelete(id);

        const meta = getRequestMeta(req);
        await writeAuditLog({
            tenantId,
            action: 'DELETE',
            entityType: 'practitioner',
            entityId: id,
            actorType: 'admin',
            actorId: (req as any).user?.uid,
            actorName: (req as any).user?.name,
            oldValues: before as unknown as Record<string, unknown>,
            ...meta,
        });

        const response: ApiResponse = { success: true };
        res.json(response);
    })
);

router.post(
    '/reorder',
    requireFirebaseAuth(),
    requirePermission('canManagePractitioners'),
    validateBody(reorderPractitionersSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const tenantId = getTenantId(req);
        const repo = createPractitionerRepository(tenantId);
        await repo.updateDisplayOrders(req.body.orders);

        const response: ApiResponse = { success: true };
        res.json(response);
    })
);

export const practitionerAdminRoutes = router;
