import { describe, expect, it } from 'vitest';
import { resolveLineConfigForTenant } from '../../src/services/line-config.service.js';
import type { Practitioner, Store, Tenant } from '../../src/types/index.js';

function createTenant(lineConfig?: Tenant['lineConfig']): Tenant {
    const now = new Date();
    return {
        id: 'tenant-1',
        slug: 'default',
        name: 'Default Tenant',
        plan: 'trial',
        status: 'active',
        lineConfig,
        createdAt: now,
        updatedAt: now,
    };
}

function createStore(lineConfig?: Store['lineConfig']): Store {
    const now = new Date();
    return {
        id: 'store-1',
        tenantId: 'tenant-1',
        storeCode: 'default000',
        name: 'Main Store',
        lineConfig,
        createdAt: now,
        updatedAt: now,
    };
}

function createPractitioner(lineConfig?: Practitioner['lineConfig']): Practitioner {
    const now = new Date();
    return {
        id: '9f7dbab5-f815-4b8e-a00b-552b62993c62',
        tenantId: 'tenant-1',
        name: '担当者',
        role: 'stylist',
        color: '#3b82f6',
        schedule: {
            workDays: [1, 2, 3, 4, 5],
            workHours: {
                start: '10:00',
                end: '19:00',
            },
        },
        displayOrder: 0,
        isActive: true,
        lineConfig,
        createdAt: now,
        updatedAt: now,
    };
}

describe('resolveLineConfigForTenant', () => {
    it('returns tenant config in tenant mode', () => {
        const tenant = createTenant({
            mode: 'tenant',
            liffId: 'tenant-liff',
            channelId: 'tenant-channel',
        });

        const resolved = resolveLineConfigForTenant(tenant, null, null);

        expect(resolved.mode).toBe('tenant');
        expect(resolved.source).toBe('tenant');
        expect(resolved.lineConfig.liffId).toBe('tenant-liff');
        expect(resolved.lineConfig.channelId).toBe('tenant-channel');
    });

    it('returns store config in store mode', () => {
        const tenant = createTenant({
            mode: 'store',
            liffId: 'tenant-liff',
            channelId: 'tenant-channel',
        });
        const store = createStore({
            liffId: 'store-liff',
            channelId: 'store-channel',
        });

        const resolved = resolveLineConfigForTenant(tenant, store, null);

        expect(resolved.mode).toBe('store');
        expect(resolved.source).toBe('store');
        expect(resolved.storeId).toBe(store.id);
        expect(resolved.lineConfig.liffId).toBe('store-liff');
        expect(resolved.lineConfig.channelId).toBe('store-channel');
    });

    it('falls back to tenant config in store mode when store config is empty', () => {
        const tenant = createTenant({
            mode: 'store',
            liffId: 'tenant-liff',
            channelId: 'tenant-channel',
        });
        const store = createStore();

        const resolved = resolveLineConfigForTenant(tenant, store, null);

        expect(resolved.mode).toBe('store');
        expect(resolved.source).toBe('tenant');
        expect(resolved.lineConfig.liffId).toBe('tenant-liff');
        expect(resolved.lineConfig.channelId).toBe('tenant-channel');
    });

    it('returns practitioner config in practitioner mode', () => {
        const tenant = createTenant({
            mode: 'practitioner',
            liffId: 'tenant-liff',
            channelId: 'tenant-channel',
        });
        const store = createStore({
            liffId: 'store-liff',
            channelId: 'store-channel',
        });
        const practitioner = createPractitioner({
            liffId: 'practitioner-liff',
            channelId: 'practitioner-channel',
        });

        const resolved = resolveLineConfigForTenant(tenant, store, practitioner);

        expect(resolved.mode).toBe('practitioner');
        expect(resolved.source).toBe('practitioner');
        expect(resolved.practitionerId).toBe(practitioner.id);
        expect(resolved.storeId).toBe(store.id);
        expect(resolved.lineConfig.liffId).toBe('practitioner-liff');
        expect(resolved.lineConfig.channelId).toBe('practitioner-channel');
    });

    it('falls back in practitioner mode from practitioner -> store -> tenant', () => {
        const tenant = createTenant({
            mode: 'practitioner',
            liffId: 'tenant-liff',
            channelId: 'tenant-channel',
        });
        const store = createStore({
            liffId: 'store-liff',
            channelId: 'store-channel',
        });
        const practitioner = createPractitioner({
            liffId: undefined,
            channelId: undefined,
            channelSecret: 'secret-only',
        });

        const resolved = resolveLineConfigForTenant(tenant, store, practitioner);

        expect(resolved.mode).toBe('practitioner');
        expect(resolved.source).toBe('practitioner');
        expect(resolved.lineConfig.liffId).toBe('store-liff');
        expect(resolved.lineConfig.channelId).toBe('store-channel');
        expect(resolved.lineConfig.channelSecret).toBe('secret-only');
    });

    it('falls back to store config in practitioner mode when practitioner is not selected', () => {
        const tenant = createTenant({
            mode: 'practitioner',
            liffId: 'tenant-liff',
            channelId: 'tenant-channel',
        });
        const store = createStore({
            liffId: 'store-liff',
            channelId: 'store-channel',
        });

        const resolved = resolveLineConfigForTenant(tenant, store, null);

        expect(resolved.mode).toBe('practitioner');
        expect(resolved.source).toBe('store');
        expect(resolved.storeId).toBe(store.id);
        expect(resolved.lineConfig.liffId).toBe('store-liff');
        expect(resolved.lineConfig.channelId).toBe('store-channel');
    });
});
