import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
            getNotifications: vi.fn(),
            updateProfile: vi.fn(),
            updateBusiness: vi.fn(),
            updateLine: vi.fn(),
            updateNotifications: vi.fn(),
            resolveLinePreview: vi.fn(),
        },
        rfmSettingsApi: {
            get: vi.fn(),
            update: vi.fn(),
        },
    };
});

import { rfmSettingsApi, settingsApi } from '@/lib/api';

const DEFAULT_RFM_SETTINGS = {
    recency: { score5: 30, score4: 60, score3: 90, score2: 180 },
    frequency: { score5: 12, score4: 8, score3: 4, score2: 2 },
    monetary: { score5: 100000, score4: 50000, score3: 20000, score2: 10000 },
};

describe('SettingsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(settingsApi.resolveLinePreview).mockResolvedValue({
            success: true,
            data: { mode: 'tenant', source: 'tenant', liffId: 'liff-1', channelId: 'ch-1' },
        });
        vi.mocked(rfmSettingsApi.get).mockResolvedValue({
            success: true,
            data: DEFAULT_RFM_SETTINGS,
        });
        vi.mocked(rfmSettingsApi.update).mockResolvedValue({
            success: true,
            data: DEFAULT_RFM_SETTINGS,
        });
        vi.mocked(settingsApi.getNotifications).mockResolvedValue({
            success: true,
            data: {
                emailNewReservation: true,
                emailCancellation: true,
                emailDailyReport: true,
                lineReminder: true,
                lineConfirmation: true,
                lineReview: true,
                pushNewReservation: true,
                pushCancellation: true,
            },
        });
        vi.mocked(settingsApi.updateNotifications).mockResolvedValue({
            success: true,
            data: {
                emailNewReservation: true,
                emailCancellation: true,
                emailDailyReport: true,
                lineReminder: true,
                lineConfirmation: true,
                lineReview: true,
                pushNewReservation: true,
                pushCancellation: true,
            },
        });
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

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText(/設定の読み込みに失敗しました/)).not.toBeInTheDocument();
        });
    });

    it('RFM閾値バリデーションNG時は保存をブロックする', async () => {
        vi.mocked(settingsApi.get).mockResolvedValue({
            success: true,
            data: {
                tenant: { id: 'tenant-1', name: 'テストサロン' },
                store: { id: 'store-1', name: 'テスト店舗' },
            },
        });
        vi.mocked(settingsApi.updateBusiness).mockResolvedValue({
            success: true,
        });

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '予約設定' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: '予約設定' }));

        fireEvent.change(screen.getByLabelText('RFM recency score5'), {
            target: { value: '100' },
        });

        fireEvent.click(screen.getByRole('button', { name: '設定を保存' }));

        await waitFor(() => {
            expect(screen.getAllByText(/Recencyは score5 < score4 < score3 < score2/).length).toBeGreaterThan(0);
        });
        expect(settingsApi.updateBusiness).not.toHaveBeenCalled();
        expect(rfmSettingsApi.update).not.toHaveBeenCalled();
    });

    it('RFM閾値で等号（同値）を入力した場合は保存をブロックする', async () => {
        vi.mocked(settingsApi.get).mockResolvedValue({
            success: true,
            data: {
                tenant: { id: 'tenant-1', name: 'テストサロン' },
                store: { id: 'store-1', name: 'テスト店舗' },
            },
        });
        vi.mocked(settingsApi.updateBusiness).mockResolvedValue({
            success: true,
        });

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '予約設定' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: '予約設定' }));

        // frequency.score4 を score3 と同値にする（デフォルト: score4=8, score3=4 → score4を4に変更）
        fireEvent.change(screen.getByLabelText('RFM frequency score4'), {
            target: { value: '4' },
        });

        fireEvent.click(screen.getByRole('button', { name: '設定を保存' }));

        await waitFor(() => {
            expect(screen.getAllByText(/Frequencyは score5 > score4 > score3 > score2/).length).toBeGreaterThan(0);
        });
        expect(settingsApi.updateBusiness).not.toHaveBeenCalled();
        expect(rfmSettingsApi.update).not.toHaveBeenCalled();
    });

    it('RFM保存API失敗時にエラーバナーを表示する', async () => {
        vi.mocked(settingsApi.get).mockResolvedValue({
            success: true,
            data: {
                tenant: { id: 'tenant-1', name: 'テストサロン' },
                store: { id: 'store-1', name: 'テスト店舗' },
            },
        });
        vi.mocked(settingsApi.updateBusiness).mockResolvedValue({
            success: true,
        });
        vi.mocked(rfmSettingsApi.update).mockResolvedValue({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'RFM保存失敗' },
        });

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '予約設定' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: '予約設定' }));
        fireEvent.click(screen.getByRole('button', { name: '設定を保存' }));

        await waitFor(() => {
            expect(screen.getByText(/RFM閾値設定の読み込み\/保存に失敗しました: RFM保存失敗/)).toBeInTheDocument();
        });
        expect(rfmSettingsApi.update).toHaveBeenCalledTimes(1);
    });

    it('通知設定を初期表示時に API から読み込む', async () => {
        vi.mocked(settingsApi.get).mockResolvedValue({
            success: true,
            data: {
                tenant: { id: 'tenant-1', name: 'テストサロン' },
                store: { id: 'store-1', name: 'テスト店舗' },
            },
        });
        vi.mocked(settingsApi.getNotifications).mockResolvedValue({
            success: true,
            data: {
                emailNewReservation: false,
                emailCancellation: true,
                emailDailyReport: true,
                lineReminder: true,
                lineConfirmation: false,
                lineReview: true,
                pushNewReservation: true,
                pushCancellation: true,
            },
        });

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '通知設定' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: '通知設定' }));

        await waitFor(() => {
            expect(screen.getByLabelText('新規予約通知')).not.toBeChecked();
            expect(screen.getByLabelText('予約確認メッセージ')).not.toBeChecked();
        });
    });

    it('通知設定の保存成功時に API 呼び出しと成功メッセージを表示する', async () => {
        vi.mocked(settingsApi.get).mockResolvedValue({
            success: true,
            data: {
                tenant: { id: 'tenant-1', name: 'テストサロン' },
                store: { id: 'store-1', name: 'テスト店舗' },
            },
        });
        vi.mocked(settingsApi.getNotifications).mockResolvedValue({
            success: true,
            data: {
                emailNewReservation: true,
                emailCancellation: true,
                emailDailyReport: true,
                lineReminder: true,
                lineConfirmation: true,
                lineReview: true,
                pushNewReservation: true,
                pushCancellation: true,
            },
        });
        vi.mocked(settingsApi.updateNotifications).mockResolvedValue({
            success: true,
            data: {
                emailNewReservation: false,
                emailCancellation: true,
                emailDailyReport: true,
                lineReminder: true,
                lineConfirmation: true,
                lineReview: true,
                pushNewReservation: true,
                pushCancellation: true,
            },
        });

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '通知設定' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: '通知設定' }));
        fireEvent.click(screen.getByLabelText('新規予約通知'));
        fireEvent.click(screen.getByRole('button', { name: '設定を保存' }));

        await waitFor(() => {
            expect(settingsApi.updateNotifications).toHaveBeenCalledWith({
                emailNewReservation: false,
                emailCancellation: true,
                emailDailyReport: true,
                lineReminder: true,
                lineConfirmation: true,
                lineReview: true,
                pushNewReservation: true,
                pushCancellation: true,
            });
            expect(screen.getByText('通知設定を保存しました')).toBeInTheDocument();
        });
    });

    it('通知設定の保存失敗時にエラーバナーを表示する', async () => {
        vi.mocked(settingsApi.get).mockResolvedValue({
            success: true,
            data: {
                tenant: { id: 'tenant-1', name: 'テストサロン' },
                store: { id: 'store-1', name: 'テスト店舗' },
            },
        });
        vi.mocked(settingsApi.updateNotifications).mockResolvedValue({
            success: false,
            error: { code: 'BAD_REQUEST', message: '通知設定の保存失敗' },
        });

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '通知設定' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: '通知設定' }));
        fireEvent.click(screen.getByRole('button', { name: '設定を保存' }));

        await waitFor(() => {
            expect(screen.getByText(/通知設定の読み込み\/保存に失敗しました: 通知設定の保存失敗/)).toBeInTheDocument();
        });
    });
});
