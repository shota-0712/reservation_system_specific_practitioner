import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const getSignedUrlMock = vi.fn(async () => ['https://storage.example/export.csv']);

vi.mock('../../src/config/firebase.js', () => ({
    getStorageInstance: () => ({
        bucket: () => ({
            file: () => ({
                getSignedUrl: getSignedUrlMock,
            }),
        }),
    }),
}));

let createExportJobService: typeof import('../../src/services/export-job.service.js').createExportJobService;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;

beforeAll(async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';

    ({ createExportJobService } = await import('../../src/services/export-job.service.js'));
    ({ DatabaseService } = await import('../../src/config/database.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
    getSignedUrlMock.mockClear();
});

function createJobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'job-1',
        tenant_id: 'tenant-a',
        store_id: null,
        export_type: 'operations_reservations',
        format: 'csv',
        params: {},
        status: 'queued',
        requested_by: 'uid-1',
        row_count: null,
        csv_content: null,
        error_message: null,
        storage_type: null,
        gcs_bucket: null,
        gcs_object_path: null,
        download_url_expires_at: null,
        requested_at: new Date('2026-03-22T00:00:00.000Z'),
        started_at: null,
        completed_at: null,
        created_at: new Date('2026-03-22T00:00:00.000Z'),
        updated_at: new Date('2026-03-22T00:00:00.000Z'),
        ...overrides,
    };
}

describe('export-job.service', () => {
    it('creates queued export jobs without starting the runner in tests', async () => {
        const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate').mockImplementation(((callback: (...args: unknown[]) => void) => {
            void callback;
            return 0 as any;
        }) as any);

        const queryOneSpy = vi.spyOn(DatabaseService, 'queryOne').mockImplementation(async (sql: string) => {
            if (sql.includes('INSERT INTO export_jobs')) {
                return createJobRow() as any;
            }
            return null;
        });

        const service = createExportJobService('tenant-a');
        const job = await service.create({
            exportType: 'operations_reservations',
            params: { dateFrom: '2026-03-01' },
            requestedBy: 'uid-1',
        });

        expect(job.status).toBe('queued');
        expect(job.tenantId).toBe('tenant-a');
        expect(job.requestedBy).toBe('uid-1');
        expect(queryOneSpy).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO export_jobs'),
            [
                'tenant-a',
                null,
                'operations_reservations',
                'csv',
                JSON.stringify({ dateFrom: '2026-03-01' }),
                'uid-1',
            ],
            'tenant-a'
        );
        expect(setImmediateSpy).toHaveBeenCalledTimes(1);
    });

    it('lists export jobs with pagination and total count', async () => {
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValueOnce([
            createJobRow({ id: 'job-2', requested_at: new Date('2026-03-22T00:10:00.000Z') }),
            createJobRow({ id: 'job-1', requested_at: new Date('2026-03-22T00:05:00.000Z') }),
        ] as any);
        vi.spyOn(DatabaseService, 'queryOne').mockResolvedValueOnce({ total: '2' } as any);

        const service = createExportJobService('tenant-a');
        const result = await service.listWithTotal({ page: 2, limit: 500 });

        expect(result.page).toBe(2);
        expect(result.limit).toBe(200);
        expect(result.total).toBe(2);
        expect(result.jobs).toHaveLength(2);
        expect(querySpy).toHaveBeenCalledWith(
            expect.stringContaining('LIMIT $2 OFFSET $3'),
            ['tenant-a', 200, 200],
            'tenant-a'
        );
    });

    it('returns inline CSV download payloads directly', async () => {
        vi.spyOn(DatabaseService, 'queryOne').mockResolvedValueOnce(
            createJobRow({
                id: 'job-inline',
                status: 'completed',
                storage_type: 'inline',
                csv_content: 'reservationId,customerName\n1,山田',
                export_type: 'operations_reservations',
            }) as any
        );
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValue([] as any);

        const service = createExportJobService('tenant-a');
        const payload = await service.getDownload('job-inline');

        expect(payload).toEqual({
            filename: 'operations_reservations-job-inline.csv',
            contentType: 'text/csv; charset=utf-8',
            content: 'reservationId,customerName\n1,山田',
        });
        expect(querySpy).not.toHaveBeenCalled();
    });

    it('returns a signed GCS redirect for completed GCS exports', async () => {
        vi.spyOn(DatabaseService, 'queryOne').mockResolvedValueOnce(
            createJobRow({
                id: 'job-gcs',
                status: 'completed',
                storage_type: 'gcs',
                gcs_bucket: 'export-bucket',
                gcs_object_path: 'exports/tenant-a/operations_reservations/job-gcs.csv',
                export_type: 'operations_reservations',
            }) as any
        );
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValue([] as any);

        const service = createExportJobService('tenant-a');
        const payload = await service.getDownload('job-gcs');

        expect(payload.redirectUrl).toBe('https://storage.example/export.csv');
        expect(payload.filename).toBe('operations_reservations-job-gcs.csv');
        expect(payload.contentType).toBe('text/csv; charset=utf-8');
        expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
        expect(querySpy).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE export_jobs'),
            [
                'job-gcs',
                'tenant-a',
                expect.any(Date),
            ],
            'tenant-a'
        );
    });
});
