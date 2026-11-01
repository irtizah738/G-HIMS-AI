/**
 * CI-EXT-07 — governed staging-only registration of a DISABLED Epic source.
 * No imports, approvals, patient links or OAuth token issuance.
 *
 * Never use this against a production project, real patient tenant or emulator.
 * A trusted Cloud Shell operator runs this only AFTER independent change review
 * and copying/verifying the per-source private key.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createGcpFhirPrivateKeyAccessor } from '../../lib/interop/fhir-smart-secret-manager';
import {
  EPIC_STAGING_PROJECT_ID, EPIC_SANDBOX_CLIENT_ID, EPIC_SANDBOX_KID,
  EPIC_SANDBOX_SPKI_SHA256, planEpicSandboxSourceProvision,
} from '../../lib/interop/fhir-epic-source-provision';

async function main(): Promise<void> {
  const projectId = process.env.HELIXIS_CI_EXT07_CONFIRM_PROJECT ?? '';
  const runtime = process.env.GHIMS_RUNTIME_MODE;
  const importedState = process.env.GHIMS_INTEGRATION_FHIR_R4_STATE ?? 'DISABLED';
  const approval = process.env.HELIXIS_CI_EXT07_CONFIRM_REGISTER;
  const actor = (process.env.HELIXIS_CI_EXT07_OPERATOR_ID ?? '').trim();
  const ticket = (process.env.HELIXIS_CI_EXT07_CHANGE_TICKET ?? '').trim();
  if (projectId !== EPIC_STAGING_PROJECT_ID || runtime !== 'STAGING' ||
      process.env.FIREBASE_PROJECT_ID !== projectId ||
      (process.env.DEVSHELL_PROJECT_ID && process.env.DEVSHELL_PROJECT_ID !== projectId) ||
      (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) ||
      process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.VERCEL ||
      importedState === 'LIVE' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED === 'true' ||
      approval !== 'REGISTER_SUSPENDED_EPIC_SOURCE' ||
      !/^[A-Za-z0-9._@-]{3,128}$/.test(actor) ||
      !/^[A-Za-z0-9._-]{8,128}$/.test(ticket)) {
    throw new Error('CI_EXT07_STAGING_REGISTRATION_DENIED');
  }

  const plan = planEpicSandboxSourceProvision({
    projectId,
    tenantId: process.env.HELIXIS_CI_EXT07_TENANT_ID ?? '',
    sourceId: process.env.HELIXIS_CI_EXT07_SOURCE_ID ?? '',
    facilityId: process.env.HELIXIS_CI_EXT07_FACILITY_ID ?? '',
    clientId: EPIC_SANDBOX_CLIENT_ID,
    keyId: EPIC_SANDBOX_KID,
  });

  // Validate the exact source-scoped Secret Manager VERSION 1 key before
  // connecting to Firestore. The key remains server-side and is never printed.
  const getKey = createGcpFhirPrivateKeyAccessor({ projectId });
  const privateKeyPem = await getKey(plan.sourceMetadata.tenantId,
    plan.sourceMetadata.sourceId, 1);
  const publicSpki = createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: 'spki', format: 'der',
  });
  const fingerprint = createHash('sha256').update(publicSpki).digest('hex');
  if (fingerprint !== EPIC_SANDBOX_SPKI_SHA256) {
    throw new Error('CI_EXT07_SOURCE_KEY_FINGERPRINT_MISMATCH');
  }

  const app = initializeApp({ credential: applicationDefault(), projectId },
    'ci-ext07-source-enrollment');
  const db = getFirestore(app);
  const { tenantId, facilityId, sourceId } = plan.sourceMetadata;
  const tenantRef = db.collection('tenants').doc(tenantId);
  const facilityRef = tenantRef.collection('facilities').doc(facilityId);
  const sourceRef = tenantRef.collection('fhirSources').doc(sourceId);
  const eventId = 'cep_' + createHash('sha256')
    .update(JSON.stringify([projectId, tenantId, sourceId, ticket]))
    .digest('hex').slice(0,32);
  const eventRef = tenantRef.collection('fhirProvisioningEvents').doc(eventId);
  const recordedAt = new Date().toISOString();

  await db.runTransaction(async tx => {
    const [tenant, facility, source, previousEvent] =
      await tx.getAll(tenantRef, facilityRef, sourceRef, eventRef);
    if (!tenant.exists || tenant.data()?.syntheticOnly !== true) {
      throw new Error('CI_EXT07_SYNTHETIC_TENANT_REQUIRED');
    }
    const fd = facility.data();
    if (!facility.exists || fd?.tenantId !== tenantId ||
        (fd.syntheticOnly !== true && fd.sandbox !== true)) {
      throw new Error('CI_EXT07_SYNTHETIC_FACILITY_REQUIRED');
    }
    if (source.exists || previousEvent.exists) {
      throw new Error('CI_EXT07_SOURCE_ALREADY_REGISTERED');
    }

    tx.create(sourceRef, plan.sourceMetadata);
    tx.create(eventRef, {
      eventType: 'EPIC_SANDBOX_SOURCE_REGISTERED_SUSPENDED',
      tenantId, facilityId, sourceId, projectId, actorId: actor,
      changeTicket: ticket, credentialRevision: 1,
      sourceKeyFingerprintSha256: fingerprint,
      sourcePath: plan.sourceDocumentPath,
      sourceState: 'SUSPENDED',
      securityReviewState: 'PENDING',
      recordedAt, immutable: true,
      qualifiedForProduction: false,
    });
  });
  process.stdout.write('CI_EXT07_SOURCE_REGISTERED=SUSPENDED\n' +
    'CI_EXT07_SECURITY_REVIEW=PENDING\n' +
    'CI_EXT07_KEY_FINGERPRINT=PASS\n' +
    'CI_EXT07_IMPORT_ENABLED=NO\n' +
    'CI_EXT07_AUDIT_EVENT=' + eventId + '\n');
}

main().catch(e => {
  const code = e instanceof Error && /^CI_EXT07_[A-Z0-9_]+$/.test(e.message)
    ? e.message : 'CI_EXT07_REGISTRATION_UNAVAILABLE';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
});
