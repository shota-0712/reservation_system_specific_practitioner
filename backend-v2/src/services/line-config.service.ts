import type { Practitioner, Store, Tenant } from '../types/index.js';

export type LineConfigSource = 'tenant' | 'store' | 'practitioner';

export interface ResolvedLineConfig {
    mode: 'tenant' | 'store' | 'practitioner';
    source: LineConfigSource;
    lineConfig: NonNullable<Tenant['lineConfig']>;
    storeId?: string;
    practitionerId?: string;
}

function hasAnyLineField(config?: Practitioner['lineConfig'] | Tenant['lineConfig'] | Store['lineConfig']): boolean {
    if (!config) return false;
    return Boolean(
        config.liffId
        || config.channelId
        || config.channelAccessToken
        || config.channelSecret
    );
}

export function resolveLineConfigForTenant(
    tenant: Tenant,
    store?: Store | null,
    practitioner?: Practitioner | null
): ResolvedLineConfig {
    const tenantLineConfig = tenant.lineConfig ?? {};
    const mode = (tenantLineConfig.mode ?? 'tenant') as 'tenant' | 'store' | 'practitioner';

    const tenantResolved: NonNullable<Tenant['lineConfig']> = {
        mode,
        liffId: tenantLineConfig.liffId,
        channelId: tenantLineConfig.channelId,
        channelAccessToken: tenantLineConfig.channelAccessToken,
        channelSecret: tenantLineConfig.channelSecret,
    };

    if (mode === 'store') {
        if (!store || !hasAnyLineField(store.lineConfig)) {
            return {
                mode,
                source: 'tenant',
                lineConfig: tenantResolved,
            };
        }

        const storeConfig = store.lineConfig ?? {};
        return {
            mode,
            source: 'store',
            storeId: store.id,
            lineConfig: {
                mode,
                liffId: storeConfig.liffId ?? tenantLineConfig.liffId,
                channelId: storeConfig.channelId ?? tenantLineConfig.channelId,
                channelAccessToken: storeConfig.channelAccessToken ?? tenantLineConfig.channelAccessToken,
                channelSecret: storeConfig.channelSecret ?? tenantLineConfig.channelSecret,
            },
        };
    }

    if (mode !== 'practitioner') {
        return {
            mode,
            source: 'tenant',
            lineConfig: tenantResolved,
        };
    }

    const storeConfig = store?.lineConfig ?? {};
    const hasStoreLineConfig = hasAnyLineField(storeConfig);
    const hasPractitionerLineConfig = Boolean(practitioner && hasAnyLineField(practitioner.lineConfig));

    if (!hasPractitionerLineConfig) {
        if (hasStoreLineConfig) {
            return {
                mode,
                source: 'store',
                storeId: store?.id,
                lineConfig: {
                    mode,
                    liffId: storeConfig.liffId ?? tenantLineConfig.liffId,
                    channelId: storeConfig.channelId ?? tenantLineConfig.channelId,
                    channelAccessToken: storeConfig.channelAccessToken ?? tenantLineConfig.channelAccessToken,
                    channelSecret: storeConfig.channelSecret ?? tenantLineConfig.channelSecret,
                },
            };
        }
        return {
            mode,
            source: 'tenant',
            lineConfig: tenantResolved,
        };
    }

    const resolvedPractitioner = practitioner as Practitioner;
    const practitionerConfig = resolvedPractitioner.lineConfig ?? {};
    return {
        mode,
        source: 'practitioner',
        storeId: store?.id,
        practitionerId: resolvedPractitioner.id,
        lineConfig: {
            mode,
            liffId: practitionerConfig.liffId ?? storeConfig.liffId ?? tenantLineConfig.liffId,
            channelId: practitionerConfig.channelId ?? storeConfig.channelId ?? tenantLineConfig.channelId,
            channelAccessToken: practitionerConfig.channelAccessToken ?? storeConfig.channelAccessToken ?? tenantLineConfig.channelAccessToken,
            channelSecret: practitionerConfig.channelSecret ?? storeConfig.channelSecret ?? tenantLineConfig.channelSecret,
        },
    };
}
