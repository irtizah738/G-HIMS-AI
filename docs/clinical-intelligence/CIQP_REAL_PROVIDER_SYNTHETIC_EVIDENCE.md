# CIQP — Real-provider synthetic evidence capture (operator-only)

**Status: execution tooling, not an observed model result or clinical validation.**

This operator-only qualification runs the real configured AI gateway against one canonical synthetic OPD registration, freezes a Patient 360 evidence snapshot, and records the persisted CI-10H safety decision. It must never run against hosted Firebase or real patient data.

## Required environment

The following values are mandatory and explicitly checked before any model invocation:

- Runtime mode and public runtime mode: TEST
- All four server/public test project identifiers: ghims-dev-sandbox-local
- Sandbox tenant ID: dev-sandbox-hospital
- Sandbox acknowledgement: I_CONFIRM_DISPOSABLE_LOCAL_EMULATORS_ONLY
- Client emulator flag: true
- Firebase Auth Emulator: 127.0.0.1:9099
- Firestore Emulator: 127.0.0.1:8080; server/public Firestore database: (default)
- GHIMS_INTEGRATION_AI_STATE: LIVE (only in the guarded local TEST process)
- GHIMS_AI_PROVIDER: google-genai
- GHIMS_AI_MODEL: explicit, version-frozen provider model
- GHIMS_AI_APPROVED_MODELS: list containing the exact model
- GEMINI_API_KEY: private valid key loaded outside version control
- CIQP_QUALIFIED_COMMIT_SHA: exact 40-character output of git rev-parse HEAD
- CIQP_LIVE_MODEL_ACK: I_CONFIRM_REAL_MODEL_SYNTHETIC_EMULATOR_ONLY
- GHIMS_DEV_SANDBOX_PASSWORD: private generated password (at least 16 characters)
- CIQP_SYNTHETIC_REPORT_PATH: new filename inside the host system temporary directory

The guard rejects GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PRIVATE_KEY, FIREBASE_SERVICE_ACCOUNT_KEY, VERCEL, hosted projects and CI=true. Do not use production API keys intended for PHI processing. The report is created exclusively with mode 0600 and non-overwriting writes.

## Controlled execution

Freeze the repository SHA and provider model first. With the mandatory environment loaded in a private, untracked shell, use one Firebase emulators:exec process (Auth + Firestore, project ghims-dev-sandbox-local) to execute these commands in order:

1. bun run dev:sandbox:seed
2. bun scripts/ci/seed-synthetic-clinician-browser-patient.ts
3. bun scripts/ops/ciqp-live-model-synthetic-evidence.ts

Run all three inside the SAME disposable emulator session. The original sandbox seed refuses overwriting an existing tenant. Never run against a hosted database or reset hosted patient data.

## Evidence contract

The locally stored report includes the exact commit, model, provider, frozen snapshot ID/hash and revision/checkpoint, model-generated synthetic text and cited claims, structural safety decision and finding codes. It always records PENDING_INDEPENDENT_CLINICIAN_REVIEW and clinicallyValidated=false.

A model/provider failure, blocked safety gate, or replay mismatch fails closed with a nonzero exit code. Successful structural evaluation does not create a signed clinical document and does not count as a passed clinical performance study. The command prints no generated clinical text or API key.

## Clinical evaluation remains open

Refer to CLINICAL_EVALUATION_PROTOCOL.md and RETROSPECTIVE_VALIDATION_RUNBOOK.md. This one synthetic basic-OPD case cannot measure deterioration recall, temporal misattribution, medication discrepancy sensitivity or false-alert rates. The next step requires clinician-designed adversarial synthetic cases and properly approved de-identified retrospective cases with two independent qualified clinicians and third-party adjudication of disagreements. Do not reuse fixed 120-case benchmark labels as observed model performance.
