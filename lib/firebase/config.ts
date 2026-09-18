import { app, db, auth } from '@/lib/firebase/client';
import firebaseConfig from '@/firebase-applet-config.json';
import { doc, getDocFromServer } from 'firebase/firestore';

export { app, db, auth };

/**
 * Utility to strip undefined properties recursively from objects before writing to Firestore.
 * Firestore setDoc and updateDoc reject objects containing undefined values.
 */
export function cleanFirestoreData<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.filter((item) => item !== undefined).map(cleanFirestoreData) as unknown as T;
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj as Record<string, any>)) {
    if (value !== undefined) {
      result[key] = cleanFirestoreData(value);
    }
  }
  return result as T;
}

// Connectivity test helper adhering strictly to firebase-skill validation requirement
export async function testConnection(maxRetries = 3, delayMs = 600) {
  if (typeof window === 'undefined') return;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      return; // Connected successfully
    } catch (error) {
      const isOffline = error instanceof Error && error.message.includes('the client is offline');
      if (isOffline) {
        if (attempt < maxRetries) {
          await new Promise((res) => setTimeout(res, delayMs * attempt));
          continue;
        }
        console.error('Please check your Firebase configuration.');
      } else {
        // Other errors (e.g. non-blocking or already handled)
        break;
      }
    }
  }
}

// Initial boot connection test - schedule after microtask so network stack finishes initializing
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => { testConnection(); }, 300);
    });
  } else {
    setTimeout(() => { testConnection(); }, 300);
  }
}

export default app;
