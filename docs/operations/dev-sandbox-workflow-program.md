# G-HIMS Development Sandbox — DEV-1 through DEV-5

## Design decision

**Never disable** tenant isolation, HCM/clinical signing authority, patient lifecycle
guards, idempotency, reconciliation, Firestore security rules, or audit/event/outbox.
Development velocity comes from valid **synthetic authority** and **disposable local
Firebase Auth/Firestore emulators**. This is **not** a new hospital runtime mode.
The app continues running existing `GHIMS_RUNTIME_MODE=TEST` with the production
command bus. The sandbox is isolated by a second, strict operator guard.

Production and staging data, including the historical `g-hims-ai` project and
`central-metro-hospital` tenant, are **not** permitted targets.

| Gate | Scope | Acceptance evidence |
|---|---|---|
| DEV-1 | Explicit emulator-only isolation | TEST runtime, exact local project, localhost emulator hosts, dedicated tenant and positive operator acknowledgment; reject every mismatch |
| DEV-2 | Synthetic clinician/financial identities | Firebase Auth emulator users; tenant roles, HCM employee/credentials/privileges/rosters and scoped facility; no admin clinical signing |
| DEV-3 | Non-authoritative external simulation | Deterministic WebRTC/TURN/HL7/DICOM/device/payment-gateway *status* only, marked simulated; no fabricated medical or billing events |
| DEV-4 | Disposable scenario reset | Operator-confirmed tenant-local recursive reset only after validating the sandbox marker and both emulators; re-seed clean starting conditions |
| DEV-5 | Cross-role workflow qualification | Verify fixtures and use real commands for OPD, Telehealth, ER, IPD, billing and MPI; collect event/audit/outbox evidence, negative tests, and deployment parity |

## Prerequisites

Use a **separate terminal** and a separate local emulator instance that is not
being used for other projects. Requirements: Bun, Firebase CLI, Java and Node.
Do not use a GCP service-account JSON file, hosted Firebase credentials, or
production application domain.

### 1. Start local emulators

```powershell
firebase emulators:start --only auth,firestore --project ghims-dev-sandbox-local
```

Use a new terminal for the remaining commands. Avoid emulator import/export
from a real Firebase project.

### 2. Export explicit emulator-only variables

```powershell
$env:GHIMS_RUNTIME_MODE = "TEST"
$env:NODE_ENV = "development"
$env:FIREBASE_PROJECT_ID = "ghims-dev-sandbox-local"
$env:GHIMS_FIREBASE_PROJECT_ID_TEST = "ghims-dev-sandbox-local"
$env:GHIMS_DEV_SANDBOX_TENANT_ID = "dev-sandbox-hospital"
$env:GHIMS_DEV_SANDBOX_ACK = "I_CONFIRM_DISPOSABLE_LOCAL_EMULATORS_ONLY"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
$env:FIRESTORE_DATABASE_ID = "(default)"
$env:GHIMS_DEV_SANDBOX_PASSWORD = Read-Host "Choose an emulator-only password of at least 16 characters"
```

Use an **emulator-only password**; do not reuse production user passwords.

### 3. Provision and verify the synthetic sandbox

```powershell
bun run dev:sandbox:seed
bun run dev:sandbox:verify
bun run dev:sandbox:rehearse
bun run dev:sandbox:test
```

Seed makes eight disposable scenarios, scoped synthetic HCM staff, and a
single synthetic facility. Rehearsal is **read-only**: it checks patient/encounter
relationships and synthetic clinical credentials; it does **not** assert that
clinical or billing workflow commands have passed.

Synthetic login emails (all use the password provided locally):
`admin@ghims-dev-sandbox.invalid`,
`doctor@ghims-dev-sandbox.invalid`,
`reception@ghims-dev-sandbox.invalid`,
`nurse@ghims-dev-sandbox.invalid`,
`billing@ghims-dev-sandbox.invalid`,
`pharmacy@ghims-dev-sandbox.invalid`,
`lab@ghims-dev-sandbox.invalid`.

A doctor receives emulator-only HCM employment, a verified synthetic
credential, explicitly granted `SIGN_CLINICAL_NOTES` and a published roster.
Actual employee privilege and routing requirements are still checked by the
real server. No credential in this sandbox is a real professional license.

### 4. Run G-HIMS locally against the *same* emulator project

In your local Next.js environment (e.g. `.env.local`, never deployed
production settings) configure:

