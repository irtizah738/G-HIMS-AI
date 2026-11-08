<#
  Stages ONLY G3-G8 qualification files for local review. No remote calls.
  Use -CreateCommit to explicitly create a local commit AFTER reviewing the diff.
#>
param([switch]$CreateCommit)
$ErrorActionPreference = 'Stop'
$Repo = Join-Path $HOME 'Helixis-G3-G8-Worktree'
if (-not (Test-Path -LiteralPath $Repo -PathType Container)) { throw 'REPO_NOT_FOUND' }
Set-Location -LiteralPath $Repo
if ((git branch --show-current).Trim() -ne 'feat/helixis-g3-g8-offline') { throw 'WRONG_BRANCH' }
$Origin = (& git config --get remote.origin.url).Trim()
if ($LASTEXITCODE -ne 0 -or $Origin -notmatch 'irtizah738/G-HIMS-AI(\.git)?$') {
  throw 'WRONG_REPOSITORY_ORIGIN'
}
$ExistingStaged = @(git diff --cached --name-only)
if ($LASTEXITCODE -ne 0 -or $ExistingStaged.Count -ne 0) {
  throw 'PREEXISTING_STAGED_CHANGES_REVIEW_MANUALLY'
}
$Trans = '.tmp/g3g8-stage-e/one-go-transcript.txt'
if (-not (Test-Path -LiteralPath $Trans -PathType Leaf)) { throw 'QUALIFICATION_TRANSCRIPT_MISSING' }
$Content = [System.IO.File]::ReadAllText((Join-Path (Get-Location) $Trans))
if (-not $Content.Contains('STAGE_H_ONE_GO=PASS_LOCAL_ONLY') -or
    -not $Content.Contains('G3_STAGE_H_HOSTED_BOUNDARY_CONTRACT=PASS') -or
    -not $Content.Contains('FHIR_FIRESTORE_EMULATOR=PASS') -or
    -not $Content.Contains('PRODUCTION_RELEASE=NO_GO')) {
  throw 'LATEST_QUALIFICATION_NOT_PASSING'
}
$Paths = @(
  'firestore.rules',
  '.github/workflows/helixis-g3-g8-offline-qualification.yml',
  'lib/clinical/intelligence/external-fhir-g3-g8-qualification.ts',
  'lib/clinical/intelligence/external-fhir-poll-manifest-seal.ts',
  'lib/clinical/intelligence/external-fhir-poll-manifest-store.ts',
  'lib/clinical/intelligence/external-fhir-poll-checkpoint-policy.ts',
  'lib/clinical/intelligence/external-fhir-poll-atomic-checkpoint.ts',
  'lib/clinical/intelligence/external-fhir-poll-recovery-guard.ts',
  'lib/clinical/intelligence/external-fhir-poll-migration-rehearsal.ts',
  'lib/clinical/intelligence/external-fhir-poll-multi-recovery.ts',
  'lib/clinical/intelligence/external-fhir-poll-multi-rehearsal.ts',
  'lib/clinical/intelligence/external-fhir-poll-vendor-cursor.ts',
  'lib/clinical/intelligence/external-fhir-poll-hosted-boundary.ts',
  'lib/clinical/intelligence/external-fhir-synthetic-poll-runner.ts',
  'scripts/ops/helixis-g3-g8-one-go.ps1',
  'scripts/ops/helixis-g3-g8-offline-readiness.mjs',
  'scripts/ops/helixis-g3-g8-ci-emulator.mjs',
  'scripts/ops/helixis-g3-g8-stage-for-review.ps1',
  'emulator-security/helixis-fhir-persistent-manifest.test.ts',
  'emulator-security/helixis-fhir-migration-rehearsal.test.ts',
  'emulator-security/helixis-fhir-multi-page-recovery.test.ts',
  'tests/external-fhir-g3-g8-qualification.test.mjs',
  'tests/external-fhir-poll-manifest-seal.test.mjs',
  'tests/external-fhir-poll-atomic-checkpoint.test.mjs',
  'tests/external-fhir-poll-recovery-guard.test.mjs',
  'tests/external-fhir-poll-multi-recovery.test.mjs',
  'tests/external-fhir-poll-vendor-cursor.test.mjs',
  'tests/external-fhir-poll-hosted-boundary.test.mjs',
  'docs/operations/HELIXIS_G3_STAGE_C_SEALED_MANIFEST.md',
  'docs/operations/HELIXIS_G3_STAGE_D_ATOMIC_CHECKPOINT.md',
  'docs/operations/HELIXIS_G3_STAGE_E_MIGRATION_RECOVERY.md',
  'docs/operations/HELIXIS_G3_STAGE_F_MULTI_PAGE_RECOVERY.md',
  'docs/operations/HELIXIS_G3_STAGE_G_VENDOR_CURSOR_WITNESS.md',
  'docs/operations/HELIXIS_G3_STAGE_H_INTEGRATION_READINESS.md',
  'docs/operations/HELIXIS_G3_G8_OFFLINE_QUALIFICATION.md',
  'docs/operations/HELIXIS_G3_G8_OFFLINE_DOSSIER_TEMPLATE.json'
)
foreach ($Path in $Paths) {
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    & git add -- $Path
    if ($LASTEXITCODE -ne 0) { throw "GIT_ADD_FAILED_$Path" }
  }
}
& git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'STAGED_DIFF_WHITESPACE_ERROR' }
& git diff --cached --stat
if ($LASTEXITCODE -ne 0) { throw 'STAGED_DIFF_STAT_ERROR' }
Write-Host 'STAGE_H_REVIEW_STAGED=PASS'
Write-Host 'PRODUCTION_RELEASE=NO_GO'
if ($CreateCommit) {
  & git commit -m 'test(helixis): consolidate G3-G8 offline qualification through Stage H'
  if ($LASTEXITCODE -ne 0) { throw 'LOCAL_COMMIT_FAILED' }
  Write-Host 'STAGE_H_LOCAL_COMMIT=CREATED_NOT_PUSHED'
} else {
  Write-Host 'STAGE_H_LOCAL_COMMIT=NOT_CREATED_REVIEW_DIFF_FIRST'
}
