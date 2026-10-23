# G-HIMS Clinical Validation & Review Workspace — Stage 1

**Status: DRAFT / TEST-emulator-only / synthetic-only. Not a clinical release, patient-care workflow, or institutional approval system.**

## URL

After a TEST-environment build and sign-in, open:

\`/<tenant-id>/clinical-validation\`

The tenant shell also shows a "Clinical validation" navigation link in TEST only. Production and staging application environments do **not** expose this workflow as an available review tool; every server request requires both server and public runtime to equal \`TEST\` **and** an active Firestore emulator. Do not point it at any production Firebase project.

## What this first slice implements

1. A tenant coordinator (explicit **SYSTEM_ADMIN** or **HOSPITAL_ADMIN** role **and CLINICAL_VALIDATION_ADMIN permission**) initializes a **fixed three-case synthetic rehearsal**, assigning exactly two distinct primary clinical reviewer Firebase UIDs and one distinct adjudicator UID. A coordinator cannot assign their own UID to these roles.
2. Reviewers log in via normal G-HIMS authenticated and device/session-checked access. They require a DOCTOR / CONSULTANT / ATTENDING_PHYSICIAN role, explicit **CLINICAL_VALIDATION_REVIEW** permission, and at least one active server-derived canonical-HCM clinical privilege. No self-declared role or browser-provided privilege is accepted.
3. Reviewers see only assigned synthetic case facts and select cited evidence, YES / NO / INSUFFICIENT_EVIDENCE, confidence, reasoning and a typed attestation. Results are created immutably in tenant-scoped server Firestore collections. The same reviewer cannot revise or repeat a submission.
4. A separate assigned adjudicator is shown the two submitted independent assessments **only after both exist**. Prior to that, the adjudicator cannot submit. Primary reviewers never receive the other reviewer's judgment through this API. Coordinators see case-completion status but no protected primary ratings before lock.
5. Each assignment or submission creates an atomic server-side domain event and audit record. Direct Firestore client access to validation cases and assessments is forbidden in \`firestore.rules\`.

**No automated AI generation or scoring runs inside the workspace.** No patient identifiers, clinic records, protected health information, free-form case uploads, or model predictions may be imported through the interface. Case source hashes protect against accidental mutation of the curated fixture. The three cases are an **engineering demo**, not the 120-case blinded clinical cohort or medical validation.

## Authorized pilot checklist

- Create an isolated **TEST** Firebase Auth + Firestore emulator project and log in on a TEST application runtime. Do not use \`g-hims-ai\` production or the separate G-HIMS OS repository.
- In TEST, provision the two review users and an independent adjudicator, and verify each person's HCM employee/credential/clinical-privilege chain and tenant membership. Explicitly grant the special review permission; do not grant all permissions to clinical reviewers.
- Separately provision a coordinator with explicit admin role and \`CLINICAL_VALIDATION_ADMIN\` permission (or properly scoped server-provisioned wildcard).
- Coordinator creates three assignments using Firebase Auth UIDs. The UI does not assign credentials or manufacture authorization.
- Have the two primary users review independently, verify the second user's answers remain hidden, then have the adjudicator finish. Verify a duplicate submission and cross-tenant session fail closed. Verify event/audit evidence and ensure no patient-care events were emitted.
- Ensure TEST Firestore rules deny direct reads/writes to the clinicalValidationCases and clinicalValidationAssessments collections, even when a client is authenticated.

## Not yet implemented / not yet qualified

- Import of the 120-case blinded study pack with independently verified pseudonymization, randomized IDs, dataset hash and version lock.
- Actual signed clinical policy approval, institution-specific clinical escalation rules, primary-rater credential verification by an independent study coordinator, real electronic legal signatures, workflow notifications, and pilot-site governance approvals.
- Third-party blinded reference-standard lock, model-output import/unblinding, automated sensitivity / false-alert / critical-omission calculations, and signed final evaluation report.
- Multi-day clinic testing on an approved emulator deployment, adversarial concurrency and revocation scenarios, production clinical validation/retrospective or Hospital-0 qualification.

**Clinical study materials:** use PR #215's renal clinical policy approval and blinded study preregistration. Do **not** run the 120-case study until qualified reviewers approve that clinical protocol. PR #215 and this module are separate draft branches. The same project continues to require release/security approval. The synthetic workspace is not a substitute for sign-off.

## Security notes

- \`CLINICAL_VALIDATION_REVIEW\` / \`CLINICAL_VALIDATION_ADMIN\` are new explicit authorization identifiers. Existing users will receive access **only after an authorized system operator provisions those permissions** in the existing tenant membership system.
- A checkbox/typed attestation represents an actor-linked record, **not** a legally binding cryptographic signature or validated clinician license.
- The 3-case study is initialized only once per tenant and cannot be overwritten from the UI.
- No production environment variables, secrets, Firestore records, or repository main-branch changes are made by the PR.
