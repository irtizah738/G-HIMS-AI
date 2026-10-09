import { getAdminAuth } from '../server/firebase/admin';

async function main() {
  const auth = getAdminAuth();
  if (!auth) {
    console.error('No admin auth');
    return;
  }

  const email = 'admin@centralmetro.health';
  const user = await auth.getUserByEmail(email);
  console.log('User found:', {
    uid: user.uid,
    email: user.email,
    disabled: user.disabled,
    customClaims: user.customClaims,
    providerData: user.providerData.map(p => ({ providerId: p.providerId, email: p.email })),
    passwordHash: user.passwordHash ? 'SET (length ' + user.passwordHash.length + ')' : 'NOT SET',
  });
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
