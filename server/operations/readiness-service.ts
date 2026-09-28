import { getAdminFirestore, hasAdminCredentials } from '@/server/firebase/admin';
import { evaluateCurrentEnvironment, type ReadinessFinding } from '@/lib/runtime/environment-policy';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';

export interface ServiceReadiness {
  ready: boolean;
  mode: string;
  checks: {
    environment: 'PASS' | 'FAIL';
    adminCredentials: 'PASS' | 'FAIL' | 'NOT_REQUIRED';
    firestore: 'PASS' | 'FAIL' | 'NOT_CHECKED';
  };
  findings: ReadinessFinding[];
}

export async function evaluateServiceReadiness(): Promise<ServiceReadiness> {
  const environment = evaluateCurrentEnvironment();
  const mode = getRuntimeMode();
  const productionLike = mode === 'STAGING' || mode === 'PRODUCTION';

  const checks: ServiceReadiness['checks'] = {
    environment: environment.ready ? 'PASS' : 'FAIL',
    adminCredentials: productionLike ? (hasAdminCredentials() ? 'PASS' : 'FAIL') : 'NOT_REQUIRED',
    firestore: 'NOT_CHECKED',
  };

  const findings = [...environment.findings];

  if (productionLike && !hasAdminCredentials()) {
    findings.push({
      code: 'ADMIN_CREDENTIALS_REQUIRED',
      severity: 'BLOCKER',
      message: 'Firebase Admin credentials are required for production-like runtime.',
    });
  }

  if (productionLike && hasAdminCredentials()) {
    const db = getAdminFirestore();
    if (!db) {
      checks.firestore = 'FAIL';
      findings.push({
        code: 'FIRESTORE_ADMIN_UNAVAILABLE',
        severity: 'BLOCKER',
        message: 'Firebase Admin Firestore could not be initialized.',
      });
    } else {
      try {
        // Server-only metadata read; this does not inspect PHI or require a tenant.
        await db.collection('_ghims_operational').limit(1).get();
        checks.firestore = 'PASS';
      } catch {
        checks.firestore = 'FAIL';
        findings.push({
          code: 'FIRESTORE_CONNECTIVITY_FAILED',
          severity: 'BLOCKER',
          message: 'Server could not verify Firestore connectivity.',
        });
      }
    }
  }

  const ready =
    checks.environment === 'PASS' &&
    checks.adminCredentials !== 'FAIL' &&
    checks.firestore !== 'FAIL' &&
    !findings.some((finding) => finding.severity === 'BLOCKER');

  return { ready, mode, checks, findings };
}
