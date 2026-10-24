# Official G-HIMS-AI — deployment-qualification handoff

**Status:** NOT DEPLOYMENT-QUALIFIED; engineering source checks and preflight are separate from cloud/clinical acceptance.
**Official repository:** `irtizah738/G-HIMS-AI`.
**Production:** Vercel project `prj_a0TEuNNMAE61UziOoLNTok6Wbp1v`, Firebase `g-hims-ai`.
**Production deployment observed:** `dpl_EkYpdKULnxf6hJ6zS1SbjSKyNW8f`, source `19604ea532ed86bf0f86eb2b4a02dcf0d82c86ad`.
**Reviewed repository main at RC1 construction:** `757e2ac6f98cebe3eed55dff2ee3887b1ec0e1e8`.
**Related PRs:** #207 isolates Preview/Production; #208 contains #207 and the RC1 preflight.
**Staging remains separate:** G-HIMS-OS has its own GitHub repo, Vercel project and Firebase `studio-1130431360-48a05`. Do not merge repositories, share credentials, or use it as G-HIMS-AI's backend without an approved integration plan.

## Immediate operational security controls (must be independently attested)

The G-HIMS-AI Vercel environment audit previously found that Preview active and declared staging Firebase project IDs were set to the production project. Vercel had also shared `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` across Production, Preview and Development. After remediation, the Admin variables are scoped only to Production; Preview active and declared staging IDs contain non-operational placeholders; production identity remains unchanged.

**These Vercel edits DO NOT revoke credentials embedded in older deployments.**
The current GitHub and Vercel tools do not grant verification of Google Cloud IAM key revocation or deletion of old Vercel deployment URLs. The production key must be treated as historically exposed until an authorized GCP administrator verifies its rotation and deactivation.

The named GCP/Vercel owner must:
1. Identify all active and historical G-HIMS-AI Preview deployments with production-capable service account access; retire them or make them inaccessible by deployment-level administrative controls. Preserving SSO alone is NOT sufficient to revoke backend credentials.
2. Generate a new least-privilege production service-account key (or migrate to short-lived identity federation after independent validation). Do not expose JSON, key material or access tokens in GitHub, tickets or ChatGPT.
3. Configure only the Production Vercel secret variables with the replacement credential, and perform a planned, monitored production *configuration redeployment* of an approved **unchanged application source** in a maintenance window; verify liveness, Firestore and Auth connectivity without patient writes.
4. Revoke the old key in Google Cloud. Verify old credential use fails and production readiness is preserved. Record non-secret key ID fingerprints, IAM policy attestation, operator/time, deployment ID and rollback procedure in restricted evidence storage.
5. Verify Preview remains disabled or fail-closed and no Preview/Development target contains production Firebase Admin credentials. Do not enable G-HIMS-AI Preview until the approved isolated backend is provisioned.

A failed rotation or a discovered old active Preview with production credentials **blocks qualification**; do not ignore it because PR CI is green.

## Official RC1 isolated backend (required BEFORE hosted testing)

A qualified operator must create or authorize a dedicated non-production Firebase project for **G-HIMS-AI RC1**, separate from both `g-hims-ai` and the G-HIMS-OS staging data boundary. Minimum evidence:
- Project ID, owning GCP organization, billing/quota budget, separate Firebase Auth, Firestore database and App Check settings
- Public web Firebase config originating from the same staging project: Auth domain, Storage bucket, API key, App ID and sender ID validated by Firebase Console or equivalent
- Dedicated non-production Admin principal bound to that project with verified least privilege; no production credentials or role inheritance
- Private protected Vercel Preview scope, correct `VERCEL_ENV=preview`, explicit server/browser `STAGING` mode and matching declared/ambient Firebase IDs
- External integrations and live model/provider **DISABLED**, synthetic-only tenant and no seeded real patient records
- GitHub exact-source SHA fixed at candidate creation; no unreviewed changes while executing hosted acceptance
- A read-only preflight report with `status=CONFIGURATION_CANDIDATE_ONLY`, plus **independent human approval and cloud configuration verification**. This report cannot prove credential validity, role enrollment, or clinical safety.

The preflight also rejects a Firebase Auth domain or Storage bucket resolving to another Firebase project, even when the active project ID appears isolated. Custom Auth domains or nonstandard buckets require separate explicit review rather than bypassing these checks.

## Deployment and rollback evidence checklist

| Gate | Minimum proof | Closure authority |
| --- | --- | --- |
| Exact release source | GitHub SHA and all checks on that same SHA | Release engineering |
| Isolation | Production/Preview different projects, client config and principal IAM | GCP security owner |
| Historical credential revocation | Old Preview access retired; old key disabled; new key verified | GCP/Vercel owner |
| Hosted Preview | Actual G-HIMS-AI code, Auth and Firestore health, synthetic tenant only | Release engineering + security |
| Recovery | Isolated backup/export, restore, projection parity, RPO/RTO and incident rollback | Operations + clinical safety |
| Patient 360 CIQP-182 | Signed approval of historical migration with restore and clinical data reconciliation | Authorized institutional owners |
| Clinical workflow | Authorized MFA/App Check sessions, evidence provenance, clinician authority, duplicate/replay/tenant/offline denials | Clinical safety and security |
| Production clinical AI | Approved model/provider, processing terms, secrets, quotas and bounded runtime smoke | Institution + product safety |
| Formal production release | Named go/no-go, rollback owner, security signoff, change approval | Authorized institution / release owners |

Until the final clinical gates are approved, **no real patient clinical operation** and no activation of production AI. A synthetic demonstration release must also not be called deployment-qualified until its isolated backend and protected deployed app have been independently proven.

### Immutable source gap

Production was observed on `19604ea`, with GitHub main at `757e2ac`. **Do not merge PR #207 or #208 into main or promote a build automatically** until Vercel's production branch/autodeploy behavior is independently confirmed and a release owner accepts the code delta. Green checks on a newer commit do not qualify the old deployed commit or clinical production.

### Handoff output

When external owners finish their controls, retain a sanitized record of:
- Firebase project identifiers **only**, no private keys
- Retired deployment IDs, not secret URLs containing bypass tokens
- Revoked service-account key IDs/fingerprints and operator/timestamp
- Approved isolated Preview project and principal scope
- Backup/restore and emergency rollback evidence
- Exact G-HIMS-AI commit and GitHub Actions run IDs
- Hospital authorization/clinical signoff separately from GitHub CI

Then run hosted non-authoritative acceptance *when explicitly authorized*. Keep G-HIMS-OS and G-HIMS-AI data, deployment and credentials isolated at all stages.
