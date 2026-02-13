import type { Store } from '../types/index.js';

export function sanitizeStoreForResponse(store: Store): Store {
    if (!store.lineConfig) {
        return store;
    }

    return {
        ...store,
        lineConfig: {
            liffId: store.lineConfig.liffId,
            channelId: store.lineConfig.channelId,
        },
    };
}

export function sanitizeStoresForResponse(stores: Store[]): Store[] {
    return stores.map(sanitizeStoreForResponse);
}
