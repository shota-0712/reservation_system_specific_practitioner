import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
const transactionMock = vi.fn();

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        query: queryMock,
        queryOne: queryOneMock,
        transaction: transactionMock,
    },
}));

let MenuRepository: typeof import('../../src/repositories/menu.repository.js').MenuRepository;
let OptionRepository: typeof import('../../src/repositories/option.repository.js').OptionRepository;
let PractitionerRepository: typeof import('../../src/repositories/practitioner.repository.js').PractitionerRepository;

function missingTableError(table: string) {
    return {
        code: '42P01',
        message: `relation "${table}" does not exist`,
    };
}

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

function makePractitionerRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'practitioner-1',
        tenant_id: 'tenant-1',
        name: 'Satou Mirai',
        role: 'stylist',
        is_active: true,
        display_order: 0,
        created_at: new Date('2026-03-17T00:00:00.000Z'),
        updated_at: new Date('2026-03-17T00:00:00.000Z'),
        ...overrides,
    };
}

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ MenuRepository } = await import('../../src/repositories/menu.repository.js'));
    ({ OptionRepository } = await import('../../src/repositories/option.repository.js'));
    ({ PractitionerRepository } = await import('../../src/repositories/practitioner.repository.js'));
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('assignment-table schema enforcement', () => {
    it('MenuRepository.findByPractitionerId fails fast when menu_practitioner_assignments is missing', async () => {
        queryMock.mockRejectedValueOnce(missingTableError('menu_practitioner_assignments'));

        const repository = new MenuRepository('tenant-1');

        await expect(repository.findByPractitionerId('practitioner-1')).rejects.toMatchObject({ code: '42P01' });
        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(String(queryMock.mock.calls[0]?.[0] ?? '')).toContain('FROM menu_practitioner_assignments');
        expect(
            queryMock.mock.calls.some((args: unknown[]) =>
                typeof args[0] === 'string' && args[0].includes('cardinality(practitioner_ids)')
            )
        ).toBe(false);
    });

    it('OptionRepository.findByMenuId fails fast when option_menu_assignments is missing', async () => {
        queryMock.mockRejectedValueOnce(missingTableError('option_menu_assignments'));

        const repository = new OptionRepository('tenant-1');

        await expect(repository.findByMenuId('menu-1')).rejects.toMatchObject({ code: '42P01' });
        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(String(queryMock.mock.calls[0]?.[0] ?? '')).toContain('FROM option_menu_assignments');
        expect(
            queryMock.mock.calls.some((args: unknown[]) =>
                typeof args[0] === 'string' && args[0].includes('applicable_menu_ids')
            )
        ).toBe(false);
    });

    it('PractitionerRepository.findByMenuId fails fast when menu_practitioner_assignments is missing', async () => {
        queryMock.mockRejectedValueOnce(missingTableError('menu_practitioner_assignments'));

        const repository = new PractitionerRepository('tenant-1');

        await expect(repository.findByMenuId('menu-1')).rejects.toMatchObject({ code: '42P01' });
        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(queryOneMock).not.toHaveBeenCalled();
        expect(String(queryMock.mock.calls[0]?.[0] ?? '')).toContain('FROM menu_practitioner_assignments');
    });

    it('MenuRepository.createMenu propagates missing assignment-table errors instead of silently succeeding', async () => {
        queryOneMock.mockResolvedValueOnce(makeMenuRow());
        transactionMock.mockRejectedValueOnce(missingTableError('menu_practitioner_assignments'));

        const repository = new MenuRepository('tenant-1');

        await expect(repository.createMenu({
            name: 'Cut',
            category: 'cut',
            availablePractitionerIds: ['practitioner-1'],
        })).rejects.toMatchObject({ code: '42P01' });

        expect(queryOneMock).toHaveBeenCalledTimes(1);
        expect(transactionMock).toHaveBeenCalledTimes(1);
    });

    it('OptionRepository.create propagates missing assignment-table errors instead of silently succeeding', async () => {
        queryOneMock.mockResolvedValueOnce(makeOptionRow());
        transactionMock.mockRejectedValueOnce(missingTableError('option_menu_assignments'));

        const repository = new OptionRepository('tenant-1');

        await expect(repository.create({
            name: 'Shampoo',
            applicableMenuIds: ['menu-1'],
        })).rejects.toMatchObject({ code: '42P01' });

        expect(queryOneMock).toHaveBeenCalledTimes(1);
        expect(transactionMock).toHaveBeenCalledTimes(1);
    });

    it('PractitionerRepository.createPractitioner propagates missing practitioner_store_assignments errors', async () => {
        queryOneMock.mockResolvedValueOnce(makePractitionerRow());
        transactionMock.mockRejectedValueOnce(missingTableError('practitioner_store_assignments'));

        const repository = new PractitionerRepository('tenant-1');

        await expect(repository.createPractitioner({
            name: 'Satou Mirai',
            storeIds: ['store-1'],
        })).rejects.toMatchObject({ code: '42P01' });

        expect(queryOneMock).toHaveBeenCalledTimes(1);
        expect(transactionMock).toHaveBeenCalledTimes(1);
    });

    it('PractitionerRepository.createPractitioner propagates missing menu_practitioner_assignments errors', async () => {
        queryOneMock.mockResolvedValueOnce(makePractitionerRow());
        transactionMock
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(missingTableError('menu_practitioner_assignments'));

        const repository = new PractitionerRepository('tenant-1');

        await expect(repository.createPractitioner({
            name: 'Satou Mirai',
            storeIds: ['store-1'],
            availableMenuIds: ['menu-1'],
        })).rejects.toMatchObject({ code: '42P01' });

        expect(queryOneMock).toHaveBeenCalledTimes(1);
        expect(transactionMock).toHaveBeenCalledTimes(2);
    });
});
