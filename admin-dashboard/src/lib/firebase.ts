/**
 * Firebase Client SDK Configuration
 * Admin Dashboard用のFirebase設定
 */

"use client";

import { initializeApp, getApps } from 'firebase/app';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    User
} from 'firebase/auth';

// Firebase設定 (クライアント用公開キー)
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'keyexpress-reserve',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
};

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

function getAuthSafe() {
    if (!isBrowser()) return null;
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    return getAuth(app);
}

/**
 * メールアドレスとパスワードでログイン
 */
export async function signIn(email: string, password: string) {
    const auth = getAuthSafe();
    if (!auth) throw new Error('Firebase Auth is not available in this environment');
    return signInWithEmailAndPassword(auth, email, password);
}

/**
 * メールアドレスとパスワードで新規登録
 */
export async function signUp(email: string, password: string, displayName?: string) {
    const auth = getAuthSafe();
    if (!auth) throw new Error('Firebase Auth is not available in this environment');
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName?.trim()) {
        await updateProfile(credential.user, { displayName: displayName.trim() });
    }
    return credential;
}

/**
 * ログアウト
 */
export async function signOut() {
    const auth = getAuthSafe();
    if (!auth) return;
    return firebaseSignOut(auth);
}

/**
 * 認証状態の変更を監視
 */
export function onAuthChange(callback: (user: User | null) => void) {
    const auth = getAuthSafe();
    if (!auth) {
        callback(null);
        return () => {};
    }
    return onAuthStateChanged(auth, callback);
}

/**
 * 現在のユーザーを取得
 */
export function getCurrentUser() {
    const auth = getAuthSafe();
    return auth?.currentUser ?? null;
}

/**
 * IDトークンを取得（API呼び出し用）
 */
export async function getIdToken() {
    const auth = getAuthSafe();
    const user = auth?.currentUser ?? null;
    if (!user) return null;
    return user.getIdToken();
}

// NOTE: Don't export `auth` directly. It breaks Next.js prerendering when evaluated on the server.
