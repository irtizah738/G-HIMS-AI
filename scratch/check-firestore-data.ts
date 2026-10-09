import { getAdminFirestore } from '../server/firebase/admin';

async function main() {
  const db = getAdminFirestore();
  if (!db) {
    console.error('No admin firestore');
    return;
  }

  const tenantId = 'central-metro-hospital';
  console.log('--- ROOT COLLECTIONS ---');
  for (const col of ['patients', 'beds', 'opdQueue', 'staff', 'telehealth_sessions', 'tenants', 'user_profiles']) {
    try {
      const snap = await db.collection(col).limit(5).get();
      console.log(`Root collection "${col}": ${snap.size} documents`);
    } catch (e: any) {
      console.log(`Root collection "${col}" error: ${e.message}`);
    }
  }

  console.log('\n--- TENANT SUBCOLLECTIONS (tenants/' + tenantId + ') ---');
  for (const col of ['patients', 'beds', 'opd_queue', 'encounters', 'users']) {
    try {
      const snap = await db.collection('tenants').doc(tenantId).collection(col).limit(5).get();
      console.log(`Tenant collection "${col}": ${snap.size} documents`);
    } catch (e: any) {
      console.log(`Tenant collection "${col}" error: ${e.message}`);
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
