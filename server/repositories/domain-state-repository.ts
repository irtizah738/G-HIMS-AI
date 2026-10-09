import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';

function canReadEphemeralRepository(): boolean {
  const mode = getRuntimeMode();
  return mode === 'TEST' || mode === 'DEMO';
}

export class DomainStateRepository {
  public static isAvailable(): boolean {
    return getAdminFirestore() !== null;
  }

  public static async getById<T>(
    tenantId: string,
    collectionName: string,
    documentId: string
  ): Promise<T | null> {
    if (canReadEphemeralRepository()) {
      const ephemeral = TransactionManager.getEphemeralStateByCollectionForTesting(
        tenantId,
        collectionName,
        documentId
      );
      if (ephemeral) return ephemeral as T;
      if (TransactionManager.hasEphemeralState(tenantId)) return null;
    }

    const db = getAdminFirestore();
    if (!db) {
      return null;
    }

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
    if (canReadEphemeralRepository()) {
      const ephemeral = TransactionManager.getEphemeralCollectionForTesting(
        tenantId,
        collectionName
      );
      if (ephemeral.length > 0 || TransactionManager.hasEphemeralState(tenantId)) {
        return ephemeral.slice(0, limit) as T[];
      }
    }

    const db = getAdminFirestore();
    if (!db) {
      return [];
    }

    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection(collectionName)
      .limit(limit)
      .get();

    return snapshot.docs.map((document) => document.data() as T);
  }

  /**
   * Read tenant-scoped rows with their canonical Firestore document identity.
   * Authorization and identity joins must not depend on duplicated ID fields
   * in document bodies, which are optional in existing membership records.
   */
  public static async listWithDocumentIds<T extends object>(
    tenantId: string,
    collectionName: string,
    limit = 500
  ): Promise<Array<T & { documentId: string }>> {
    const db = getAdminFirestore();
    if (!db) {
      if (!canReadEphemeralRepository()) return [];
      return TransactionManager.getEphemeralCollectionForTesting(
        tenantId,
        collectionName
      ).slice(0, limit).map((row) => ({
        ...row,
        documentId: String(row.userId || row.id || row.documentId || ''),
      })) as Array<T & { documentId: string }>;
    }

    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection(collectionName)
      .limit(limit)
      .get();

    return snapshot.docs.map((document) => ({
      ...(document.data() as T),
      documentId: document.id,
    }));
  }

  public static async queryEqual<T>(
    tenantId: string,
    collectionName: string,
    field: string,
    value: unknown,
    limit = 100
  ): Promise<T[]> {
    if (canReadEphemeralRepository()) {
      const ephemeral = TransactionManager.getEphemeralCollectionForTesting(
        tenantId,
        collectionName
      ).filter((row) => row[field] === value);
      if (ephemeral.length > 0 || TransactionManager.hasEphemeralState(tenantId)) {
        return ephemeral.slice(0, limit) as T[];
      }
    }

    const db = getAdminFirestore();
    if (!db) {
      return [];
    }

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
    if (canReadEphemeralRepository()) {
      const ephemeral = TransactionManager.getEphemeralCollectionForTesting(
        tenantId,
        collectionName
      ).filter((row) => row[field] === value);
      if (ephemeral.length > 0 || TransactionManager.hasEphemeralState(tenantId)) {
        const maxRows = Math.max(1, options.maxRows || 50000);
        if (ephemeral.length > maxRows) {
          throw new Error(
            `DOMAIN_QUERY_LIMIT_EXCEEDED:${collectionName}:${field}:${maxRows}`
          );
        }
        return ephemeral as T[];
      }
    }

    const db = getAdminFirestore();
    if (!db) {
      return [];
    }

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
