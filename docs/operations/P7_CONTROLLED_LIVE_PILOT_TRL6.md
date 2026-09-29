# P7 — Controlled Live Pilot & TRL-6 Qualification

P7 is the operational qualification phase for the P6-hardened G-HIMS release.

P7 does **not** replace code-level validation. It proves that the deployed system operates in a relevant environment with real devices, real network failure, real recovery procedures, controlled users and traceable evidence.

## Safety boundary

- Use synthetic/non-production patient data for P7A-P7E engineering qualification.
- A real Hospital-0 pilot begins only at P7F under written institutional consent and an approved scope.
- P7 tooling must run against `GHIMS_RUNTIME_MODE=STAGING` unless an explicitly documented pilot deployment is approved.
- Production credentials, patient records and destructive restore operations must never be used for rehearsal convenience.
- No P7 script may silently create authorization. Every user must have an explicit tenant membership.

## P7A — Dedicated STAGING deployment

**Goal:** prove the exact qualification commit is running against a dedicated STAGING Firebase trust domain.

Required:
1. Dedicated Firebase project for STAGING.
2. Firebase Auth Email/Password enabled.
3. Firestore database created.
4. Web application credentials configured in the Vercel STAGING environment.
5. Firebase Admin service account configured in the Vercel STAGING environment.
6. `GHIMS_RUNTIME_MODE=STAGING` and `NEXT_PUBLIC_GHIMS_RUNTIME_MODE=STAGING`.
7. `GHIMS_FIREBASE_PROJECT_ID_STAGING` and `NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING` both match the active STAGING project.
8. Run the existing `STAGING Deployment` workflow from the frozen qualification commit.
9. Hard gate: `GET /api/health/ready` returns HTTP 200, `status=ready`, `runtime=STAGING`, and no blockers.

Evidence:
- deployed Git SHA;
- Vercel deployment URL/id;
- deployment timestamp;
- `staging-smoke.json`;
- `staging-deployment-evidence.txt`.

## P7B — Real-device offline qualification

Use `docs/operations/OFFLINE_FIRST_QUALIFICATION.md` on at least two real workstations/browsers.

Required physical tests:
- online login and local hydration;
- physical network disconnect;
- offline refresh;
- offline patient registration;
- offline vitals/note/order;
- browser close/reopen while offline;
- reconnect and replay;
- local-to-canonical identity remapping;
- zero duplicate creation on retry;
- two-workstation causal conflict;
- actor switching on a shared workstation;
- local encrypted PHI inspection.

Record each device in the evidence manifest with:
- device/browser/OS description;
- tester;
- start/end UTC;
- pass/fail;
- pending outbox before and after reconnect;
- canonical IDs created;
- conflict result;
- screenshots/log references.

Do not mark P7B passed solely because the built-in “Test Offline Mode” toggle works.

## P7C — Synthetic hospital-day rehearsal

Provision only synthetic STAGING users:

```bash
GHIMS_RUNTIME_MODE=STAGING \
GHIMS_P7_ALLOW_STAGING_PROVISION=true \
GHIMS_P7_CONFIRM_PROJECT=<staging-project-id> \
GHIMS_P7_BOOTSTRAP_PASSWORD='<temporary-strong-password>' \
bun run ops:p7:provision
```

Then run the live rehearsal:

```bash
GHIMS_RUNTIME_MODE=STAGING \
GHIMS_P7_BASE_URL=https://<staging-deployment> \
GHIMS_P7_TENANT_ID=p7-hospital-zero \
GHIMS_P7_BOOTSTRAP_PASSWORD='<same-temporary-password>' \
NEXT_PUBLIC_FIREBASE_API_KEY='<staging-web-api-key>' \
bun run ops:p7:rehearsal > p7-hospital-day-evidence.json
```

The runner proves:
- STAGING readiness;
- login/session creation for Administrator, Reception, Nurse, Doctor, Billing, Lab and Pharmacy;
- role-scoped offline bootstrap;
- patient registration;
- idempotent duplicate registration retry;
- vitals;
- OPD transition;
- signed clinical note;
- diagnostic order;
- lab order visibility;
- cash receipt + balanced journal;
- prescription;
- pharmacy dispense;
- OPD completion.

A failed check exits non-zero.

## P7D — Recovery and operations evidence

Required operator drills:
1. Firestore export using `bun run ops:backup`.
2. Import into an isolated restore target using `bun run ops:restore`.
3. Record:
   - export start/end;
   - restore start/end;
   - source export URI;
   - restore project;
   - RPO;
   - RTO;
   - verification queries/results.
4. Rehearse rollback to a known-good Vercel deployment.
5. Configure and test at least one external alert/log destination.

A dry run is not recovery evidence.

## P7E — Independent security assessment

Repository security tests remain mandatory, but P7E requires a human-independent security assessment of the deployed STAGING build.

Evidence:
- assessment scope;
- assessor/organization;
- date;
- tested commit/deployment;
- findings by severity;
- Critical/High remediation;
- retest outcome.

P7E cannot be auto-passed by a repository script.

## P7F — Hospital-0 controlled pilot

Begin only after P7A-P7E gates pass.

Initial pilot scope:
- OPD;
- basic IPD/ward;
- doctor notes/orders;
- pharmacy lite;
- cash billing;
- internal diagnostics as applicable.

External integrations remain disabled unless separately qualified.

Required:
- written site consent;
- named pilot owner;
- approved user list;
- training/sign-off;
- incident escalation path;
- daily operational log;
- defects and remediation log;
- defined stop/rollback criteria.

## P7G — TRL-6 evidence package

The evidence package must bind the claim to a specific deployed commit and pilot context.

Minimum contents:
- qualification commit SHA;
- architecture/version identifier;
- deployment evidence;
- staging readiness evidence;
- P7B device qualification evidence;
- P7C hospital-day evidence;
- P7D backup/restore/rollback evidence;
- P7E independent security report and retest;
- Hospital-0 consent;
- workflow scope and users;
- uptime/incident log;
- defects found and remediated;
- quantitative results;
- operator/site sign-off;
- repeatable qualification protocol.

The TRL-6 package must distinguish:
- **implemented in code**;
- **verified in STAGING**;
- **verified on real devices**;
- **verified in a relevant hospital environment**.

## Exit criteria

P7 is complete only when:
- the frozen build is deployed and ready in dedicated STAGING;
- physical offline qualification passes;
- the synthetic hospital-day rehearsal passes;
- recovery and rollback evidence is complete;
- independent Critical/High security findings are resolved;
- Hospital-0 completes the approved controlled pilot;
- the evidence manifest contains no unresolved mandatory gate.

Code or CI success alone is not a TRL-6 claim.
