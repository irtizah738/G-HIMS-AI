# G-HIMS AI — RC1 Firebase staging trust-boundary qualification

**Status:** SOURCE-ONLY / HOSTED CLINICAL QUALIFICATION BLOCKED.
**Repository:** `irtizah738/G-HIMS-AI`.
**Production Firebase:** `g-hims-ai`. **Never use for synthetic rehearsal or migration.**
**Separate G-HIMS-OS synthetic staging Firebase:** `studio-1130431360-48a05`. **Never reuse its data, credentials or results to certify G-HIMS AI.**
**Owner constraint:** No additional hosted staging project or third environment is authorized by this source change. The owner's decision not to provision another staging environment remains in force until explicitly revisited.

## What this review adds to RC1

The pure `scripts/ops/staging-preflight.ts` only inspects configuration. It performs **no** network calls, Firebase operations, patient-data reads, or writes. It now:
- rejects the real G-HIMS AI production Firebase project anywhere in active Preview/staging IDs even if a caller falsifies the production comparator;
- rejects the independently operated G-HIMS OS staging Firebase project as G-HIMS AI's backend;
- requires all comparator values to refer to the official production ID;
- rejects mismatched browser Firebase Auth domains and Storage buckets;
- rejects Preview file-based Google credentials and public App Check debug;
- preserves server/client Firestore-project equality, STAGING mode, separate IAM-principal email scope, disabled external integrations, and no release-approval claims.

The source-only CI workflow `.github/workflows/ci-rc1-staging-boundary.yml` exercises synthetic placeholder configuration and TypeScript, without cloud credentials or hosted access. Passing tests are *not* evidence of Auth enrollment, MFA, App Check, IAM privileges, deployed-source equivalence, backup/restore, Patient 360 migration, or clinical safety.

## Scope and environment decision

1. **Proceed now** with source checks and disposable local Firestore/Auth emulators using fabricated synthetic records and no production credentials.
2. **Do not create a new Firebase/Vercel project** or use the G-HIMS-OS Firebase project in response to this PR.
3. Before any G-HIMS AI hosted staging migration or human clinical qualification, a release/security owner must establish and document a genuinely isolated authorized test backend and protection model. This is an **unresolved hosted qualification dependency**, not an invitation to weaken the guard, treat G-HIMS-OS as G-HIMS-AI, or test against production.
4. Do not enable production Clinical Intelligence AI or mutate hosted records. CIQP-182 hosted APPLY requires an independent, explicitly authorized restore/migration procedure and clinician/operator evidence.
5. When a safe hosted qualification route is approved, capture the exact Git SHA, restricted data provenance, cloud/IAM proof, protected source deployment, read-only readiness, MFA/App Check, cross-role and negative tenant tests, event/projection hashes, rollback drills and relevant sign-offs.

**Release decision:** RC1 remains DRAFT. No production merge/deployment and no clinical pilot authorization from this boundary assessment.
