/**
 * Firebase Admin SDK Configuration
 * Initializes Firebase Auth (and optional Storage)
 *
 * Supports:
 * - Application Default Credentials (Cloud Run / GCE)
 * - Service Account Key (development with explicit credentials)
 * - Development mode without credentials (emulator)
 */

import { initializeApp, cert, getApps, App, applicationDefault } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getStorage, Storage } from 'firebase-admin/storage';
import { env } from './env.js';

let app: App;
let auth: Auth;
let storage: Storage;

/**
 * Initialize Firebase Admin SDK
 */
export function initializeFirebase(): void {
    if (getApps().length > 0) {
        console.log('🔥 Firebase already initialized');
        return;
    }

    try {
        // Case 1: Development mode without credentials (emulator)
        if (env.NODE_ENV === 'development' && !env.FIREBASE_PRIVATE_KEY) {
            console.log('🔥 Initializing Firebase in development mode (emulator)');
            app = initializeApp({
                projectId: env.FIREBASE_PROJECT_ID,
            });
        }
        // Case 2: Explicit service account credentials provided
        else if (env.FIREBASE_PRIVATE_KEY && env.FIREBASE_CLIENT_EMAIL) {
            console.log('🔥 Initializing Firebase with service account credentials');
            app = initializeApp({
                credential: cert({
                    projectId: env.FIREBASE_PROJECT_ID,
                    privateKey: env.FIREBASE_PRIVATE_KEY,
                    clientEmail: env.FIREBASE_CLIENT_EMAIL,
                }),
                databaseURL: env.FIREBASE_DATABASE_URL,
                storageBucket: `${env.FIREBASE_PROJECT_ID}.appspot.com`,
            });
        }
        // Case 3: Use Application Default Credentials (Cloud Run / GCE)
        else {
            console.log('🔥 Initializing Firebase with Application Default Credentials');
            app = initializeApp({
                credential: applicationDefault(),
                projectId: env.FIREBASE_PROJECT_ID,
                storageBucket: `${env.FIREBASE_PROJECT_ID}.appspot.com`,
            });
        }

        // Initialize Auth and Storage
        auth = getAuth(app);
        storage = getStorage(app);

        console.log('✅ Firebase initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize Firebase:', error);
        throw error;
    }
}

/**
 * Get Auth instance
 */
export function getAuthInstance(): Auth {
    if (!auth) {
        throw new Error('Firebase not initialized. Call initializeFirebase() first.');
    }
    return auth;
}

/**
 * Get Storage instance
 */
export function getStorageInstance(): Storage {
    if (!storage) {
        throw new Error('Firebase not initialized. Call initializeFirebase() first.');
    }
    return storage;
}

// Export singleton instances (will be undefined until initialized)
export { auth, storage };