```dotenv
GHIMS_RUNTIME_MODE=TEST
FIREBASE_PROJECT_ID=ghims-dev-sandbox-local
GHIMS_FIREBASE_PROJECT_ID_TEST=ghims-dev-sandbox-local
GHIMS_DEV_SANDBOX_TENANT_ID=dev-sandbox-hospital
GHIMS_DEV_SANDBOX_ACK=I_CONFIRM_DISPOSABLE_LOCAL_EMULATORS_ONLY
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_DATABASE_ID=(default)
NEXT_PUBLIC_GHIMS_RUNTIME_MODE=TEST
NEXT_PUBLIC_FIREBASE_PROJECT_ID=ghims-dev-sandbox-local
NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST=ghims-dev-sandbox-local
NEXT_PUBLIC_FIRESTORE_DATABASE_ID=(default)
NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS=true
```

The public Firebase API key/app ID can use **synthetic local emulator values**;
never copy a hosted project's credentials or expose a TURN REST shared secret.
The browser emulator switch refuses non-TEST modes, non-localhost pages and
other Firebase project IDs. Start the frontend locally with `bun dev`.
Server env variables above must also be provided to the Next.js process.
**Do not deploy with** `NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS=true`.

### 5. Disposable reset

This permanently erases only the dedicated *local emulator tenant*, including
its local workflow history. Never use reset for clinical data reconciliation.

```powershell
$env:GHIMS_DEV_SANDBOX_RESET_ACK = "RESET_DISPOSABLE_EMULATOR_TENANT"
bun run dev:sandbox:reset
bun run dev:sandbox:seed
bun run dev:sandbox:verify
```

Reset requires an existing `syntheticOnly=true`, `environment=TEST` tenant
with the exact sandbox marker, local Auth and Firestore emulator hostnames,
the exact project and tenant IDs, and a separate reset acknowledgment. Auth
users are deleted only by deterministic `dev-sandbox-*` UID after verifying
the `.invalid` sandbox email address.

## Workflow matrix (manual/deployed qualification still outstanding)

| Scenario | Starting fixture | Real workflow to test / expected result |
|---|---|---|
| MPI identity | One synthetic MRN, no encounters | Exact MRN lookup in Consultation and standalone MPI returns same patient ID; no duplicate registration |
| OPD registration | Consent-ready synthetic patient | Reception creates a real OPD encounter and queue; consultation cannot proceed until the true payment gate |
| OPD consultation | Open synthetic OPD encounter | Synthetic signed clinician creates a real note; server audits signature and completes disposition |
| Telehealth unused | Unsigned, unused encounter | Authorized cancellation only; must not sign a fake SOAP note; patient active-care pointer reconciles |
| Telehealth completed | Completed fixture, no active pointer | Both MPI screens report terminal history without implying an active encounter. This fixture is a display test, not evidence signing succeeded |
| Emergency | Active synthetic ER encounter | Record vitals, handoff, ER disposition through command authority |
| IPD | Active synthetic admission and bed | Clinical observations + bed authority; discharge only with valid clinical workflow |
| Billing | OPD open, no payment | Create genuine sandbox invoice/receipt, reconcile ledger and clear billing. Do not pre-mark as paid |

Use the same tenant, facility, role and MRN in both user interfaces. Test
withdrawing a doctor's privilege, cross-tenant access, interrupted network,
duplicate idempotency keys, stale pointers and clinical-activity cancellation
rejections. Confirm exact audit/event/outbox receipts for executed commands.
A successful *seed* or *rehearsal* is **not** an end-to-end workflow PASS.

## External dependency simulation policy

`simulateSandboxExternalSystem` in
`lib/dev-sandbox/external-system-simulator.ts` models only named external
status outcomes (AVAILABLE/TIMEOUT/REJECTED). It is gated by the same emulator
guard, does not write Firestore, and never asserts a real video call, paid
invoice, HL7 ACK or diagnostic result. Any future simulated adapter must be
explicitly labeled in the UI and forbidden in staging/production.

## Release policy

1. All isolation and source-security tests pass.
2. Actual emulator command-driven scenarios pass, including negative controls.
3. A separate synthetic-only staging qualification replays workflows without
   emulator-only simulators.
4. Hospital-0 never uses the emulator reset, fixture identities or simulated
   external integrations.
5. Keep DEV work separate from the G-HIMS Clinical Intelligence pilot/fundraising
   qualification. Development convenience is not evidence of clinical readiness.

**Status at implementation:** the repository provisions and structurally
rehearses sandbox fixtures. It does **not** provision a live GCP Firebase
project, execute all eight command-driven workflows automatically, or certify
production use. Those are tracked qualification follow-ups, not assumed green.
