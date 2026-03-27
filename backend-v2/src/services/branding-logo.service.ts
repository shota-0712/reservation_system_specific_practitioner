import { randomUUID } from 'node:crypto';
import { getStorageInstance } from '../config/firebase.js';
import { ValidationError } from '../utils/errors.js';

const MAX_LOGO_FILE_BYTES = 4 * 1024 * 1024;
const ALLOWED_LOGO_CONTENT_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp',
]);

function sanitizePathSegment(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'logo';
}

function resolveExtension(fileName: string, contentType: string): string {
    const extension = fileName.split('.').at(-1) ?? '';
    if (/^[a-z0-9]{2,8}$/i.test(extension)) {
        return extension.toLowerCase();
    }

    if (contentType === 'image/jpeg') return 'jpg';
    if (contentType === 'image/png') return 'png';
    if (contentType === 'image/svg+xml') return 'svg';
    if (contentType === 'image/webp') return 'webp';
    return 'bin';
}

export function validateBrandingLogoUpload(contentType: string, byteLength: number): void {
    if (!ALLOWED_LOGO_CONTENT_TYPES.has(contentType)) {
        throw new ValidationError('ロゴ画像は PNG / JPG / WebP / SVG を指定してください');
    }

    if (byteLength <= 0) {
        throw new ValidationError('ロゴ画像データが空です');
    }

    if (byteLength > MAX_LOGO_FILE_BYTES) {
        throw new ValidationError('ロゴ画像は 4MB 以下にしてください');
    }
}

export async function uploadTenantBrandingLogo(params: {
    tenantId: string;
    fileName: string;
    contentType: string;
    bytes: Buffer;
}): Promise<{ logoUrl: string; objectPath: string }> {
    validateBrandingLogoUpload(params.contentType, params.bytes.byteLength);

    const bucket = getStorageInstance().bucket();
    const extension = resolveExtension(params.fileName, params.contentType);
    const baseName = sanitizePathSegment(params.fileName.replace(/\.[^.]+$/, ''));
    const objectPath = [
        'tenant-assets',
        params.tenantId,
        'branding',
        `${Date.now()}-${baseName}-${randomUUID()}.${extension}`,
    ].join('/');
    const downloadToken = randomUUID();
    const file = bucket.file(objectPath);

    await file.save(params.bytes, {
        resumable: false,
        contentType: params.contentType,
        metadata: {
            cacheControl: 'public,max-age=31536000,immutable',
            metadata: {
                firebaseStorageDownloadTokens: downloadToken,
            },
        },
    });

    const logoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;

    return {
        logoUrl,
        objectPath,
    };
}
