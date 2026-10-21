# G-HIMS-AI Clinical Intelligence RC1 — isolated staging boundary

**Release stage:** SOURCE PREPARED / CLOUD STAGING NOT YET QUALIFIED.
**Repository:** `irtizah738/G-HIMS-AI` (never merge from G-HIMS-OS).
**Production Firebase:** `g-hims-ai` — **no changes or new deployments**.
**Separate G-HIMS-OS staging Firebase:** `studio-1130431360-48a05` — may not be used by G-HIMS-AI.
**Target data:** fabricated synthetic data only. **Real-patient access prohibited**.

## Current inventory and what is *not* yet established

A Vercel project inventory inspected the connected team. It contains
`g-hims-ai`, `g-hims-os-staging` and `g-hims-os`, but **no dedicated
G-HIMS-AI RC1 staging Vercel project**. A Vercel project list **cannot**
prove that an independent Firebase staging project exists; that must be
checked by the Firebase/GCP owner. There is no verified independent
G-HIMS-AI staging Firebase project, authorized project IAM, Web App
registration, or Auth/App Check configuration in the current evidence.

G-HIMS-AI PR #209 is source-green but **DRAFT**. It does not grant a
hosted migration or permission to create patient encounters. PR #204's
writer remains independent and unapproved for G-HIMS-AI staging.

## What this source PR enforces, without touching cloud configuration

`scripts/ops/staging-preflight.ts` performs a **pure** env assessment;
it imports no Firebase SDK, contacts no network and does not log credentials.
In addition to existing server/browser project, credential, runtime,
disabled-integration and database checks, the stage-only preflight:

- Blocks **the actual G-HIMS-AI production project** `g-hims-ai` from
  occupying any active staging Firebase server, client or comparator role,
  even if other caller-provided comparator IDs have been falsified.
- Blocks the **separate G-HIMS-OS staging project**
  `studio-1130431360-48a05`, including attempts to reuse its Auth,
  Firestore, IAM or browser Web App under the G-HIMS-AI source.
- Requires the stated production comparison baseline to be the official
  `g-hims-ai` project; source CI fixtures use the literal public ID.
- Requires browser Firebase Auth domain and Storage bucket to be
  project-matched to the declared staging project. Default Firebase
  Auth and Firestore/Storage domains are supported; **custom domains
  require independent review**, not an in-code bypass.
- Denies file-based Google application credentials and App Check debug
  mode in Vercel Preview.
- Preserves already required `STAGING` runtime mode, project/database
  equality, role-scoped service-account email and all external integrations
  `DISABLED`.

**Passing this source preflight is only a configuration candidate.** A
matching env string cannot independently verify GCP resource ownership,
service-account IAM, a linked browser web app, synthetic provenance, or
institutional approval.

## Required physical cloud setup — operator-controlled

1. Create or identify a **new independent Firebase/GCP project for
   G-HIMS-AI RC1 staging**, distinct from both named projects above.
   Confirm owning Google Cloud account, budget, project ID and authorized
   change owner. Do not populate with real patients or production exports.
   **Do not guess a project ID or reuse G-HIMS-OS project**.
2. Enable separate Firebase Authentication (staff test identities only),
   Firestore `(default)` and Firebase App Check. Begin with deny-by-default
   client Firestore rules; deploy a source-reviewed least-privilege policy
   only after a hostile-client emulator test and tenant isolation audit.
3. Register its own Firebase Web App and verify **public** project ID,
   Auth domain, API key, Web App ID, Storage bucket and sender ID from
   Firebase Console. Never copy `g-hims-ai` or G-HIMS-OS Web App values.
4. Provision a **staging-project-only** backend principal with only
   capabilities needed for read-only diagnostics. Verify the actual GCP
   principal/IAM binding; an `@<project>.iam.gserviceaccount.com`
   suffix is **not** sufficient proof. Do not share service-account keys
   in GitHub, chat, or screenshots.
5. Before any hosted Preview, have a Vercel owner approve a **dedicated
   G-HIMS-AI RC1 staging project or strictly isolated protected Preview**
   configuration. Production must not automatically deploy changes from
   this source PR. Vercel is not a long-term hosting requirement.
   No existing `g-hims-ai` production env variables may be copied or
   promoted to Preview. Independent staging secrets only; preferably
   short-lived workload identity after separate verification.
6. Require private access, MFA/App Check, minimum clinical/staff role
   directory, explicit synthetic patient tenant, tenant deny probes,
   audit/outbox immutability, and a release owner for incident recovery.
7. Validate `scripts/ops/staging-preflight.ts` or the RC1 candidate
   preflight with the exact deployed Git SHA; output must contain no
   blockers, no writes and **no clinical release authority**. Then check
   the deployed `/api/health/ready` and
   `/api/health/clinical-intelligence` on **G-HIMS-AI staging**, with
   AI/provider still off. Do not infer success from local typecheck or
   a G-HIMS-OS screenshot.
8. Rehearse read-only native G-HIMS-AI Patient 360 and Clinical Copilot
   evidence under two authenticated staging actors; only separately
   approved synthetic commands may be used. Test rejected/missing evidence,
   version fences and cross-tenant privilege denials. Never run CIQP-182
   hosted APPLY until a separate authorized restore/migration procedure
   exists, and never promote real AI-generated output to a signed clinical
   record without clinician authorization.
9. Retain non-secret evidence: dedicated staging project ID, identity
   binding attestation, exact deployment SHA, read-only readiness report,
   emulator/hosted negative test outcomes, backup+restore IDs, RPO/RTO,
   clinician and institutional approvals when applicable, and incident
   rollback owner. Revisit `G-HIMS_PRODUCTION_BLOCKERS.md` only when
   the actual required evidence exists.

## PR release gate

This source PR is **not** an authorization to merge PR #209, alter
`g-hims-ai` production, enable the model, migrate Patient 360, or grant
clinical signing privileges. Keep G-HIMS-AI and G-HIMS-OS source,
Firebase, secrets, patient data and deployment workflows separate.
The next hard dependency is **provisioning and independently identifying
the new Firebase staging project** by the authorized owner.
