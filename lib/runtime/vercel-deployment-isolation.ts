/**
 * Fail closed before Firebase Admin initialization when hosted Vercel
 * deployment targets do not match their independently configured authority.
 * This pure check makes no network calls and never reads credential values.
 *
 * Preview qualification is not production authority. A preview must never
 * connect to the PRODUCTION Firebase project even if GHIMS_RUNTIME_MODE
 * has been accidentally set to PRODUCTION.
 */
export function assertVercelDeploymentFirebaseIsolation(
  env: NodeJS.ProcessEnv,
  activeProjectId: string
): void {
  const target = String(env.VERCEL_ENV || '').trim().toLowerCase();
  if (target !== 'preview' && target !== 'production') return;

  const mode = String(env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
  const productionProject = String(env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION || '').trim();
  const stagingProject = String(env.GHIMS_FIREBASE_PROJECT_ID_STAGING || '').trim();
  const active = String(activeProjectId || '').trim();

  if (target === 'preview') {
    if (!productionProject || !active || active === productionProject ||
        mode === 'PRODUCTION') {
      throw new Error('VERCEL_PREVIEW_PRODUCTION_FIREBASE_BLOCKED');
    }
    if (mode !== 'STAGING' || !stagingProject || active !== stagingProject ||
        stagingProject === productionProject) {
      throw new Error('VERCEL_PREVIEW_STAGING_ISOLATION_NOT_VERIFIED');
    }
    // A Preview Admin credential must be project-scoped. A production
    // service account must never be imported into a staging preview.
    const email = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
    if (email && !email.endsWith('@' + stagingProject + '.iam.gserviceaccount.com')) {
      throw new Error('VERCEL_PREVIEW_ADMIN_IDENTITY_NOT_STAGING');
    }
  }
  if (target === 'production') {
    if (mode !== 'PRODUCTION' || !productionProject ||
        active !== productionProject) {
      throw new Error('VERCEL_PRODUCTION_FIREBASE_ISOLATION_NOT_VERIFIED');
    }
  }
}
