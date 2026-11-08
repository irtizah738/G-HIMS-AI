<#
  Helixis G3-G8 offline one-go qualification Stage G, PowerShell 5.1+.
  No gcloud, firebase deploy, network gateway or hosted database commands.
  Only local Firestore emulator, isolated in-memory test fixtures, and synthetic FHIR inputs are permitted.
  This runner fixes the security-suite/emulator environment collision without weakening production authorization.
  Usage (from any location):
    powershell -NoProfile -ExecutionPolicy Bypass -File `
      "$HOME\Downloads\helixis-g3-g8-one-go.ps1"
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = Join-Path $HOME 'Helixis-G3-G8-Worktree'
if (-not (Test-Path -LiteralPath $Repo -PathType Container)) { throw 'HELIXIS_WORKTREE_NOT_FOUND' }
Set-Location -LiteralPath $Repo
$branch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'feat/helixis-g3-g8-offline') { throw 'WRONG_BRANCH_OR_REPO' }
$origin = (& git config --get remote.origin.url).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -notmatch 'irtizah738/G-HIMS-AI(\.git)?$') { throw 'WRONG_REPOSITORY_ORIGIN' }
if (-not (Test-Path 'lib/clinical/intelligence/external-fhir-poll-manifest-seal.ts') -or
    -not (Test-Path 'tests/external-fhir-poll-manifest-seal.test.mjs')) {
    throw 'STAGE_C_FILES_NOT_INSTALLED'
}
if (-not (Test-Path 'node_modules' -PathType Container)) { throw 'DEPENDENCIES_MISSING_RUN_BUN_INSTALL_FIRST' }
foreach ($exe in @('node.exe','bun.exe','firebase.cmd','java.exe')) {
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { throw "DEPENDENCY_MISSING_$exe" }
}
$NodeVersion = (& node.exe --version).Trim()
if ($NodeVersion -match '^v(\d+)\.') {
  $NodeMajor = [int]$Matches[1]
} else { throw 'NODE_VERSION_INVALID' }
if ($NodeMajor -lt 22) { throw 'NODE_22_OR_LATER_REQUIRED' }

$EnvKeys = @(
 'NODE_ENV','GHIMS_RUNTIME_MODE','NEXT_PUBLIC_GHIMS_RUNTIME_MODE',
 'FIREBASE_PROJECT_ID','NEXT_PUBLIC_FIREBASE_PROJECT_ID',
 'GHIMS_FIREBASE_PROJECT_ID_TEST','NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST',
 'GHIMS_INTEGRATION_FHIR_R4_STATE','GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED',
 'GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST',
 'GHIMS_FHIR_EMULATOR_TRACE','GOOGLE_APPLICATION_CREDENTIALS',
 'FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY','client_email','private_key'
)
$Previous = @{}
foreach ($Key in $EnvKeys) { $Previous[$Key] = [Environment]::GetEnvironmentVariable($Key, 'Process') }
$settings = @{
 'NODE_ENV' = 'test'; 'GHIMS_RUNTIME_MODE' = 'TEST';
 'NEXT_PUBLIC_GHIMS_RUNTIME_MODE' = 'TEST';
 'FIREBASE_PROJECT_ID' = 'ghims-p4-ci';
 'NEXT_PUBLIC_FIREBASE_PROJECT_ID' = 'ghims-p4-ci';
 'GHIMS_FIREBASE_PROJECT_ID_TEST' = 'ghims-p4-ci';
 'NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST' = 'ghims-p4-ci';
 'GHIMS_INTEGRATION_FHIR_R4_STATE' = 'DISABLED';
 'GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED' = 'false';
 'GCLOUD_PROJECT' = 'ghims-p4-ci';
 'GOOGLE_CLOUD_PROJECT' = 'ghims-p4-ci';
 'FIRESTORE_EMULATOR_HOST' = '127.0.0.1:8080';
 'GHIMS_FHIR_EMULATOR_TRACE' = 'false'
}
$Suites = @(
 'helixis-external-fhir-import',
 'helixis-external-patient360',
 'helixis-fhir-entered-in-error-projection',
 'helixis-fhir-availability-reconciliation',
 'helixis-fhir-history-integrity',
 'helixis-fhir-source-sync-coordinator',
 'helixis-fhir-synthetic-poll-runner',
 'helixis-fhir-persistent-manifest',
 'helixis-fhir-migration-rehearsal',
 'helixis-fhir-multi-page-recovery'
)
$Generated = New-Object 'System.Collections.Generic.List[string]'
$Passed = New-Object 'System.Collections.Generic.List[string]'
$OutputDir = Join-Path $Repo '.tmp\g3g8-stage-e'
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$TranscriptFile = Join-Path $OutputDir 'one-go-transcript.txt'
$TranscriptStarted = $false
function Invoke-Checked {
  param([string]$Name, [scriptblock]$Command)
  Write-Host "=== $Name ==="
  $priorPreference = $ErrorActionPreference
  $exit = 1
  try {
    $ErrorActionPreference = 'Continue' # PS5.1 native stderr is not a PS exception.
    & $Command
    $exit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $priorPreference }
  if ($exit -ne 0) { throw "$Name=FAIL_EXIT_$exit" }
  $Passed.Add($Name) | Out-Null
  Write-Host "$Name=PASS"
}
try {
  foreach ($Key in $settings.Keys) {
    [Environment]::SetEnvironmentVariable($Key, [string]$settings[$Key], 'Process')
  }
  # Explicitly prevent the TEST process from using local service-account credentials.
  foreach ($CredKey in @('GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL',
                        'FIREBASE_PRIVATE_KEY','client_email','private_key')) {
    [Environment]::SetEnvironmentVariable($CredKey, $null, 'Process')
  }
  Start-Transcript -Path $TranscriptFile -Force | Out-Null
  $TranscriptStarted = $true
  Write-Host "REPOSITORY=$Repo"
  Write-Host "BRANCH=$branch"
  Write-Host "BASE_COMMIT=$(& git rev-parse HEAD)"
  Write-Host 'REAL_GCP_TARGET=DISALLOWED'
  Write-Host 'STAGE_C_TEST_ENCRYPTION=EMULATOR_ONLY'
  Invoke-Checked 'TYPESCRIPT' { bun run typecheck }
  Invoke-Checked 'SOURCE_QUALITY' { bun run lint }
  Invoke-Checked 'FHIR_CONTRACTS' {
    bun test tests/helixis-external-fhir-import.test.ts tests/helixis-fhir-r4-transport-safety.test.ts
  }
  Invoke-Checked 'G3_G8_STAGE_A' {
    node.exe --experimental-strip-types --test tests/external-fhir-g3-g8-qualification.test.mjs
  }
  Invoke-Checked 'G3_STAGE_C_CRYPTO' {
    node.exe --experimental-strip-types --test tests/external-fhir-poll-manifest-seal.test.mjs
  }
  Invoke-Checked 'G3_STAGE_D_CHECKPOINT_POLICY' {
    node.exe --experimental-strip-types --test tests/external-fhir-poll-atomic-checkpoint.test.mjs
  }
  Invoke-Checked 'G3_STAGE_E_RECOVERY_POLICY' {
    node.exe --experimental-strip-types --test tests/external-fhir-poll-recovery-guard.test.mjs
  }
  Invoke-Checked 'G3_STAGE_F_MULTI_RECOVERY_POLICY' {
    node.exe --experimental-strip-types --test tests/external-fhir-poll-multi-recovery.test.mjs
  }
  Invoke-Checked 'G3_STAGE_G_CURSOR_WITNESS_POLICY' {
    node.exe --experimental-strip-types --test tests/external-fhir-poll-vendor-cursor.test.mjs
  }
  Invoke-Checked 'G3_STAGE_H_HOSTED_BOUNDARY_CONTRACT' {
    node.exe --experimental-strip-types --test tests/external-fhir-poll-hosted-boundary.test.mjs
  }
  Invoke-Checked 'FHIR_WAVE4_REGRESSIONS' { bun run test:wave4 }
  # Legacy security/transaction tests are written for the permitted TEST in-memory
  # persistence fallback, not the FHIR Firestore emulator. The previous runner
  # erroneously configured an emulator endpoint BEFORE starting the emulator.
  # That routed legacy tests into an unavailable Firestore instance (timeouts).
  Write-Host 'SECURITY_SUITE_PERSISTENCE=TEST_EPHEMERAL_ISOLATION'
  [Environment]::SetEnvironmentVariable('FIRESTORE_EMULATOR_HOST', $null, 'Process')
  [Environment]::SetEnvironmentVariable('FIREBASE_AUTH_EMULATOR_HOST', $null, 'Process')
  if ($env:GHIMS_RUNTIME_MODE -ne 'TEST' -or $env:FIREBASE_PROJECT_ID -ne 'ghims-p4-ci') {
    throw 'UNSAFE_SECURITY_TEST_RUNTIME'
  }
  Invoke-Checked 'SECURITY_REGRESSIONS_EPHEMERAL' { bun run test:security }
  # Restore Firestore emulator mode ONLY for the actual emulator integration suite.
  [Environment]::SetEnvironmentVariable('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080', 'Process')
  Write-Host '=== BUILD_SYNTHETIC_EMULATOR_TESTS ==='
  foreach ($Name in $Suites) {
    $source = "emulator-security/$Name.test.ts"
    $target = "emulator-security/$Name.node.test.ts"
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "EMULATOR_SOURCE_MISSING_$Name" }
    if (Test-Path -LiteralPath $target) { throw "TEMP_TEST_COLLISION_$Name" }
    $content = [System.IO.File]::ReadAllText((Join-Path $Repo $source))
    if (-not $content.Contains("from 'bun:test'")) { throw "COMPAT_IMPORT_MISSING_$Name" }
    $content = $content.Replace("from 'bun:test'", "from './helixis-node-test-compat'")
    [System.IO.File]::WriteAllText((Join-Path $Repo $target), $content,
      (New-Object System.Text.UTF8Encoding($false)))
    $Generated.Add($target)
  }
  # Compile each suite to its expected location; never reuse stale bundles.
  Invoke-Checked 'EMULATOR_TEST_BUILD' {
    $BuildOutDir = '.tmp/fhir-node'
    New-Item -ItemType Directory -Path $BuildOutDir -Force | Out-Null

    foreach ($Name in $Suites) {
      $Entry = "emulator-security/$Name.node.test.ts"
      $Compiled = "$BuildOutDir/$Name.node.test.js"

      if (Test-Path -LiteralPath $Compiled) {
        Remove-Item -LiteralPath $Compiled -Force
      }

      & bun.exe build $Entry '--target=node' '--format=cjs' `
        '--packages=external' "--outfile=$Compiled"

      if ($LASTEXITCODE -ne 0) {
        throw "EMULATOR_ENTRY_BUILD_FAILED_$Name"
      }

      if (-not (Test-Path -LiteralPath $Compiled -PathType Leaf)) {
        throw "EMULATOR_COMPILED_MISSING_$Compiled"
      }
    }
  }
  $out = @($Suites | ForEach-Object { ".tmp/fhir-node/$_.node.test.js" })
  foreach ($path in $out) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "EMULATOR_COMPILED_MISSING_$path" }
  }
  $run = 'node --test ' + ($out -join ' ')
  Invoke-Checked 'FHIR_FIRESTORE_EMULATOR' {
    firebase.cmd emulators:exec --project ghims-p4-ci --only firestore $run
  }
  Write-Host '=== STAGE H ONE-GO SUMMARY ==='
  Write-Host "PASSING_GROUPS=$($Passed.Count)"
  Write-Host "GROUPS=$($Passed -join ',')"
  Write-Host 'SYNTHETIC_TEST_PROJECT=ghims-p4-ci'
  Write-Host 'GOOGLE_CLOUD_MUTATIONS=NONE'
  Write-Host 'G1_EGRESS_QUALIFICATION=NO_GO'
  Write-Host 'G2_HOSTED_POLL_QUALIFICATION=NO_GO'
  Write-Host 'STAGE_D_PRODUCTION_KMS=NOT_QUALIFIED'
  Write-Host 'SOURCE_FENCED_MIGRATION=NOT_PERFORMED'
  Write-Host 'H0_RESOURCE_ALIAS_DURABLE_MAPPING=REVIEW_REQUIRED'
  Write-Host 'SECURITY_SUITE_PERSISTENCE=TEST_EPHEMERAL_ONLY'
  Write-Host 'PRODUCTION_RELEASE=NO_GO'
  Write-Host 'G3_STAGE_D_ATOMIC_CHECKPOINT=LOCAL_EMULATOR_QUALIFIED'
  Write-Host 'G3_STAGE_E_MIGRATION_DR=LOCAL_REHEARSAL_ONLY'
  Write-Host 'INDEPENDENT_PRODUCTION_RECOVERY_ANCHOR=NOT_QUALIFIED'
  Write-Host 'MULTI_ITEM_RECOVERY=LOCAL_SYNTHETIC_REHEARSAL_ONLY'
  Write-Host 'INDEPENDENT_HOSTED_ANCHOR=NOT_QUALIFIED'
  Write-Host 'VENDOR_CURSOR_CHAIN=LOCAL_SYNTHETIC_REHEARSAL_ONLY'
  Write-Host 'G3_STAGE_F_MULTI_PAGE_RECOVERY=LOCAL_EMULATOR_QUALIFIED'
  Write-Host 'G3_STAGE_G_VENDOR_CURSOR_WITNESS=LOCAL_EMULATOR_QUALIFIED'
  Write-Host 'VENDOR_CURSOR_ORIGIN_AUTHENTICITY=NOT_QUALIFIED'
  Write-Host 'HOSTED_WITNESS_KMS=NOT_QUALIFIED'
  Write-Host 'G3_STAGE_H_HOSTED_BOUNDARY=LOCAL_CONTRACT_ONLY'
  Write-Host 'STAGE_H_HOSTED_KMS=NOT_QUALIFIED'
  Write-Host 'STAGE_H_TRUSTED_CLOCK=NOT_HOSTED_QUALIFIED'
  Write-Host 'STAGE_H_VENDOR_ORIGIN=TEST_FIXTURE_ONLY'
  Write-Host 'STAGE_H_ONE_GO=PASS_LOCAL_ONLY'
} finally {
  foreach ($file in $Generated) {
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
  }
  if ($TranscriptStarted) { Stop-Transcript | Out-Null }
  foreach ($Key in $EnvKeys) {
    [Environment]::SetEnvironmentVariable($Key, $Previous[$Key], 'Process')
  }
}
