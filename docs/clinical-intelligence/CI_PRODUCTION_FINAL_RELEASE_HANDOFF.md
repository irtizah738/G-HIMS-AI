# G-HIMS-AI Clinical Intelligence — production completion handoff

**Checked:** 2026-10-21. **Scope:** `irtizah738/G-HIMS-AI` only.
**Product:** G-HIMS Clinical Intelligence, deployable independently through
hospital integration; G-HIMS-OS remains the separate event-driven infrastructure
and synthetic-only workflow testing system. **No new hosted staging project** is
required for the next *source* milestone. This choice does not make G-HIMS-OS
Firebase, Auth, IAM or its signed-synthetic clinical evidence interchangeable
with official G-HIMS-AI production.

## Observed live release configuration (non-secret)

- GitHub `main` SHA at the audit: `757e2ac6f98cebe3eed55dff2ee3887b1ec0e1e8`.
- Latest Vercel `g-hims-ai` production deployment inspected:
  `dpl_EkYpdKULnxf6hJ6zS1SbjSKyNW8f`, READY, source
  `19604ea532ed86bf0f86eb2b4a02dcf0d82c86ad` (older than `main`).
  **Deployed code and checked source are not aligned.** This is a release
  evidence gap, not proof the live application has a particular defect.
- Official production Firebase: `g-hims-ai`. G-HIMS-OS synthetic staging:
  `studio-1130431360-48a05`; never use it as production, never copy keys,
  documents or rules across projects.
- Current release candidate: draft PR #209, with qualified disposable-emulator
  Patient 360 fixtures. A second draft PR #210 adds an optional *third*
  staging-specific preflight which is **not required** for the chosen
  two-repository path. Do not merge it solely to provision another project.
- Production environment secret *metadata* has Admin credential variables
  scoped to Production, but historical Vercel Preview deployments may retain
  old credentials. Google Cloud IAM key revocation is **not independently
  verified**. The GCP/Vercel owners must verify key rotations and retire
  old production-capable Previews.
- The registered production blocker file is
  `G-HIMS_PRODUCTION_BLOCKERS.md`. No issue there is closed by code or
  a green source workflow alone.

## What can finish safely before hosted release

1. Keep G-HIMS-AI `main` and production deployment unmodified while
   patching source-only production target checks, CI-10F/G evidence test
   coverage, offline/revocation constraints and synthetic emulator CIQP-182
   crash/race/replay tests in individually reviewed PRs.
2. Reconcile #209 against the exact main head; verify complete source
   qualification without disabling checks. Review #210 as a separate
   optional safety-hardening branch and remove assumptions that a new
   hosted staging environment is mandatory for this phase.
3. Verify the intended release commit against the independently deployed
   source SHA, exact Vercel production settings and target Firebase project.
   Never automatically merge to `main` to force Vercel into deploying.
4. Run disposable G-HIMS-AI Firestore emulator clinical journeys:
   canonical patient registration, OPD/nursing vitals, Patient 360
   projection/revision, non-authoritative AI draft, licensed clinician
   review/sign, rejection and duplicate/replay/cross-tenant denials.
   No production IAM, real patient documents or live provider calls.
5. Verify real G-HIMS-AI production `/api/health/ready` and
   `/api/health/clinical-intelligence` only through an explicitly approved,
   read-only production reachability inspection, recording HTTP status,
   policy version and exact deployed SHA. No patient identifiers, PHI,
   browser-only "success", or unauthorized Admin actions.
6. Independently verify historical Preview credential revocation and
   scoped production staff MFA/credentialed HCM authority, monitoring
   alert routing, incident on-call and isolated database export/restore
   with measured RPO/RTO, backup permissions and rollback ownership.
7. CIQP-182 hosted historical migration and clinical/institutional
   sign-off remain distinct external approvals. Emulator green ≠
   migration approved. Don't bypass the existing emulator-only guard.
8. Hospital-0 signed approval, licensed clinicians, privacy terms,
   adjudicated evaluation and security penetration assessment precede
   any real-patient clinical release or live AI enablement.

## Exact deployment go/no-go

Release engineering must present these **independent** artifacts:

| Gate | Required proof | State on 2026-10-21 |
|---|---|---|
| Main/production source | Same approved SHA in GitHub, Vercel and runtime evidence | BLOCKED: version drift |
| Official Firebase target | `g-hims-ai`, production-only; separate from OS stage and emulator | SOURCE CONFIG ONLY |
| Staff identity | Provider-backed MFA, credentialed HCM roles, revocation and device/UID switch | NOT VERIFIED |
| Clinical provenance | Patient 360 source/revision and CI-10F/G edit/review/sign authority with negative test | EMULATOR/SOURCE ONLY |
| Historical Patient 360 | Approved migration/restore with parity, CAS, rollback and clinical sign-off | BLOCKED |
| Recoverability | Real isolated backup/restore, RPO/RTO and rollback rehearsal | BLOCKED |
| Monitoring | Operational alert delivered to named responder | NOT VERIFIED |
| Security | Independent clinical production security assessment and remediation | NOT VERIFIED |
| Hospital authority | Institutional authorization, consent/data governance and supervising clinicians | NOT GRANTED |

**Rule:** Configuration preflight may say `success: true` to indicate *only*
that the target configuration was well-formed. It also reports
`clinicalReleaseAuthorization: NOT_GRANTED`,
`productionDeploymentAuthorization: NOT_GRANTED`,
`sourceCommit: UNVERIFIED` and `deployedCommit: UNVERIFIED` so it cannot
be mistaken for institutional signoff. The actual release decision is
external and requires cross-checked artifacts, not guessed flags.

**Next authorized production change:** a reviewed and independently approved
source release with a planned deployment window and rollback owner. Keep live
AI disabled and use no new patient data until the release gates have evidence.
