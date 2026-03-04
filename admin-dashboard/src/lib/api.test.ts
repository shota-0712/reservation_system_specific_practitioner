import { describe, it, expect, beforeEach, vi } from 'vitest';

// Firebase モジュールをスタブ化（初期化不要）
vi.mock('./firebase', () => ({
    getIdToken: vi.fn().mockResolvedValue('mock-token'),
}));

// localStorage の簡易 mock を用意
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
    };
})();

vi.stubGlobal('localStorage', localStorageMock);

import { setActiveStoreId, getActiveStoreId, STORE_CHANGED_EVENT } from './api';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const INVALID_UUID = 'not-a-valid-uuid';

describe('getActiveStoreId', () => {
    beforeEach(() => {
        localStorageMock.clear();
    });

    it('localStorage に有効な UUID がある場合、その値を返す', () => {
        localStorageMock.setItem('reservation_admin_store_id', VALID_UUID);
        expect(getActiveStoreId()).toBe(VALID_UUID);
    });

    it('localStorage が空の場合、null を返す', () => {
        expect(getActiveStoreId()).toBeNull();
    });

    it('localStorage に不正な値がある場合、null を返す', () => {
        localStorageMock.setItem('reservation_admin_store_id', INVALID_UUID);
        expect(getActiveStoreId()).toBeNull();
    });
});

describe('setActiveStoreId', () => {
    beforeEach(() => {
        localStorageMock.clear();
    });

    it('有効な UUID を設定すると localStorage に保存する', () => {
        setActiveStoreId(VALID_UUID);
        expect(localStorageMock.getItem('reservation_admin_store_id')).toBe(VALID_UUID);
    });

    it('不正な UUID を設定すると Error をスローする', () => {
        expect(() => setActiveStoreId(INVALID_UUID)).toThrow('Invalid store id');
    });

    it('null を渡すと localStorage から削除する', () => {
        localStorageMock.setItem('reservation_admin_store_id', VALID_UUID);
        setActiveStoreId(null);
        expect(localStorageMock.getItem('reservation_admin_store_id')).toBeNull();
    });

    it('同じ UUID を再設定しても STORE_CHANGED_EVENT を発火しない', () => {
        localStorageMock.setItem('reservation_admin_store_id', VALID_UUID);
        const listener = vi.fn();
        window.addEventListener(STORE_CHANGED_EVENT, listener);
        setActiveStoreId(VALID_UUID);
        expect(listener).not.toHaveBeenCalled();
        window.removeEventListener(STORE_CHANGED_EVENT, listener);
    });

    it('新しい UUID を設定すると STORE_CHANGED_EVENT を発火する', () => {
        const OTHER_UUID = '550e8400-e29b-41d4-a716-446655440001';
        const listener = vi.fn();
        window.addEventListener(STORE_CHANGED_EVENT, listener);
        setActiveStoreId(OTHER_UUID);
        expect(listener).toHaveBeenCalledTimes(1);
        window.removeEventListener(STORE_CHANGED_EVENT, listener);
    });
});
