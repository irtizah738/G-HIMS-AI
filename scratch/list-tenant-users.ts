import { getAdminFirestore } from '../server/firebase/admin';

async function main() {
  const db = getAdminFirestore();
  if (!db) return;

  const usersSnap = await db.collection('tenants').doc('central-metro-hospital').collection('users').get();
  console.log(`Total users in central-metro-hospital: ${usersSnap.size}`);
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    console.log(`User: ${doc.id} | email: ${data.email} | role: ${data.role} | status: ${data.status}`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
