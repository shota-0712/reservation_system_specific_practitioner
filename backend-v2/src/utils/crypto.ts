/**
 * Encryption Utilities
 * AES-256-GCM encryption for sensitive data (LINE tokens, etc.)
 */

import crypto from 'crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/**
 * Encrypt sensitive data
 */
export function encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = Buffer.from(env.ENCRYPTION_KEY, 'utf8').subarray(0, 32);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encryptedData (all hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt sensitive data
 */
export function decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');

    if (parts.length !== 3) {
        throw new Error('Invalid encrypted text format');
    }

    const [ivHex, authTagHex, encrypted] = parts;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(env.ENCRYPTION_KEY, 'utf8').subarray(0, 32);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Generate secure random store code
 * 8 characters, lowercase alphanumeric (excluding confusable chars)
 */
export function generateStoreCode(): string {
    // Exclude: 0/O (zero/oh), 1/l (one/ell), i/I (eye)
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const length = 8;

    let code = '';
    const randomBytes = crypto.randomBytes(length);

    for (let i = 0; i < length; i++) {
        code += chars[randomBytes[i] % chars.length];
    }

    return code;
}

/**
 * Generate tenant slug from name
 */
export function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50);
}
