/**
 * Authentication Middleware
 * Supports Firebase Auth (Admin Dashboard) and LINE Auth (Customer App)
 */

import { Request, Response, NextFunction } from 'express';
import { createHmac } from 'crypto';
import { getAuthInstance } from '../config/firebase.js';
import { DatabaseService } from '../config/database.js';
import { decrypt } from '../utils/crypto.js';
import { AuthenticationError, AuthorizationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedRequest, Admin, AdminRole, DecodedLineToken } from '../types/index.js';

/**
 * Verify Firebase ID token (for Admin Dashboard)
 */
export function requireFirebaseAuth() {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        const authenticatedReq = req as AuthenticatedRequest;

        try {
            const authHeader = req.headers.authorization;

            // SECURITY: Development bypass removed for production
            // Use proper Firebase Auth tokens for all environments

            if (!authHeader?.startsWith('Bearer ')) {
                throw new AuthenticationError('認証トークンが必要です');
            }

            const token = authHeader.split(' ')[1];
            const auth = getAuthInstance();

            // Verify the token
            const decodedToken = await auth.verifyIdToken(token);

            const tenantId = authenticatedReq.tenantId;

            if (!tenantId) {
                throw new AuthenticationError('テナントが特定できません');
            }

            const adminRow = await DatabaseService.queryOne(
                'SELECT * FROM admins WHERE tenant_id = $1 AND firebase_uid = $2 AND is_active = true LIMIT 1',
                [tenantId, decodedToken.uid],
                tenantId
            );

            if (!adminRow) {
                const anyAdminRow = await DatabaseService.queryOne(
                    'SELECT id FROM admins WHERE tenant_id = $1 LIMIT 1',
                    [tenantId],
                    tenantId
                );

                if (!anyAdminRow) {
                    logger.info(`Creating initial admin for tenant ${tenantId}`);
                    const permissions = {
                        canManageReservations: true,
                        canViewReports: true,
                        canManageCustomers: true,
                        canManagePractitioners: true,
                        canManageMenus: true,
                        canManageSettings: true,
                        canManageAdmins: true,
                    };

                    await DatabaseService.queryOne(
                        `INSERT INTO admins (tenant_id, firebase_uid, email, name, role, permissions, is_active, store_ids)\n                         VALUES ($1, $2, $3, $4, 'owner', $5, true, ARRAY[]::uuid[])\n                         RETURNING *`,
                        [tenantId, decodedToken.uid, decodedToken.email || '', decodedToken.name || 'オーナー', permissions],
                        tenantId
                    );

                    authenticatedReq.user = {
                        uid: decodedToken.uid,
                        tenantId,
                        role: 'owner',
                        permissions,
                    };
                    logger.debug(`Created and authenticated initial admin: ${decodedToken.email}`);
                    return next();
                }

                throw new AuthorizationError('管理者として登録されていません');
            }

            const admin = adminRow as unknown as Admin;

            const rawPermissions = (adminRow as any).permissions || {};
            const permissions = {
                canManageReservations: rawPermissions.canManageReservations ?? rawPermissions.manageReservations ?? true,
                canViewReports: rawPermissions.canViewReports ?? rawPermissions.viewAnalytics ?? false,
                canManageCustomers: rawPermissions.canManageCustomers ?? true,
                canManagePractitioners: rawPermissions.canManagePractitioners ?? rawPermissions.managePractitioners ?? false,
                canManageMenus: rawPermissions.canManageMenus ?? rawPermissions.manageMenus ?? false,
                canManageSettings: rawPermissions.canManageSettings ?? rawPermissions.manageSettings ?? false,
                canManageAdmins: rawPermissions.canManageAdmins ?? rawPermissions.manageAdmins ?? false,
            };

            // Attach user data to request
            authenticatedReq.user = {
                uid: decodedToken.uid,
                tenantId,
                role: admin.role,
                permissions,
            };

            logger.debug(`Authenticated admin: ${admin.name} (${admin.role})`);
            next();
        } catch (error) {
            if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
                next(error);
            } else {
                logger.error('Firebase auth error:', { error });
                next(new AuthenticationError('認証に失敗しました'));
            }
        }
    };
}

/**
 * Verify LINE ID Token (for Customer LIFF App)
 */
export function requireLineAuth() {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        const authenticatedReq = req as AuthenticatedRequest;

        try {
            const authHeader = req.headers.authorization;

            if (!authHeader?.startsWith('Bearer ')) {
                throw new AuthenticationError('LINEトークンが必要です');
            }

            const idToken = authHeader.split(' ')[1];

            // Verify LINE ID token with signature validation
            const decodedToken = await verifyLineIdToken(idToken, authenticatedReq.tenantId);

            // Attach user data to request
            authenticatedReq.user = {
                uid: decodedToken.sub, // LINE User ID
                tenantId: authenticatedReq.tenantId || '',
                name: decodedToken.name,
                picture: decodedToken.picture,
            };

            logger.debug(`Authenticated LINE user: ${decodedToken.sub}`);
            next();
        } catch (error) {
            if (error instanceof AuthenticationError) {
                next(error);
            } else {
                logger.error('LINE auth error:', { error });
                next(new AuthenticationError('LINE認証に失敗しました'));
            }
        }
    };
}

/**
 * Require specific admin role
 */
