import { app, db, auth } from '@/lib/firebase/client';
import firebaseConfig from '@/firebase-applet-config.json';
import { doc, getDoc } from 'firebase/firestore';

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

// Graceful connectivity test helper
export async function testConnection() {
  if (typeof window === 'undefined') return;
  try {
    await getDoc(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error) {
      if (
        error.message.includes('the client is offline') ||
        error.message.includes('unavailable') ||
        (error as any).code === 'unavailable'
      ) {
        // Expected behavior in offline / sandbox mode
        return;
      }
      console.warn('Firestore connection check:', error.message);
    }
  }
}

export default app;
