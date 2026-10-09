import { getAdminFirestore } from '../server/firebase/admin';

async function main() {
  const db = getAdminFirestore();
  if (!db) return;

  const tenantId = 'central-metro-hospital';
  const tenantRef = db.collection('tenants').doc(tenantId);

  // Sync beds
  const bedsSnap = await db.collection('beds').get();
  console.log(`Copying ${bedsSnap.size} beds to tenant...`);
  for (const doc of bedsSnap.docs) {
    await tenantRef.collection('beds').doc(doc.id).set(doc.data(), { merge: true });
  }

  // Sync telehealth_sessions
  const thSnap = await db.collection('telehealth_sessions').get();
  console.log(`Copying ${thSnap.size} telehealth_sessions to tenant...`);
  for (const doc of thSnap.docs) {
    await tenantRef.collection('telehealthSessions').doc(doc.id).set(doc.data(), { merge: true });
  }

  // Sync billingMismatches
  const bmSnap = await db.collection('billingMismatches').get();
  console.log(`Copying ${bmSnap.size} billingMismatches to tenant...`);
  for (const doc of bmSnap.docs) {
    await tenantRef.collection('billingMismatches').doc(doc.id).set(doc.data(), { merge: true });
  }

  console.log('Sync complete!');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
