import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SettingsPage from './page';

// Firebase モジュールをスタブ化
vi.mock('@/lib/firebase', () => ({
    getIdToken: vi.fn().mockResolvedValue('mock-token'),
    onAuthChange: vi.fn((cb: (u: null) => void) => { cb(null); return () => {}; }),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
}));

// settingsApi をモック
vi.mock('@/lib/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/api')>();
    return {
        ...actual,
        settingsApi: {
            get: vi.fn(),
            updateProfile: vi.fn(),
            updateBusiness: vi.fn(),
            updateLine: vi.fn(),
            resolveLinePreview: vi.fn(),
        },
    };
});

import { settingsApi } from '@/lib/api';

describe('SettingsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('API が失敗した場合、エラーバナーを表示する', async () => {
        vi.mocked(settingsApi.get).mockRejectedValue(new Error('ネットワークエラー'));

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.getByText(/設定の読み込みに失敗しました/)).toBeInTheDocument();
            expect(screen.getByText(/ネットワークエラー/)).toBeInTheDocument();
        });
    });

    it('API が成功した場合、エラーバナーを表示しない', async () => {
        vi.mocked(settingsApi.get).mockResolvedValue({
            success: true,
            data: {
                tenant: { id: 'tenant-1', name: 'テストサロン' },
                store: { id: 'store-1', name: 'テスト店舗' },
            },
        });
        vi.mocked(settingsApi.resolveLinePreview).mockResolvedValue({
            success: true,
            data: { mode: 'tenant', source: 'tenant', liffId: 'liff-1', channelId: 'ch-1' },
        });

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText(/設定の読み込みに失敗しました/)).not.toBeInTheDocument();
        });
    });
});
