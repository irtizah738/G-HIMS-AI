#!/usr/bin/env node
/**
 * CIQP-182 — approved synthetic STAGING -> independent RESTORE project.
 * Never deletes/overwrites source staging or runs against production.
 *
 * Default DRY_RUN only prints redacted operation intent; APPLY_RESTORE calls
 * gcloud firestore import for a pre-existing synthetic export location.
 * Requires separately verified cloud IAM, signed restore authorization,
 * and a fresh independent restore project/database with no other data.
 */
import { spawnSync } from 'node:child_process';

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
    !source || !production || !destination ||
    source === production || source === destination || source === 'g-hims-ai' ||
    destination === production || destination === 'g-hims-ai' ||
    !/^([a-z][a-z0-9-]{4,62})$/.test(source) ||
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
    !/^[a-zA-Z0-9_.@-]{6,100}$/.test(env.GHIMS_CIQP_RESTORE_OPERATOR_ID || '')
  )) throw new Error('CIQP_RESTORE_APPROVAL_NOT_PRESENT');

  return { source, destination, gcs, databaseId, mode };
}

export function runCiqpRestoreRehearsal(env, run = spawnSync) {
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
  const args = [
    'firestore', 'import', s.gcs,
    '--project=' + s.destination,
    '--database=' + s.databaseId,
    '--quiet',
  ];
  const result = run('gcloud', args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error('CIQP_SYNTHETIC_RESTORE_EXECUTION_FAILED');
  }
}

if (import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    runCiqpRestoreRehearsal(process.env);
  } catch {
    console.error('CIQP_RESTORE_FAILED_CLOSED');
    process.exitCode = 1;
  }
}
