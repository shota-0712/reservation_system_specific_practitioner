import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        query: queryMock,
        queryOne: vi.fn(),
        transaction: vi.fn(),
    },
}));

let MenuRepository: typeof import('../../src/repositories/menu.repository.js').MenuRepository;
let OptionRepository: typeof import('../../src/repositories/option.repository.js').OptionRepository;
let NotFoundError: typeof import('../../src/utils/errors.js').NotFoundError;

function makeMenuRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'menu-1',
        tenant_id: 'tenant-1',
        name: 'Cut',
        description: null,
        category: 'cut',
        duration: 60,
        price: 5500,
        image_url: null,
        display_order: 0,
        is_active: true,
        created_at: new Date('2026-03-17T00:00:00.000Z'),
        updated_at: new Date('2026-03-17T00:00:00.000Z'),
        ...overrides,
    };
}

function makeOptionRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'option-1',
        tenant_id: 'tenant-1',
        name: 'Shampoo',
        description: null,
        duration: 10,
        price: 1100,
        display_order: 0,
        is_active: true,
        created_at: new Date('2026-03-17T00:00:00.000Z'),
        updated_at: new Date('2026-03-17T00:00:00.000Z'),
        ...overrides,
    };
}

beforeAll(async () => {
    ({ MenuRepository } = await import('../../src/repositories/menu.repository.js'));
    ({ OptionRepository } = await import('../../src/repositories/option.repository.js'));
    ({ NotFoundError } = await import('../../src/utils/errors.js'));
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('bulk menu/option fetch repositories', () => {
    it('loads menus with a constant number of queries and preserves input order', async () => {
        queryMock
            .mockResolvedValueOnce([
                makeMenuRow({ id: 'menu-1', name: 'Cut' }),
                makeMenuRow({ id: 'menu-2', name: 'Color', duration: 90, price: 8800 }),
            ])
            .mockResolvedValueOnce([
                { menu_id: 'menu-1', practitioner_ids: ['practitioner-1'] },
                { menu_id: 'menu-2', practitioner_ids: ['practitioner-2', 'practitioner-3'] },
            ]);

        const repository = new MenuRepository('tenant-1');
        const menus = await repository.findByIdsOrFail(['menu-2', 'menu-1', 'menu-2']);

        expect(queryMock).toHaveBeenCalledTimes(2);
        expect(queryMock).toHaveBeenNthCalledWith(
            1,
            'SELECT * FROM menus WHERE tenant_id = $1 AND id = ANY($2)',
            ['tenant-1', ['menu-2', 'menu-1']],
            'tenant-1'
        );
        expect(queryMock).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('FROM menu_practitioner_assignments'),
            ['tenant-1', ['menu-1', 'menu-2']],
            'tenant-1'
        );
        expect(menus.map((menu) => menu.id)).toEqual(['menu-2', 'menu-1', 'menu-2']);
        expect(menus[0]?.availablePractitionerIds).toEqual(['practitioner-2', 'practitioner-3']);
        expect(menus[1]?.availablePractitionerIds).toEqual(['practitioner-1']);
    });

    it('throws the same not found error when a requested menu is missing', async () => {
        queryMock
            .mockResolvedValueOnce([makeMenuRow({ id: 'menu-1' })])
            .mockResolvedValueOnce([{ menu_id: 'menu-1', practitioner_ids: ['practitioner-1'] }]);

        const repository = new MenuRepository('tenant-1');
        const pending = repository.findByIdsOrFail(['menu-1', 'missing-menu']);

        await expect(pending).rejects.toBeInstanceOf(NotFoundError);
        await expect(pending).rejects.toMatchObject({
            details: {
                resource: 'メニュー',
                id: 'missing-menu',
            },
        });
    });

    it('loads options with a constant number of queries and preserves input order', async () => {
        queryMock
            .mockResolvedValueOnce([
                makeOptionRow({ id: 'option-1', name: 'Shampoo' }),
                makeOptionRow({ id: 'option-2', name: 'Spa', duration: 20, price: 2200 }),
            ])
            .mockResolvedValueOnce([
                { option_id: 'option-1', menu_ids: ['menu-1'] },
                { option_id: 'option-2', menu_ids: ['menu-1', 'menu-2'] },
            ]);

        const repository = new OptionRepository('tenant-1');
        const options = await repository.findByIdsOrFail(['option-2', 'option-1', 'option-2']);

        expect(queryMock).toHaveBeenCalledTimes(2);
        expect(queryMock).toHaveBeenNthCalledWith(
            1,
            'SELECT * FROM menu_options WHERE tenant_id = $1 AND id = ANY($2)',
            ['tenant-1', ['option-2', 'option-1']],
            'tenant-1'
        );
        expect(queryMock).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('FROM option_menu_assignments'),
            ['tenant-1', ['option-1', 'option-2']],
            'tenant-1'
        );
        expect(options.map((option) => option.id)).toEqual(['option-2', 'option-1', 'option-2']);
        expect(options[0]?.applicableMenuIds).toEqual(['menu-1', 'menu-2']);
        expect(options[1]?.applicableMenuIds).toEqual(['menu-1']);
    });
});
