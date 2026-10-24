# G-HIMS Clinical Intelligence — official G-HIMS-AI Release Candidate 1

**Candidate stage:** SOURCE QUALIFICATION ONLY, not a clinical release.
**Repository:** `irtizah738/G-HIMS-AI`. Production Firebase `g-hims-ai` is not a demo/test project.
**Production baseline:** G-HIMS-AI `main`, exact SHA required.
**Dependent security fix:** G-HIMS-AI PR #207, Preview/Production target isolation.
**Prohibited:** direct merge of G-HIMS-OS to G-HIMS-AI; Firebase Admin credentials reused between Preview and Production; historical Patient 360 APPLY; live patient testing without hospital authority.

## What is already in the official product source

The G-HIMS-AI repository already provides a Patient 360 Clinical Copilot workspace (CI-10B/C/D/E/G), governed CI-10F drafting, source evidence, clinician edit/approval/signature authority, synthetic flagship demo and safety evaluation harness. The G-HIMS-OS CI-11/12/13/14 hosted synthetic tests qualify **G-HIMS-OS**, not G-HIMS-AI's different codebase or clinical-document signing state machine. Do not map `ACCEPTED_SYNTHETIC` in staging to an authoritative G-HIMS-AI `SIGNED` record.

### Stage A — exact-source synthetic candidate (no database writes)

1. Freeze PR/source SHA. Run G-HIMS-AI's complete `CI Baseline`, `CI Domain Matrix`, `Security Supply Chain`, `CI Qualification`, `CI-10F`, `CI-10G`, `P8`, `P5A`, `P7`, `P0`, DRP and the new RC1 preflight tests; preserve exact Actions run IDs.
2. Validate the code is linked to the official GitHub repository, NOT an OS source Preview masquerading as AI.
3. Inspect active and historical Vercel Preview credentials. Previously built Preview functions retain old environment values. Re-scope Admin credentials to Production only, block future Preview against production, revoke/retire historical unsafe Previews, and rotate previously shared production service-account keys under named GCP owner supervision. Never post key material to GitHub or chats.
4. Restore independent Preview capability only after a **separate authorized non-production Firebase project**, matching API/Auth/App Check config, dedicated Admin credential, isolated seed tenant, and protected Preview hostname are approved. The G-HIMS-OS Firebase project must not be silently treated as a G-HIMS-AI backend without explicit authorization.
5. The pure preflight `bun scripts/ops/ci-rc1-isolated-preflight.ts` accepts `GHIMS_CI_RC1_SOURCE_REPOSITORY=irtizah738/G-HIMS-AI`, `GHIMS_CI_RC1_DATA_CLASS=FABRICATED_SYNTHETIC_ONLY`, `GHIMS_CI_RC1_OPERATION=READ_ONLY_DEMONSTRATION`, `GHIMS_CI_RC1_EXPECTED_SHA=<40-char SHA>`, matching `VERCEL_GIT_COMMIT_SHA`, and `VERCEL_ENV=preview` **only** when the separate existing `staging-preflight.ts` also accepts the actual configuration. Green means CONFIGURATION_CANDIDATE_ONLY; this is not evidence of valid credentials, deployed reachability, qualified signer, hospital approval or production authority.
6. Do not activate AI provider merely to change a status from HTTP 503 to HTTP 200. Any live model test needs an independently approved provider, credentials, quotas, data policy and separate synthetic-only test.

### Stage B — protected hosted demo, governed by qualification evidence

Rehearse from the **deployed G-HIMS-AI SHA** with synthetic-only data and two independently authorized clinical actor sessions. Confirm Patient 360 provenance, evidence source/cursor/revision fences, explicit edit/approve/sign, independent negative/rejected branch, idempotency, tenant isolation, MFA/App Check and offline denial. A CLI synthetic benchmark with fixed label counts is not an observed model accuracy study.

Keep external integrations and clinical orders disabled. Retain sanitized event/audit/receipt cross-checks and no PHI. Capture rollback/downtime instructions and an actual rollback rehearsal.

### Stage C — clinical and production gates

**No real clinical use without:** hospital MOU and protocol, licensed clinical lead, institutional privacy/ethics permissions for actual data, approved provider processing terms, independently adjudicated clinical evaluation, tested incident response, verified recovery/restore evidence, historical Patient 360 policy migration signoff, staff MFA and clinical privileges. The `G-HIMS_PRODUCTION_BLOCKERS.md` register remains authoritative. Production Clinical Intelligence readiness at the last inspected G-HIMS-AI deployment was HTTP 503 with AI disabled; this is a safety hold, not a deployment error to bypass.

### Release ledger

| Gate | Evidence needed | State at RC1 construction |
| --- | --- | --- |
| Preview Firebase project and credential separation | Vercel config audit and independent project IAM | Historical Admin Preview exposure contained for new builds; historical URLs and key rotation pending |
| Official source checks | All workflows green for exact candidate SHA | RUN ON CANDIDATE |
| Protected deployed synthetic AI demo | Exact-SHA readiness + independent authorized actors | NOT QUALIFIED |
| Governed clinician review/negative cases in G-HIMS-AI | Deployed evidence/audit receipts | NOT QUALIFIED |
| CIQP-182 migration and restore | Hosted approved synthetic migration and independently reviewed restore | BLOCKED |
| Provider live AI | Approved provider/model config and synthetic hosted smoke | BLOCKED |
| Hospital-0 supervised validation | Signed MOU, permitted data access, clinical report | NOT QUALIFIED |
| G-HIMS-AI production release | Security, ops/DR, MFA, institutional signoff | NOT AUTHORIZED |

**Promotion rule:** PR merge, a green unit test, a READY Vercel Preview, or a synthetic demo is not authority to deploy clinical production. Production deployment must be a separate signed release decision, based on the exact deployment SHA and the authoritative blocker register.
