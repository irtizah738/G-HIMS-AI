import { getAdminAuth } from '../server/firebase/admin';

async function main() {
  const auth = getAdminAuth();
  if (!auth) return;

  const users = await auth.listUsers(50);
  for (const u of users.users) {
    console.log(`${u.email}: passwordHash = ${u.passwordHash ? 'SET' : 'NOT SET'}, providers = ${u.providerData.map(p => p.providerId).join(',')}`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
