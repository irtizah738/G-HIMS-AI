import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
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

  public static async queryAllEqual<T>(
    tenantId: string,
    collectionName: string,
    field: string,
    value: unknown,
    options: { pageSize?: number; maxRows?: number } = {}
  ): Promise<T[]> {
    const db = getAdminFirestore();
    if (!db) return [];

    const pageSize = Math.max(1, Math.min(500, options.pageSize || 500));
    const maxRows = Math.max(pageSize, options.maxRows || 50000);
    const collection = db
      .collection('tenants')
      .doc(tenantId)
      .collection(collectionName);

    const rows: T[] = [];
    let lastDocument: QueryDocumentSnapshot | null = null;

    while (true) {
      let query = collection
        .where(field, '==', value)
        .orderBy(FieldPath.documentId())
        .limit(pageSize);

      if (lastDocument) query = query.startAfter(lastDocument);

      const snapshot = await query.get();
      rows.push(...snapshot.docs.map((document) => document.data() as T));

      if (rows.length > maxRows) {
        throw new Error(
          `DOMAIN_QUERY_LIMIT_EXCEEDED:${collectionName}:${field}:${maxRows}`
        );
      }

      if (snapshot.size < pageSize) break;
      lastDocument = snapshot.docs[snapshot.docs.length - 1] || null;
      if (!lastDocument) break;
    }

    return rows;
  }
}
