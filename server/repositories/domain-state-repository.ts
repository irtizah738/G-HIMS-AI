import { getAdminFirestore } from '@/server/firebase/admin';

export class DomainStateRepository {
  public static isAvailable(): boolean {
    return getAdminFirestore() !== null;
  }

  public static async getById<T>(
    tenantId: string,
    collectionName: string,
    documentId: string
  ): Promise<T | null> {
    const db = getAdminFirestore();
    if (!db) return null;

    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection(collectionName)
      .doc(documentId)
      .get();

    return snapshot.exists ? (snapshot.data() as T) : null;
  }

  public static async list<T>(
    tenantId: string,
    collectionName: string,
    limit = 500
  ): Promise<T[]> {
    const db = getAdminFirestore();
    if (!db) return [];

    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection(collectionName)
      .limit(limit)
      .get();

    return snapshot.docs.map((document) => document.data() as T);
  }

  public static async queryEqual<T>(
    tenantId: string,
    collectionName: string,
    field: string,
    value: unknown,
    limit = 100
  ): Promise<T[]> {
    const db = getAdminFirestore();
    if (!db) return [];

    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection(collectionName)
      .where(field, '==', value)
      .limit(limit)
      .get();

    return snapshot.docs.map((document) => document.data() as T);
  }
}
