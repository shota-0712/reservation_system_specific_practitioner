import { DatabaseService } from '../config/database.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { getStorageInstance } from '../config/firebase.js';
import { GoogleAuth } from 'google-auth-library';
import { fetchWithResilience } from '../utils/external-api-client.js';

const DEFAULT_TIMEZONE = 'Asia/Tokyo';

export type ExportType =
    | 'operations_reservations'
    | 'operations_customers'
    | 'analytics_store_daily_kpi'
    | 'analytics_menu_performance';

export type ExportStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ExportJob {
    id: string;
    tenantId: string;
    storeId?: string;
    exportType: ExportType;
    format: 'csv';
    params: Record<string, unknown>;
    status: ExportStatus;
    requestedBy?: string;
    rowCount?: number;
    errorMessage?: string;
    storageType?: 'inline' | 'gcs';
    gcsBucket?: string;
    gcsObjectPath?: string;
    downloadUrlExpiresAt?: Date;
    requestedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

interface ExportJobRow {
    id: string;
    tenant_id: string;
    store_id: string | null;
    export_type: ExportType;
    format: 'csv';
    params: Record<string, unknown> | null;
    status: ExportStatus;
    requested_by: string | null;
    row_count: number | null;
    csv_content: string | null;
    error_message: string | null;
    storage_type: 'inline' | 'gcs' | null;
    gcs_bucket: string | null;
    gcs_object_path: string | null;
    download_url_expires_at: Date | null;
    requested_at: Date;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface CreateExportJobInput {
    storeId?: string;
    exportType: ExportType;
    format?: 'csv';
    params?: Record<string, unknown>;
    requestedBy?: string;
}

export interface ExportDownloadPayload {
    filename: string;
    contentType: string;
    content?: string;
    redirectUrl?: string;
}

function mapExportJob(row: ExportJobRow): ExportJob {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        storeId: row.store_id ?? undefined,
        exportType: row.export_type,
        format: row.format,
        params: row.params ?? {},
        status: row.status,
        requestedBy: row.requested_by ?? undefined,
        rowCount: row.row_count ?? undefined,
        errorMessage: row.error_message ?? undefined,
        storageType: row.storage_type ?? undefined,
        gcsBucket: row.gcs_bucket ?? undefined,
        gcsObjectPath: row.gcs_object_path ?? undefined,
        downloadUrlExpiresAt: row.download_url_expires_at ?? undefined,
        requestedAt: row.requested_at,
        startedAt: row.started_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function normalizeDate(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function reservationLocalDateSql(alias: string): string {
    return `(${alias}.starts_at AT TIME ZONE COALESCE(${alias}.timezone, '${DEFAULT_TIMEZONE}'))::date`;
}

function reservationLocalTimeSql(alias: string, column: 'starts_at' | 'ends_at'): string {
    return `to_char(${alias}.${column} AT TIME ZONE COALESCE(${alias}.timezone, '${DEFAULT_TIMEZONE}'), 'HH24:MI')`;
}

function reservationLocalDateLabelSql(alias: string): string {
    return `to_char(${alias}.starts_at AT TIME ZONE COALESCE(${alias}.timezone, '${DEFAULT_TIMEZONE}'), 'YYYY-MM-DD')`;
}

function escapeCsvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    const raw = Array.isArray(value) ? value.join(' | ') : String(value);
    if (/[",\n\r]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
    const head = headers.map((h) => escapeCsvCell(h)).join(',');
    const lines = rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(','));
    return [head, ...lines].join('\n');
}

function toBigQueryString(value: string | null | undefined): string | undefined {
    return value ?? undefined;
}

function toBigQueryDate(value: string | undefined): string | undefined {
    return value;
}

export class ExportJobService {
    constructor(private tenantId: string) {}

    private analyticsSource(): 'cloudsql' | 'bigquery' {
        return env.ANALYTICS_EXPORT_SOURCE;
    }

    private getExportBucket(): string | null {
        const bucket = env.EXPORT_GCS_BUCKET?.trim();
        return bucket ? bucket : null;
    }

    private objectPathFor(job: ExportJobRow): string {
        return `${env.EXPORT_GCS_PREFIX}/${job.tenant_id}/${job.export_type}/${job.id}.csv`;
    }

    private signedUrlExpiresAt(): Date {
        return new Date(Date.now() + env.EXPORT_SIGNED_URL_TTL_MINUTES * 60 * 1000);
    }

    private async uploadToGcs(bucketName: string, objectPath: string, csv: string): Promise<void> {
        const storage = getStorageInstance();
        const file = storage.bucket(bucketName).file(objectPath);
        await file.save(csv, {
            contentType: 'text/csv; charset=utf-8',
            resumable: false,
            metadata: {
                cacheControl: 'private, max-age=300',
                contentDisposition: `attachment; filename="${objectPath.split('/').pop() ?? 'export.csv'}"`,
            },
        });
    }

    private async createSignedUrl(bucketName: string, objectPath: string, expiresAt: Date): Promise<string> {
        const storage = getStorageInstance();
        const file = storage.bucket(bucketName).file(objectPath);
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: expiresAt,
        });
        return url;
    }

    private buildBigQueryNamedParameters(values: Record<string, string | undefined>): Array<{
        name: string;
        parameterType: { type: string };
        parameterValue: { value: string | null };
    }> {
        return Object.entries(values).map(([name, value]) => ({
            name,
            parameterType: { type: 'STRING' },
            parameterValue: { value: value ?? null },
        }));
    }

    private parseBigQueryRows(
        fields: Array<{ name: string }>,
        rows: Array<{ f: Array<{ v: unknown }> }>
    ): Array<Record<string, unknown>> {
        return rows.map((row) => {
            const out: Record<string, unknown> = {};
            for (let i = 0; i < fields.length; i += 1) {
                out[fields[i]?.name ?? `col_${i}`] = row.f[i]?.v ?? null;
            }
            return out;
        });
    }

    private async runBigQueryQuery(
        query: string,
        params: Record<string, string | undefined>
    ): Promise<Array<Record<string, unknown>>> {
        const projectId = env.BIGQUERY_PROJECT_ID || env.FIREBASE_PROJECT_ID;
        const auth = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/bigquery'],
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        const accessToken = typeof tokenResponse === 'string'
            ? tokenResponse
            : tokenResponse.token;

        if (!accessToken) {
            throw new ValidationError('BigQuery 認証トークンの取得に失敗しました');
        }

        const response = await fetchWithResilience(
            `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
            {
                service: 'bigquery',
                operation: 'run-query',
                tenantId: this.tenantId,
                method: 'POST',
                enableRetries: false,
                timeoutMs: 15000,
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query,
                    useLegacySql: false,
                    parameterMode: 'NAMED',
                    queryParameters: this.buildBigQueryNamedParameters(params),
                }),
            }
        );

        if (!response.ok) {
            const text = await response.text();
            throw new ValidationError(`BigQuery query failed: ${response.status} ${text}`);
        }

        const json = await response.json() as {
            schema?: { fields?: Array<{ name: string }> };
            rows?: Array<{ f: Array<{ v: unknown }> }>;
            errors?: Array<{ message?: string }>;
        };

        if (json.errors && json.errors.length > 0) {
            throw new ValidationError(`BigQuery query error: ${json.errors[0]?.message ?? 'unknown'}`);
        }

        const fields = json.schema?.fields ?? [];
        const rows = json.rows ?? [];
        return this.parseBigQueryRows(fields, rows);
    }

    async create(input: CreateExportJobInput): Promise<ExportJob> {
        const row = await DatabaseService.queryOne<ExportJobRow>(
            `INSERT INTO export_jobs (
                tenant_id,
                store_id,
                export_type,
                format,
                params,
                status,
                requested_by
            ) VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', $6)
            RETURNING *`,
            [
                this.tenantId,
                input.storeId ?? null,
                input.exportType,
                input.format ?? 'csv',
                JSON.stringify(input.params ?? {}),
                input.requestedBy ?? null,
            ],
            this.tenantId
        );

        if (!row) {
            throw new ValidationError('エクスポートジョブ作成に失敗しました');
        }

        const job = mapExportJob(row);

        // 非同期実行: API応答を返した後に生成を開始
        setImmediate(() => {
            this.run(job.id).catch(() => undefined);
        });

        return job;
    }

    async findById(id: string): Promise<ExportJob | null> {
        const row = await DatabaseService.queryOne<ExportJobRow>(
            `SELECT * FROM export_jobs
             WHERE id = $1 AND tenant_id = $2`,
            [id, this.tenantId],
            this.tenantId
        );
        return row ? mapExportJob(row) : null;
    }

    async findByIdOrFail(id: string): Promise<ExportJob> {
        const job = await this.findById(id);
        if (!job) {
            throw new NotFoundError('エクスポートジョブ', id);
        }
        return job;
    }

    async list(limit = 50): Promise<ExportJob[]> {
        const cappedLimit = Math.max(1, Math.min(limit, 200));
        const rows = await DatabaseService.query<ExportJobRow>(
            `SELECT * FROM export_jobs
             WHERE tenant_id = $1
             ORDER BY requested_at DESC
             LIMIT $2`,
            [this.tenantId, cappedLimit],
            this.tenantId
        );
        return rows.map(mapExportJob);
    }

    async listWithTotal(params?: {
        page?: number;
        limit?: number;
    }): Promise<{ jobs: ExportJob[]; total: number; page: number; limit: number }> {
        const page = Math.max(1, params?.page ?? 1);
        const limit = Math.max(1, Math.min(params?.limit ?? 50, 200));
        const offset = (page - 1) * limit;

        const [rows, countRow] = await Promise.all([
            DatabaseService.query<ExportJobRow>(
                `SELECT * FROM export_jobs
                 WHERE tenant_id = $1
                 ORDER BY requested_at DESC
                 LIMIT $2 OFFSET $3`,
                [this.tenantId, limit, offset],
                this.tenantId
            ),
            DatabaseService.queryOne<{ total: string }>(
                `SELECT COUNT(*)::text AS total
                 FROM export_jobs
                 WHERE tenant_id = $1`,
                [this.tenantId],
                this.tenantId
            ),
        ]);

        return {
            jobs: rows.map(mapExportJob),
            total: Number(countRow?.total ?? '0'),
            page,
            limit,
        };
    }

    async getDownload(id: string): Promise<ExportDownloadPayload> {
        const row = await DatabaseService.queryOne<ExportJobRow>(
            `SELECT * FROM export_jobs
             WHERE id = $1 AND tenant_id = $2`,
            [id, this.tenantId],
            this.tenantId
        );
        if (!row) {
            throw new NotFoundError('エクスポートジョブ', id);
        }
        if (row.status !== 'completed') {
            throw new ValidationError('CSVの生成が完了していません');
        }

        if (row.storage_type === 'gcs' && row.gcs_bucket && row.gcs_object_path) {
            const expiresAt = this.signedUrlExpiresAt();
            const signedUrl = await this.createSignedUrl(row.gcs_bucket, row.gcs_object_path, expiresAt);
            await DatabaseService.query(
                `UPDATE export_jobs
                 SET download_url_expires_at = $3,
                     updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2`,
                [id, this.tenantId, expiresAt],
                this.tenantId
            );
            return {
                filename: `${row.export_type}-${row.id}.csv`,
                contentType: 'text/csv; charset=utf-8',
                redirectUrl: signedUrl,
            };
        }

        if (!row.csv_content) {
            throw new ValidationError('CSV本体が存在しません');
        }

        return {
            filename: `${row.export_type}-${row.id}.csv`,
            contentType: 'text/csv; charset=utf-8',
            content: row.csv_content,
        };
    }

    private async run(jobId: string): Promise<void> {
        await DatabaseService.query(
            `UPDATE export_jobs
             SET status = 'running',
                 started_at = NOW(),
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $1
               AND tenant_id = $2
               AND status IN ('queued', 'failed')`,
            [jobId, this.tenantId],
            this.tenantId
        );

        const row = await DatabaseService.queryOne<ExportJobRow>(
            `SELECT * FROM export_jobs
             WHERE id = $1 AND tenant_id = $2`,
            [jobId, this.tenantId],
            this.tenantId
        );
        if (!row) return;

        try {
            const { csv, rowCount } = await this.generateCsv(row);
            const bucket = this.getExportBucket();
            if (bucket) {
                const objectPath = this.objectPathFor(row);
                await this.uploadToGcs(bucket, objectPath, csv);
                const expiresAt = this.signedUrlExpiresAt();
                await DatabaseService.query(
                    `UPDATE export_jobs
                     SET status = 'completed',
                         storage_type = 'gcs',
                         gcs_bucket = $3,
                         gcs_object_path = $4,
                         download_url_expires_at = $5,
                         csv_content = NULL,
                         row_count = $6,
                         completed_at = NOW(),
                         updated_at = NOW()
                     WHERE id = $1 AND tenant_id = $2`,
                    [jobId, this.tenantId, bucket, objectPath, expiresAt, rowCount],
                    this.tenantId
                );
            } else {
                await DatabaseService.query(
                    `UPDATE export_jobs
                     SET status = 'completed',
                         storage_type = 'inline',
                         gcs_bucket = NULL,
                         gcs_object_path = NULL,
                         download_url_expires_at = NULL,
                         csv_content = $3,
                         row_count = $4,
                         completed_at = NOW(),
                         updated_at = NOW()
                     WHERE id = $1 AND tenant_id = $2`,
                    [jobId, this.tenantId, csv, rowCount],
                    this.tenantId
                );
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await DatabaseService.query(
                `UPDATE export_jobs
                 SET status = 'failed',
                     storage_type = COALESCE(storage_type, 'inline'),
                     error_message = $3,
                     completed_at = NOW(),
                     updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2`,
                [jobId, this.tenantId, message],
                this.tenantId
            );
        }
    }

    private async generateCsv(job: ExportJobRow): Promise<{ csv: string; rowCount: number }> {
        const storeId = job.store_id ?? undefined;
        const params = (job.params ?? {}) as Record<string, unknown>;
        const dateFrom = normalizeDate(params.dateFrom);
        const dateTo = normalizeDate(params.dateTo);

        switch (job.export_type) {
        case 'operations_reservations':
            return this.generateReservationsCsv(storeId, dateFrom, dateTo);
        case 'operations_customers':
            return this.generateCustomersCsv(storeId);
        case 'analytics_store_daily_kpi':
            if (this.analyticsSource() === 'bigquery') {
                return this.generateStoreDailyKpiCsvFromBigQuery(storeId, dateFrom, dateTo);
            }
            return this.generateStoreDailyKpiCsvFromCloudSql(storeId, dateFrom, dateTo);
        case 'analytics_menu_performance':
            if (this.analyticsSource() === 'bigquery') {
                return this.generateMenuPerformanceCsvFromBigQuery(storeId, dateFrom, dateTo);
            }
            return this.generateMenuPerformanceCsvFromCloudSql(storeId, dateFrom, dateTo);
        default:
            throw new ValidationError(`未対応のexport_typeです: ${job.export_type}`);
        }
    }

    private async generateReservationsCsv(
        storeId?: string,
        dateFrom?: string,
        dateTo?: string
    ): Promise<{ csv: string; rowCount: number }> {
        const localDateSql = reservationLocalDateSql('r');
        const filters: string[] = ['r.tenant_id = $1'];
        const values: Array<string | null> = [this.tenantId];
        let idx = 2;

        if (storeId) {
            filters.push(`r.store_id = $${idx++}`);
            values.push(storeId);
        }
        if (dateFrom) {
            filters.push(`${localDateSql} >= $${idx++}::date`);
            values.push(dateFrom);
        }
        if (dateTo) {
            filters.push(`${localDateSql} <= $${idx++}::date`);
            values.push(dateTo);
        }

        const rows = await DatabaseService.query<Record<string, unknown>>(
            `WITH reservation_base AS (
                SELECT
                    r.*,
                    ${reservationLocalDateLabelSql('r')} AS reservation_date,
                    ${reservationLocalTimeSql('r', 'starts_at')} AS start_time_local,
                    ${reservationLocalTimeSql('r', 'ends_at')} AS end_time_local
                FROM reservations r
                WHERE ${filters.join(' AND ')}
            )
            SELECT
                r.id,
                s.name AS store_name,
                r.customer_name,
                r.customer_phone,
                r.practitioner_name,
                r.reservation_date,
                r.start_time_local,
                r.end_time_local,
                r.status,
                r.total_price,
                COALESCE(string_agg(DISTINCT rm.menu_name, ' / '), '') AS menu_names,
                COALESCE(string_agg(DISTINCT ro.option_name, ' / '), '') AS option_names,
                r.created_at
             FROM reservation_base r
             LEFT JOIN stores s
               ON s.tenant_id = r.tenant_id AND s.id = r.store_id
             LEFT JOIN reservation_menus rm
               ON rm.tenant_id = r.tenant_id AND rm.reservation_id = r.id
             LEFT JOIN reservation_options ro
               ON ro.tenant_id = r.tenant_id AND ro.reservation_id = r.id
             GROUP BY
                r.id, s.name, r.customer_name, r.customer_phone, r.practitioner_name,
                r.reservation_date, r.start_time_local, r.end_time_local,
                r.status, r.total_price, r.created_at, r.starts_at
             ORDER BY r.starts_at DESC`,
            values,
            this.tenantId
        );

        const headers = [
            'reservationId',
            'storeName',
            'customerName',
            'customerPhone',
            'practitionerName',
            'date',
            'startTime',
            'endTime',
            'status',
            'totalPrice',
            'menus',
            'options',
            'createdAt',
        ];

        const csv = toCsv(headers, rows.map((r) => ({
            reservationId: r.id,
            storeName: r.store_name,
            customerName: r.customer_name,
            customerPhone: r.customer_phone,
            practitionerName: r.practitioner_name,
            date: r.reservation_date,
            startTime: r.start_time_local,
            endTime: r.end_time_local,
            status: r.status,
            totalPrice: r.total_price,
            menus: r.menu_names,
            options: r.option_names,
            createdAt: r.created_at,
        })));

        return { csv, rowCount: rows.length };
    }

    private async generateCustomersCsv(storeId?: string): Promise<{ csv: string; rowCount: number }> {
        const rows = await DatabaseService.query<Record<string, unknown>>(
            `SELECT
                c.id,
                c.name,
                c.phone,
                c.email,
                c.total_visits,
                c.total_spend,
                c.last_visit_at,
                c.is_active,
                c.created_at
             FROM customers c
             WHERE c.tenant_id = $1
               AND (
                    $2::uuid IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM reservations r
                        WHERE r.tenant_id = c.tenant_id
                          AND r.customer_id = c.id
                          AND r.store_id = $2::uuid
                    )
               )
             ORDER BY c.created_at DESC`,
            [this.tenantId, storeId ?? null],
            this.tenantId
        );

        const headers = [
            'customerId',
            'name',
            'phone',
            'email',
            'totalVisits',
            'totalSpend',
            'lastVisitAt',
            'isActive',
            'createdAt',
        ];

        const csv = toCsv(headers, rows.map((r) => ({
            customerId: r.id,
            name: r.name,
            phone: r.phone,
            email: r.email,
            totalVisits: r.total_visits,
            totalSpend: r.total_spend,
            lastVisitAt: r.last_visit_at,
            isActive: r.is_active,
            createdAt: r.created_at,
        })));

        return { csv, rowCount: rows.length };
    }

    private async generateStoreDailyKpiCsvFromCloudSql(
        storeId?: string,
        dateFrom?: string,
        dateTo?: string
    ): Promise<{ csv: string; rowCount: number }> {
        const filters: string[] = ['da.tenant_id = $1'];
        const values: Array<string | null> = [this.tenantId];
        let idx = 2;

        if (storeId) {
            filters.push(`da.store_id = $${idx++}`);
            values.push(storeId);
        }
        if (dateFrom) {
            filters.push(`da.date >= $${idx++}`);
            values.push(dateFrom);
        }
        if (dateTo) {
            filters.push(`da.date <= $${idx++}`);
            values.push(dateTo);
        }

        const rows = await DatabaseService.query<Record<string, unknown>>(
            `SELECT
                da.date,
                s.name AS store_name,
                da.reservation_count,
                da.completed_count,
                da.cancel_count,
                da.total_revenue,
                da.unique_customers,
                da.new_customers
             FROM daily_analytics da
             LEFT JOIN stores s
               ON s.tenant_id = da.tenant_id AND s.id = da.store_id
             WHERE ${filters.join(' AND ')}
             ORDER BY da.date DESC`,
            values,
            this.tenantId
        );

        const headers = [
            'date',
            'storeName',
            'reservationCount',
            'completedCount',
            'cancelCount',
            'totalRevenue',
            'uniqueCustomers',
            'newCustomers',
        ];

        const csv = toCsv(headers, rows.map((r) => ({
            date: r.date,
            storeName: r.store_name,
            reservationCount: r.reservation_count,
            completedCount: r.completed_count,
            cancelCount: r.cancel_count,
            totalRevenue: r.total_revenue,
            uniqueCustomers: r.unique_customers,
            newCustomers: r.new_customers,
        })));

        return { csv, rowCount: rows.length };
    }

    private async generateMenuPerformanceCsvFromCloudSql(
        storeId?: string,
        dateFrom?: string,
        dateTo?: string
    ): Promise<{ csv: string; rowCount: number }> {
        const localDateSql = reservationLocalDateSql('r');
        const filters: string[] = ['r.tenant_id = $1'];
        const values: Array<string | null> = [this.tenantId];
        let idx = 2;

        if (storeId) {
            filters.push(`r.store_id = $${idx++}`);
            values.push(storeId);
        }
        if (dateFrom) {
            filters.push(`${localDateSql} >= $${idx++}::date`);
            values.push(dateFrom);
        }
        if (dateTo) {
            filters.push(`${localDateSql} <= $${idx++}::date`);
            values.push(dateTo);
        }

        const rows = await DatabaseService.query<Record<string, unknown>>(
            `SELECT
                rm.menu_name,
                COUNT(*) AS reservation_count,
                COALESCE(SUM(rm.menu_price * rm.quantity), 0) AS revenue,
                COALESCE(AVG(rm.menu_price), 0) AS avg_menu_price
             FROM reservation_menus rm
             INNER JOIN reservations r
               ON r.tenant_id = rm.tenant_id AND r.id = rm.reservation_id
             WHERE ${filters.join(' AND ')}
               AND r.status IN ('pending', 'confirmed', 'completed')
             GROUP BY rm.menu_name
             ORDER BY revenue DESC, reservation_count DESC`,
            values,
            this.tenantId
        );

        const headers = [
            'menuName',
            'reservationCount',
            'revenue',
            'avgMenuPrice',
        ];

        const csv = toCsv(headers, rows.map((r) => ({
            menuName: r.menu_name,
            reservationCount: r.reservation_count,
            revenue: r.revenue,
            avgMenuPrice: r.avg_menu_price,
        })));

        return { csv, rowCount: rows.length };
    }

    private bigQueryMartTable(table: string): string {
        const projectId = env.BIGQUERY_PROJECT_ID || env.FIREBASE_PROJECT_ID;
        const dataset = env.BIGQUERY_MART_DATASET;
        if (!dataset) {
            throw new ValidationError('BIGQUERY_MART_DATASET が未設定です');
        }
        return `\`${projectId}.${dataset}.${table}\``;
    }

    private async generateStoreDailyKpiCsvFromBigQuery(
        storeId?: string,
        dateFrom?: string,
        dateTo?: string
    ): Promise<{ csv: string; rowCount: number }> {
        const table = this.bigQueryMartTable('store_daily_kpi');
        const rows = await this.runBigQueryQuery(
            `SELECT
                CAST(date AS STRING) AS date,
                store_name,
                reservation_count,
                completed_count,
                cancel_count,
                total_revenue,
                unique_customers,
                new_customers
             FROM ${table}
             WHERE tenant_id = @tenant_id
               AND (@store_id IS NULL OR store_id = @store_id)
               AND (@date_from IS NULL OR CAST(date AS STRING) >= @date_from)
               AND (@date_to IS NULL OR CAST(date AS STRING) <= @date_to)
             ORDER BY date DESC`,
            {
                tenant_id: this.tenantId,
                store_id: toBigQueryString(storeId),
                date_from: toBigQueryDate(dateFrom),
                date_to: toBigQueryDate(dateTo),
            }
        );

        const headers = [
            'date',
            'storeName',
            'reservationCount',
            'completedCount',
            'cancelCount',
            'totalRevenue',
            'uniqueCustomers',
            'newCustomers',
        ];

        const csv = toCsv(headers, rows.map((r) => ({
            date: r.date,
            storeName: r.store_name,
            reservationCount: r.reservation_count,
            completedCount: r.completed_count,
            cancelCount: r.cancel_count,
            totalRevenue: r.total_revenue,
            uniqueCustomers: r.unique_customers,
            newCustomers: r.new_customers,
        })));

        return { csv, rowCount: rows.length };
    }

    private async generateMenuPerformanceCsvFromBigQuery(
        storeId?: string,
        dateFrom?: string,
        dateTo?: string
    ): Promise<{ csv: string; rowCount: number }> {
        const table = this.bigQueryMartTable('menu_performance_daily');
        const rows = await this.runBigQueryQuery(
            `SELECT
                menu_name,
                SUM(reservation_count) AS reservation_count,
                SUM(revenue) AS revenue,
                AVG(avg_menu_price) AS avg_menu_price
             FROM ${table}
             WHERE tenant_id = @tenant_id
               AND (@store_id IS NULL OR store_id = @store_id)
               AND (@date_from IS NULL OR CAST(date AS STRING) >= @date_from)
               AND (@date_to IS NULL OR CAST(date AS STRING) <= @date_to)
             GROUP BY menu_name
             ORDER BY revenue DESC, reservation_count DESC`,
            {
                tenant_id: this.tenantId,
                store_id: toBigQueryString(storeId),
                date_from: toBigQueryDate(dateFrom),
                date_to: toBigQueryDate(dateTo),
            }
        );

        const headers = [
            'menuName',
            'reservationCount',
            'revenue',
            'avgMenuPrice',
        ];

        const csv = toCsv(headers, rows.map((r) => ({
            menuName: r.menu_name,
            reservationCount: r.reservation_count,
            revenue: r.revenue,
            avgMenuPrice: r.avg_menu_price,
        })));

        return { csv, rowCount: rows.length };
    }
}

export function createExportJobService(tenantId: string): ExportJobService {
    return new ExportJobService(tenantId);
}
