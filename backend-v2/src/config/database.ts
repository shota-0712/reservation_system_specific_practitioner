import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

dotenv.config();

// 接続設定
const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'app_user',
    password: process.env.DB_PASSWORD || 'change_me',
    database: process.env.DB_NAME || 'reservation_system',
    max: 20, // 最大コネクション数
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    logger.error('Unexpected error on idle client', err);
    process.exit(-1);
});

export class DatabaseService {
    /**
     * クエリを実行する汎用メソッド
     * テナントIDが指定されている場合はRLSを設定してからクエリを実行する
     */
    static async query<T = any>(
        text: string,
        params?: any[],
        tenantId?: string
    ): Promise<T[]> {
        const client = await pool.connect();
        try {
            if (tenantId) {
                // RLS用のテナントIDを設定（ローカルセッション）
                await client.query(`SELECT set_tenant($1)`, [tenantId]);
            }

            const res = await client.query(text, params);
            return res.rows;
        } finally {
            client.release();
        }
    }

    /**
     * トランザクションを実行する
     */
    static async transaction<T>(
        callback: (client: PoolClient) => Promise<T>,
        tenantId?: string
    ): Promise<T> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            if (tenantId) {
                // RLS用のテナントIDを設定
                await client.query(`SELECT set_tenant($1)`, [tenantId]);
            }

            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    /**
     * 1件取得（ヘルパー）
     */
    static async queryOne<T = any>(
        text: string,
        params?: any[],
        tenantId?: string
    ): Promise<T | null> {
        const rows = await this.query<T>(text, params, tenantId);
        return rows.length > 0 ? rows[0] : null;
    }
}

export default pool;