export function requireRole(...allowedRoles: AdminRole[]) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const authenticatedReq = req as AuthenticatedRequest;

        if (!authenticatedReq.user) {
            return next(new AuthenticationError());
        }

        if (!authenticatedReq.user.role) {
            return next(new AuthorizationError('ロールが設定されていません'));
        }

        if (!allowedRoles.includes(authenticatedReq.user.role)) {
            return next(new AuthorizationError(`この操作には${allowedRoles.join('または')}権限が必要です`));
        }

        next();
    };
}

/**
 * Require specific permission
 */
export function requirePermission(permission: keyof Admin['permissions']) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const authenticatedReq = req as AuthenticatedRequest;

        if (!authenticatedReq.user) {
            return next(new AuthenticationError());
        }

        // Owner has all permissions
        if (authenticatedReq.user.role === 'owner') {
            return next();
        }

        if (!authenticatedReq.user.permissions?.[permission]) {
            return next(new AuthorizationError('この操作を行う権限がありません'));
        }

        next();
    };
}

/**
 * Optional auth - doesn't fail if not authenticated
 */
export function optionalAuth() {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        const authenticatedReq = req as AuthenticatedRequest;
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            return next();
        }

        const token = authHeader.split(' ')[1];

        try {
            // Try Firebase Auth first
            const auth = getAuthInstance();
            const decodedToken = await auth.verifyIdToken(token);

            authenticatedReq.user = {
                uid: decodedToken.uid,
                tenantId: authenticatedReq.tenantId || '',
            };
        } catch {
            // Silently fail for optional auth
            logger.debug('Optional auth failed, continuing without user');
        }

        next();
    };
}

/**
 * Verify LINE ID Token with HMAC-SHA256 signature verification
 * 
 * LINE ID Token structure: header.payload.signature
 * Signature is HMAC-SHA256(base64url(header) + "." + base64url(payload), channel_secret)
 */
async function verifyLineIdToken(
    idToken: string,
    tenantId?: string
): Promise<DecodedLineToken> {
    try {
        const parts = idToken.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid token format');
        }

        const [headerB64, payloadB64, signatureB64] = parts;

        // Decode payload first to get basic info
        const payload = JSON.parse(
            Buffer.from(payloadB64, 'base64url').toString('utf-8')
        ) as DecodedLineToken;

        // Get LINE channel secret from tenant settings or environment
        const channelSecret = await getLineChannelSecret(tenantId);

        if (channelSecret) {
            // Verify signature with HMAC-SHA256
            const signatureInput = `${headerB64}.${payloadB64}`;
            const expectedSignature = createHmac('sha256', channelSecret)
                .update(signatureInput)
                .digest('base64url');

            if (signatureB64 !== expectedSignature) {
                logger.warn('LINE token signature mismatch');
                throw new AuthenticationError('無効なLINEトークン署名です');
            }

            // Verify token expiration
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) {
                throw new AuthenticationError('LINEトークンの有効期限が切れています');
            }

            // Verify issuer
            if (payload.iss !== 'https://access.line.me') {
                throw new AuthenticationError('無効なトークン発行者です');
            }

            // Get expected channel ID from tenant settings or environment
            const expectedChannelId = await getLineChannelId(tenantId);
            if (expectedChannelId && payload.aud !== expectedChannelId) {
                throw new AuthenticationError('トークンのチャネルIDが一致しません');
            }

            logger.debug('LINE token verified successfully');
        } else {
            // No channel secret configured - log warning but allow in development
            if (process.env.NODE_ENV === 'production') {
                throw new AuthenticationError('LINE認証が設定されていません');
            }
            logger.warn('⚠️ LINE channel secret not configured - skipping signature verification');
        }

        return payload;
    } catch (error) {
        if (error instanceof AuthenticationError) {
            throw error;
        }
        logger.error('LINE token verification error:', { error });
        throw new AuthenticationError('無効なLINEトークンです');
    }
}

/**
 * Get LINE Channel Secret from tenant settings or environment
 */
async function getLineChannelSecret(tenantId?: string): Promise<string | null> {
    if (tenantId) {
        try {
            const row = await DatabaseService.queryOne(
                'SELECT line_channel_secret_encrypted FROM tenants WHERE id = $1',
                [tenantId]
            );
            const encrypted = row?.line_channel_secret_encrypted as string | undefined;
            if (encrypted) {
                try {
                    return decrypt(encrypted);
                } catch {
                    return encrypted;
                }
            }
        } catch (error) {
            logger.warn('Failed to get LINE channel secret from DB:', { error });
        }
    }

    // Fallback to environment variable
    return process.env.LINE_CHANNEL_SECRET || null;
}

/**
 * Get LINE Channel ID from tenant settings or environment
 */
async function getLineChannelId(tenantId?: string): Promise<string | null> {
    if (tenantId) {
        try {
            const row = await DatabaseService.queryOne(
                'SELECT line_channel_id FROM tenants WHERE id = $1',
                [tenantId]
            );
            const channelId = row?.line_channel_id as string | undefined;
            if (channelId) return channelId;
        } catch (error) {
            logger.warn('Failed to get LINE channel ID from DB:', { error });
        }
    }

    // Fallback to environment variable
    return process.env.LINE_CHANNEL_ID || null;
}

/**
 * Get authenticated user from request
 */
export function getUser(req: Request): AuthenticatedRequest['user'] {
    const authenticatedReq = req as AuthenticatedRequest;
    if (!authenticatedReq.user) {
        throw new AuthenticationError();
    }
    return authenticatedReq.user;
}
