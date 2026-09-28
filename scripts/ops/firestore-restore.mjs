#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const mode = String(process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
const databaseId = String(process.env.FIRESTORE_DATABASE_ID || '(default)').trim();
const source = String(process.env.GHIMS_RESTORE_SOURCE || '').trim();
const confirmation = String(process.env.GHIMS_RESTORE_CONFIRM_PROJECT || '').trim();
const allowProduction = String(process.env.GHIMS_ALLOW_PRODUCTION_RESTORE || '').toLowerCase() === 'true';
const dryRun = String(process.env.GHIMS_RESTORE_DRY_RUN || '').toLowerCase() === 'true';

if (!['DEMO','TEST','STAGING','PRODUCTION'].includes(mode)) {
  throw new Error('GHIMS_RUNTIME_MODE must be explicitly set for restore operations.');
}
if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required.');
if (!source.startsWith('gs://')) throw new Error('GHIMS_RESTORE_SOURCE must be a gs:// export URI.');
if (confirmation !== projectId) {
  throw new Error('GHIMS_RESTORE_CONFIRM_PROJECT must exactly match FIREBASE_PROJECT_ID.');
}
if (mode === 'PRODUCTION' && !allowProduction) {
  throw new Error('Production restore is blocked unless GHIMS_ALLOW_PRODUCTION_RESTORE=true.');
}

const configured = String(process.env['GHIMS_FIREBASE_PROJECT_ID_' + mode] || '').trim();
if (mode !== 'TEST' && configured !== projectId) {
  throw new Error('Restore project does not match the configured ' + mode + ' Firebase project.');
}

const args = [
  'firestore',
  'import',
  source,
  '--project=' + projectId,
  '--database=' + databaseId,
];

console.log(JSON.stringify({
  action: 'firestore_restore',
  mode,
  projectId,
  databaseId,
  source,
  dryRun,
}));

if (!dryRun) {
  const result = spawnSync('gcloud', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
