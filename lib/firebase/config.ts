import { app, db, auth } from '@/lib/firebase/client';

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

/**
 * Browser initialization sanity check only.
 *
 * Do not probe Firestore from the unauthenticated application shell. Production
 * rules intentionally deny arbitrary root documents, so a client-side
 * direct read of a synthetic root document is not a valid connectivity test. Real
 * Firebase Auth/Firestore readiness is verified server-side by /api/health/ready.
 */
export async function testConnection(): Promise<boolean> {
  if (typeof window === 'undefined') return true;

  const appProjectId = String(app.options.projectId || '').trim();
  const authProjectId = String(auth.app.options.projectId || '').trim();

  return Boolean(appProjectId && authProjectId && appProjectId === authProjectId);
}

export default app;
