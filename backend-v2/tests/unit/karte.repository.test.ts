import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let KarteRepository: typeof import('../../src/repositories/karte.repository.js').KarteRepository;
let KarteTemplateRepository: typeof import('../../src/repositories/karte.repository.js').KarteTemplateRepository;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;
let NotFoundError: typeof import('../../src/utils/errors.js').NotFoundError;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    const repositoryModule = await import('../../src/repositories/karte.repository.js');
    ({ DatabaseService } = await import('../../src/config/database.js'));
    ({ NotFoundError } = await import('../../src/utils/errors.js'));

    KarteRepository = repositoryModule.KarteRepository;
    KarteTemplateRepository = repositoryModule.KarteTemplateRepository;
});

afterEach(() => {
    vi.restoreAllMocks();
});

function makeKarteRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'karte-1',
        tenant_id: 'tenant-1',
        customer_id: 'customer-1',
        reservation_id: 'reservation-1',
        store_id: 'store-1',
        practitioner_id: 'practitioner-1',
        customer_name: '山田 花子',
        customer_picture_url: 'https://example.com/photo.jpg',
        visit_date: new Date('2026-03-17T00:00:00.000Z'),
        menu_ids: ['menu-1'],
        menu_names: ['Cut'],
        option_ids: ['option-1'],
        duration: 90,
        total_amount: 12000,
        treatment_description: 'cut and color',
        color_formula: 'A-7 / 6%',
        products_used: ['shampoo'],
        customer_request: 'short',
        conversation_memo: 'memo',
        next_visit_note: 'next',
        custom_fields: { note: 'value' },
        photos_before: ['before-1'],
        photos_after: ['after-1'],
        photos_other: [{ url: 'https://example.com/other.jpg' }],
        status: 'draft',
        tags: ['vip'],
        created_at: new Date('2026-03-17T01:00:00.000Z'),
        updated_at: new Date('2026-03-17T02:00:00.000Z'),
        ...overrides,
    };
}

function makeTemplateRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'template-1',
        tenant_id: 'tenant-1',
        name: 'Standard Karte',
        description: 'Base template',
        is_default: true,
        fields: [{ key: 'memo' }],
        applicable_menu_categories: ['cut'],
        is_active: true,
        display_order: 2,
        created_at: new Date('2026-03-17T01:00:00.000Z'),
        updated_at: new Date('2026-03-17T02:00:00.000Z'),
        ...overrides,
    };
}

describe('KarteRepository', () => {
    it('maps list rows and forwards limit', async () => {
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValueOnce([makeKarteRow()] as any);

        const repository = new KarteRepository('tenant-1');
        const result = await repository.findAll(25);

        expect(result).toEqual([
            expect.objectContaining({
                id: 'karte-1',
                tenantId: 'tenant-1',
                customerId: 'customer-1',
                visitDate: '2026-03-17',
                tags: ['vip'],
            }),
        ]);
        expect(querySpy).toHaveBeenCalledWith(
            expect.stringContaining('FROM kartes'),
            ['tenant-1', 25],
            'tenant-1'
        );
    });

    it('creates kartes with tenant-scoped insert payload', async () => {
        const querySpy = vi.spyOn(DatabaseService, 'queryOne').mockImplementation(async (_sql, params) => {
            expect(params).toEqual([
                'tenant-1',
                'customer-1',
                'reservation-1',
                'store-1',
                'practitioner-1',
                null,
                null,
                '2026-03-17',
                ['menu-1'],
                ['Cut'],
                ['option-1'],
                null,
                null,
                null,
                null,
                [],
                null,
                null,
                null,
                {},
                [],
                [],
                [],
                'completed',
                ['vip'],
                'practitioner-1',
            ]);
            return makeKarteRow() as any;
        });

        const repository = new KarteRepository('tenant-1');
        const created = await repository.create({
            customerId: 'customer-1',
            practitionerId: 'practitioner-1',
            visitDate: '2026-03-17',
            reservationId: 'reservation-1',
            storeId: 'store-1',
            menuIds: ['menu-1'],
            menuNames: ['Cut'],
            optionIds: ['option-1'],
            status: 'completed',
            tags: ['vip'],
        });

        expect(created.status).toBe('draft');
        expect(querySpy).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO kartes'), expect.any(Array), 'tenant-1');
    });

    it('updates kartes and throws not found for missing rows', async () => {
        const querySpy = vi.spyOn(DatabaseService, 'queryOne');
        querySpy.mockResolvedValueOnce(null);

        const repository = new KarteRepository('tenant-1');
        await expect(repository.findByIdOrFail('missing')).rejects.toBeInstanceOf(NotFoundError);

        querySpy.mockResolvedValueOnce(makeKarteRow({ status: 'completed' }) as any);
        const updated = await repository.update('karte-1', { status: 'completed', tags: ['new'] });

        expect(updated.status).toBe('completed');
        expect(querySpy).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE kartes SET'), expect.any(Array), 'tenant-1');
        expect(querySpy.mock.calls[1]?.[1]).toEqual([
            'tenant-1',
            'karte-1',
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            'completed',
            ['new'],
        ]);
    });
});

describe('KarteTemplateRepository', () => {
    it('filters inactive templates when requested', async () => {
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValueOnce([makeTemplateRow()] as any);

        const repository = new KarteTemplateRepository('tenant-1');
        const result = await repository.findAll(false);

        expect(result[0]?.isDefault).toBe(true);
        expect(querySpy).toHaveBeenCalledWith(
            expect.stringContaining('AND is_active = true'),
            ['tenant-1'],
            'tenant-1'
        );
    });

    it('creates and updates templates with defaulted fields', async () => {
        const queryOneSpy = vi.spyOn(DatabaseService, 'queryOne')
            .mockResolvedValueOnce(makeTemplateRow() as any)
            .mockResolvedValueOnce(makeTemplateRow({ name: 'Updated Template', is_default: false }) as any);

        const repository = new KarteTemplateRepository('tenant-1');
        const created = await repository.create({
            name: 'Standard Karte',
            fields: [{ key: 'memo' }],
        });

        const updated = await repository.update('template-1', {
            name: 'Updated Template',
            displayOrder: 4,
        });

        expect(created.isDefault).toBe(true);
        expect(updated.name).toBe('Updated Template');
        expect(queryOneSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO karte_templates'), expect.any(Array), 'tenant-1');
        expect(queryOneSpy.mock.calls[0]?.[1]).toEqual([
            'tenant-1',
            'Standard Karte',
            null,
            false,
            [{ key: 'memo' }],
            [],
            true,
            0,
        ]);
        expect(queryOneSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE karte_templates SET'), expect.any(Array), 'tenant-1');
        expect(queryOneSpy.mock.calls[1]?.[1]).toEqual([
            'tenant-1',
            'template-1',
            'Updated Template',
            null,
            null,
            null,
            null,
            null,
            4,
        ]);
    });
});
