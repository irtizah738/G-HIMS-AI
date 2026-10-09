# Confirmed mock-patient retirement: read-only reconciliation

## Scope and safety

This runbook applies only to the two explicitly confirmed development mock identities:

- \`MRN-20260820-8790\`
- \`MRN-20260930-3611\`

The inspector does **not** change Firestore, clinical state, invoices, beds, queues, audit history, or projections. It must be executed by an authorized operator against an isolated **TEST/DEMO** Firebase project. Do not run against production, staging, a database containing real patients, or shared hospital environments.

## Before inspecting

1. Verify \`FIREBASE_PROJECT_ID\` and \`GHIMS_FIREBASE_PROJECT_ID_TEST\` (or DEMO), and confirm they are the same intended isolated test project.
2. Verify \`GHIMS_FIREBASE_PROJECT_ID_PRODUCTION\` is set to the **different** production project ID.
3. Verify the correct tenant ID from authenticated hospital context.
4. Ensure the local server credentials belong to the selected test project. Do not paste private keys, service account JSON, Firebase tokens or patient data into tickets or chats.
5. Do **not** enable \`GHIMS_ENABLE_CONFIRMED_MOCK_CLEANUP\` simply to inspect records.

## PowerShell (from repository root)

~~~powershell
$env:GHIMS_RUNTIME_MODE = 'TEST'
$env:NODE_ENV = 'development'
$env:GHIMS_MOCK_INSPECTION_TENANT_ID = 'YOUR_VERIFIED_TEST_TENANT_ID'
$env:GHIMS_MOCK_INSPECTION_MRN = 'MRN-20260820-8790'
$env:GHIMS_MOCK_INSPECTION_CONFIRM_PROJECT = 'YOUR_EXACT_VERIFIED_TEST_FIREBASE_PROJECT_ID'

bun scripts/ops/inspect-mock-retirement.ts
~~~

Repeat using \`MRN-20260930-3611\` only after checking the first report. Project/tenant values must be real, verified, already configured and allowlisted. The command uses server-side Admin credentials and never prompts for them.

## What to review

- \`patientId\`, \`tenantId\`, \`projectId\`, and \`version\` match the record involved in the failing action.
- Pointer **types** as well as their values: an \`activeTelehealthEncounterIds\` value of the string \`"[]"\` is **not** an empty array.
- \`encounters\` contains only confirmed OPD synthetic test episodes, and all referenced encounter IDs resolve.
- No \`beds\` document refers back to this patient via either \`patientId\` or \`currentPatientId\`.
- \`invoices\`, \`encounterCharges\`, \`payments\`, consultation invoice lookups and \`opd_queue\` references are reviewed.
- Any \`BOUNDED_QUERY_EXCEEDED\` result means the report is incomplete; do not infer safety from an incomplete scan.

The inspector reads **directly from Firestore**. A TEST/DEMO server can have an in-process ephemeral state overlay that takes precedence over Firestore for the same tenant. If Firestore is clean but the retirement command still rejects, note the updated error's \`Read source\` and exact blocking field names. In-process ephemeral state cannot be examined from a different process; resolve the active process, verify the session/tenant/project, and investigate its original test seed rather than modifying Firestore.

## Reconciliation decision

1. **Non-OPD clinical encounter or active bed:** do not retire. Use authorized clinical/bed workflows and verify actual lifecycle evidence.
2. **Orphaned pointer:** investigate event and audit provenance, source encounter, and version. Design a version-checked audited repair only after confirming there is no active clinical care.
3. **Financial links:** use financial reconciliation, never delete or overwrite receipts/invoices to make cleanup pass.
4. **Eligible confirmed mock OPD-only care:** the existing \`RetireConfirmedMockPatientCommand\` is the only administrative retirement path. It still requires all its server-side gates and an explicit operator reason/confirmation. It does not fabricate clinical discharge.

Keep the raw report in a restricted operational evidence location. Share only its non-sensitive blockers and scope metadata for support.
