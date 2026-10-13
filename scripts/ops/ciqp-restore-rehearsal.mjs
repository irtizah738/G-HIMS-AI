#!/usr/bin/env node
/**
 * CIQP-182: explicitly authorized synthetic STAGING export -> isolated RESTORE.
 *
 * DRY_RUN is the default and performs no cloud operations. APPLY_RESTORE
 * requires a named operator/change ticket and independently retained evidence
 * that the destination is disposable and empty. The source/prod projects are
 * never modified. A live read-only Firestore inventory prevents importing
 * into a target with visible existing root collections.
 *
 * The inventory does NOT authenticate the signed attestation, rule out every
 * possible concurrent writer, or substitute for independent restore review.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/i;

export function assertCiqpRestoreScope(env) {
  const source = String(env.GHIMS_CIQP_RESTORE_SOURCE_STAGING || '').trim();
  const production = String(env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION || '').trim();
  const destination = String(env.GHIMS_CIQP_RESTORE_DESTINATION_PROJECT || '').trim();
  const gcs = String(env.GHIMS_CIQP_RESTORE_EXPORT_URI || '').trim();
  const mode = String(env.GHIMS_CIQP_RESTORE_MODE || 'DRY_RUN').trim();
  const databaseId = String(env.GHIMS_CIQP_RESTORE_DATABASE_ID || '(default)').trim();

  if (
    env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
    Boolean(env.VERCEL) ||
    Boolean(env.FIRESTORE_EMULATOR_HOST) ||
    Boolean(env.FIREBASE_AUTH_EMULATOR_HOST) ||
    !source || !production || !destination ||
    source === production || source === destination || source === 'g-hims-ai' ||
    destination === production || destination === 'g-hims-ai' ||
    !/^[a-z][a-z0-9-]{4,62}$/.test(source) ||
    !/^ciqp-[a-z0-9-]*restore[a-z0-9-]*$/.test(destination) ||
    env.GHIMS_FIREBASE_PROJECT_ID_STAGING !== source ||
    env.GHIMS_CIQP_RESTORE_CONFIRM_DESTINATION !== destination ||
    env.GHIMS_CIQP_RESTORE_CONFIRM_SOURCE !== source ||
    env.GHIMS_CIQP_RESTORE_SYNTHETIC_ACK !== 'SYNTHETIC_ONLY_INDEPENDENT_RESTORE' ||
    !/^gs:\/\/[a-z0-9._-]+\/[a-zA-Z0-9_./-]+$/.test(gcs) ||
    gcs.includes('..') ||
    !/^[a-zA-Z0-9()_-]{1,64}$/.test(databaseId) ||
    !['DRY_RUN', 'APPLY_RESTORE'].includes(mode)
  ) throw new Error('CIQP_RESTORE_ISOLATION_DENIED');

  if (mode === 'APPLY_RESTORE' && (
    env.GHIMS_CIQP_RESTORE_APPLY_ACK !== 'AUTHORIZED_RESTORE_TO_EMPTY_SYNTHETIC_PROJECT' ||
    !/^RESTORE-[A-Z0-9-]{8,80}$/.test(env.GHIMS_CIQP_RESTORE_TICKET || '') ||
    !/^[a-zA-Z0-9_.@-]{6,100}$/.test(env.GHIMS_CIQP_RESTORE_OPERATOR_ID || '') ||
    !SHA256.test(env.GHIMS_CIQP_RESTORE_EMPTY_TARGET_ATTESTATION_SHA256 || '')
  )) throw new Error('CIQP_RESTORE_APPROVAL_NOT_PRESENT');

  return { source, production, destination, gcs, databaseId, mode };
}

function checkedGcloud(run, args, errorCode) {
  const result = run('gcloud', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(errorCode);
  }
  return result.stdout;
}

/**
 * Live, read-only empty-destination preflight. Run with a single isolated
 * operator identity that can both inspect and import into the restore target.
 */
export async function assertEmptyRestoreTarget(s, run = spawnSync, request = fetch) {
  const metadataText = checkedGcloud(run, [
    'firestore', 'databases', 'describe',
    '--project=' + s.destination,
    '--database=' + s.databaseId,
    '--format=json',
    '--quiet',
  ], 'CIQP_RESTORE_DESTINATION_UNVERIFIED');

  let metadata;
  try { metadata = JSON.parse(metadataText); } catch {
    throw new Error('CIQP_RESTORE_DESTINATION_UNVERIFIED');
  }
  if (metadata?.name !== 'projects/' + s.destination + '/databases/' + s.databaseId) {
    throw new Error('CIQP_RESTORE_DESTINATION_UNVERIFIED');
  }

  const token = checkedGcloud(run, [
    'auth', 'print-access-token', '--quiet',
  ], 'CIQP_RESTORE_INVENTORY_UNAUTHORIZED').trim();
  if (!token || /\s/.test(token)) {
    throw new Error('CIQP_RESTORE_INVENTORY_UNAUTHORIZED');
  }

  const url = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(s.destination) + '/databases/' +
    encodeURIComponent(s.databaseId) + '/documents:listCollectionIds';
  try {
    const response = await request(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pageSize: 100 }),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('READ_DENIED');
    const result = await response.json();
    // Unexpected schema, any root collection, or a remaining page means
    // the database is not independently verified empty.
    if (!result || typeof result !== 'object' ||
        (result.collectionIds !== undefined && !Array.isArray(result.collectionIds)) ||
        (result.collectionIds?.length || 0) !== 0 ||
        Boolean(result.nextPageToken)) {
      throw new Error('NOT_EMPTY');
    }
  } catch {
    throw new Error('CIQP_RESTORE_EMPTY_DESTINATION_PROOF_REQUIRED');
  }
}

export async function runCiqpRestoreRehearsal(env, run = spawnSync, request = fetch) {
  const s = assertCiqpRestoreScope(env);
  console.log(JSON.stringify({
    operation: 'CIQP_SYNTHETIC_RESTORE_REHEARSAL',
    sourceEnvironment: 'ISOLATED_STAGING_SYNTHETIC_ONLY',
    destinationEnvironment: 'SEPARATE_EMPTY_RESTORE_PROJECT',
    mode: s.mode,
    writesToSource: 0,
    productionReleaseAuthority: 'NOT_GRANTED',
  }));
  if (s.mode === 'DRY_RUN') return;

  await assertEmptyRestoreTarget(s, run, request);
  const result = run('gcloud', [
    'firestore', 'import', s.gcs,
    '--project=' + s.destination,
    '--database=' + s.databaseId,
    '--quiet',
  ], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error('CIQP_SYNTHETIC_RESTORE_EXECUTION_FAILED');
  }
  // This confirms only successful invocation. Independent restore counts,
  // immutable event/outbox fingerprints and measured RPO/RTO remain required.
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCiqpRestoreRehearsal(process.env).catch(() => {
    // Never print command output, patient IDs, credentials or signed receipts.
    console.error('CIQP_RESTORE_FAILED_CLOSED');
    process.exitCode = 1;
  });
}
