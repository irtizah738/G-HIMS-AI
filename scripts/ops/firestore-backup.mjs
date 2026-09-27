#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const mode = String(process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
const bucket = String(process.env.GHIMS_BACKUP_BUCKET || '').trim();
const databaseId = String(process.env.FIRESTORE_DATABASE_ID || '(default)').trim();
const dryRun = String(process.env.GHIMS_BACKUP_DRY_RUN || '').toLowerCase() === 'true';

if (!['DEMO','TEST','STAGING','PRODUCTION'].includes(mode)) {
  throw new Error('GHIMS_RUNTIME_MODE must be explicitly set for backup operations.');
}
if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required.');
if (!bucket.startsWith('gs://')) throw new Error('GHIMS_BACKUP_BUCKET must be a gs:// bucket URI.');

const configured = String(process.env['GHIMS_FIREBASE_PROJECT_ID_' + mode] || '').trim();
if (mode !== 'TEST' && configured !== projectId) {
  throw new Error('Backup project does not match the configured ' + mode + ' Firebase project.');
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = bucket.replace(/\/$/, '') + '/firestore/' + mode.toLowerCase() + '/' + stamp;
const args = [
  'firestore',
  'export',
  destination,
  '--project=' + projectId,
  '--database=' + databaseId,
];

console.log(JSON.stringify({
  action: 'firestore_backup',
  mode,
  projectId,
  databaseId,
  destination,
  dryRun,
}));

if (!dryRun) {
  const result = spawnSync('gcloud', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
