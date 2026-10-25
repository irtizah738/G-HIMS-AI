# G-HIMS AI — isolated investor demo setup

**Scope: the existing G-HIMS-AI application, not G-HIMS-OS.**
This environment is an interactive synthetic PRODUCT DEMO, **not** clinical validation,
patient care, or the 120-case blinded evaluation. Do not expose real patient data.

## Architecture and deployment decision

- Application source: `irtizah738/G-HIMS-AI`.
- Main feature: existing Patient 360 Clinical Intelligence Copilot.
- New demo entry: `/<tenantId>/clinical-intelligence` (DEMO runtime only).
- Patient URL: `/<tenantId>/patients/demo-ci-patient-001/360`.
- Fixture: Amina Shah (Synthetic), `CI-DEMO-001`.
- Initial path: **local G-HIMS AI + isolated Firebase Auth/Firestore emulators**, requiring no
  hosted credentials and making no writes to production.
- Hosted investor URL later: **the same G-HIMS-AI codebase**, separately deployed with a
  dedicated Firebase **DEMO** project, independently reviewed Firebase rules, app hosting,
  auth and identity setup. The existing production Vercel project must remain unchanged.

## Local proof — two terminals

Prerequisites: install dependencies with the repository's pinned lockfile and have
`bun`, `firebase-tools`, Java, and Next.js build prerequisites available.
Avoid loading production `.env` files. Set these values only in an isolated
shell or `.env.local` excluded from source control. In a shell:

```bash
export GHIMS_RUNTIME_MODE=DEMO
export NEXT_PUBLIC_GHIMS_RUNTIME_MODE=DEMO
export GHIMS_DEMO_TENANT_ID=central-metro-hospital
export GHIMS_DEMO_CONFIRM_TENANT=central-metro-hospital
export FIREBASE_PROJECT_ID=ghims-investor-demo-2026
export NEXT_PUBLIC_FIREBASE_PROJECT_ID=ghims-investor-demo-2026
export GHIMS_FIREBASE_PROJECT_ID_DEMO=ghims-investor-demo-2026
export NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO=ghims-investor-demo-2026
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export NEXT_PUBLIC_GHIMS_DEMO_EMULATORS=true
unset NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS
unset GHIMS_DEMO_HOSTED_WRITE_ACK
read -r -s -p "Synthetic-demo password (12+ chars): " GHIMS_DEMO_BOOTSTRAP_PASSWORD
echo
export GHIMS_DEMO_BOOTSTRAP_PASSWORD
```

Never reuse production account passwords, tokens, service-account keys or Firebase projects.
Start the Firebase emulator process in terminal 1 with the same project ID:

```bash
firebase emulators:start --only auth,firestore --project ghims-investor-demo-2026
```

In terminal 2, after loading the same environment exports:

```bash
bun run demo:provision-identities
bun run demo:clinical-intelligence
bun run dev
```

Open `http://localhost:3000/central-metro-hospital/clinical-intelligence`.
Use a synthetic identity such as `demo.doctor@example.invalid` and the
locally chosen password. The Patient 360 link goes to the actual G-HIMS AI
workspace, not a copied illustration. The clinical data must be visible and
API generation controls must be tested explicitly; absence of output is not
evidence that a provider or signed clinical workflow is configured.

**Startup order matters:** keep the same emulator process running between
identity provisioning, chart provisioning, sign-in and the demo. Emulator
storage is ephemeral unless separately exported and reloaded.

## Security baseline for this branch

The 2026-10-25 security remediation pins Next.js to **16.4.1** and Zod
to **4.6.7** and regenerates the authoritative npm v3 package-lock.
Those dependency upgrades require a clean TypeScript build, a full
regression suite and a High/Critical vulnerability audit on the exact
reviewed commit before the DEMO is declared usable. This documentation
is not evidence that the browser demo has been exercised.

## Demo verification before screenshots

1. Synthetic patient exists under `central-metro-hospital` and the Patient 360
   page returns an authoritative (emulator) projection.
2. Confirm conditions, medication orders, allergy, two creatinine results,
   potassium and BP are displayed with synthetic provenance.
3. Generate encounter prep, trend and medication artifacts and inspect the evidence
   panel. Record any rejected commands and don't conceal or manually fabricate
   successful output.
4. Test governed drafting only with a DEMO identity that satisfies the actual
   server-verified clinical privilege chain. Never let an admin title substitute for
   clinical credentials or sign a case for another actor.
5. On the pitch screenshot, show the synthetic banner, one actual output and its
   source evidence. Label it **Synthetic product demonstration — not clinical validation**.

## Hard write limits

Both seed commands require explicit matching server/browser DEMO mode and
four matching Firebase project settings. The destination must differ from
known G-HIMS AI production, G-HIMS OS staging, and configured TEST projects.

- Local Auth and Firestore emulators must both point to `127.0.0.1`; partial
  or remote emulator configuration fails closed.
- Without emulators, seed scripts require the separate acknowledgment
  `GHIMS_DEMO_HOSTED_WRITE_ACK=I_ACCEPT_SYNTHETIC_DEMO_WRITES`.
- **Do not set the hosted-write acknowledgment until there is a new,
  dedicated, access-restricted Firebase DEMO project and its effective project
  identity, credentials, rules, region and budget have been independently
  verified.** The acknowledgment by itself does not constitute hosted
  qualification.
- In particular do not use `g-hims-ai`, `studio-1130431360-48a05`, or
  the CIQP migration temporary source/restore projects for this demo.

## Hosted Firebase target — created by project owner

- Firebase project name: **G-HIMS CI Demo**.
- Project ID: `g-hims-ci-demo` (**not** `g-hims-ai`).
- Firestore Standard Edition / `(default)`: owner reports created.
- Firebase Authentication / Email and Password: owner reports enabled.
- The **separate protected Vercel demo project** already has matching Firebase
  Web SDK config and matching DEMO runtime/project IDs; it is not yet deployed.
- The Firebase Web `apiKey` is **public browser app configuration**, not a
  Firebase Admin SDK credential and never sufficient for server-side access.
- No Cloud IAM principal has been verified for hosted data provisioning yet.

### Keyless Google Cloud Shell demo seeding

The project owner confirmed the following *read-only* environment checks:

- Cloud Shell project: `g-hims-ci-demo`
- Active `gcloud` user: an authorized Google account
- Firestore: `projects/g-hims-ci-demo/databases/(default)`
- Repository branch: `fundraising/clinical-intelligence-demo-20261025`

The previous custom Firebase Admin token credential worked for Auth but was
**rejected by Firestore's SDK credential requirements**. The bootstrap now uses
official Firebase Admin `applicationDefault()` from the existing Cloud Shell
environment, without creating any service-account private key or asking for
a new interactive personal ADC login. The Bash preflight validates the demo
project; a separate Bun preflight checks that read-only Firebase Auth and
Firestore calls work **before asking for a new demo password**. It never
uses a production Firebase project or Vercel credentials.
**Never paste any tokens, ADC JSON, passwords, or service account keys into chat.**

From the existing repository checkout in **your own Cloud Shell session**:

```bash
cd ~/G-HIMS-AI-ci-demo
git pull --ff-only origin fundraising/clinical-intelligence-demo-20261025
command -v bun
command -v gcloud
gcloud config get-value project
gcloud firestore databases describe --project=g-hims-ci-demo --database='(default)' --format='value(name)'
```

If Bun is missing, install the official Bun runtime in the Cloud Shell user
environment before continuing. Stop if the branch/project does not match.
The bootstrap enforces that the Cloud Shell project variable, selected gcloud
project and real Firestore target are all exactly `g-hims-ci-demo`.
It tests token availability without printing the token.

The bootstrap now checks `DEMO_FIREBASE_AUTH_READONLY=PASS` and
`DEMO_FIRESTORE_READONLY=PASS` before showing the write confirmation prompt.
If it reports `DEMO_READONLY_PREFLIGHT_ADMIN_SDK_UNAVAILABLE`, stop and
inspect the ADC discovery/permissions; do not create private keys as a workaround.
If it reports a Firebase permission error, correct **only the demo project's**
IAM configuration.

Only after reviewing the script, run:

```bash
bun install --frozen-lockfile
bash scripts/demo/provision-hosted-ci-demo-with-adc.sh
```

Confirm the printed target by entering exactly
`g-hims-ci-demo/central-metro-hospital` when prompted. Enter a new
**demo-only** password at the hidden prompt. This creates **eight synthetic**
Firebase Authentication users (demo staff roles) and the fixed synthetic
Amina Shah Patient 360 chart inside the DEMO project. It does not approve
clinical results, authorize real patient use or add production users.

The bootstrap exits without writes on mismatched identity, branch, project,
database, Firebase emulator configuration or missing required tools.
If IAM refuses access, **do not widen production privileges or turn off
Firestore security rules**. Qualify the Cloud Shell account's permissions on
the demo Firebase project instead.

### Hosted UI remains separately gated

The separate protected Vercel investor-demo project contains the DEMO
Firebase **browser** configuration. It still needs an approved DEMO-only
server runtime identity, a deployed reviewed commit, verified database rules
and a real browser test of the seeded Patient 360. A browser API key does
not grant server access. Cloud Shell user tokens must never be copied to Vercel.

The existing *local emulator* testing uses the separate fictional Firebase
project ID `ghims-investor-demo-2026`; do not confuse it with the real hosted
project `g-hims-ci-demo`.

## Hosted next step — external configuration required

1. Create a **new Firebase project** specifically for investor-demo
   synthetic data. Enable only the required Auth and Firestore services;
   confirm budget, project IAM, database rules and appropriate protections.
2. Create a separately protected Vercel app **linked to G-HIMS-AI source**
   (not an alternative codebase), with the reviewed DEMO branch. Disable
   automatic deploy until the correct environment has been independently
   audited; production Vercel project remains untouched.
3. Configure server and browser environment variables pointing exclusively
   to the new DEMO Firebase project. Client Auth API config must belong to
   that project; do not copy production client config or Admin credentials.
4. Run the guarded seed commands in a controlled operator shell against
   the new DEMO project after confirming the target and hosted-write
   acknowledgment, then verify the tenant, accounts and Patient 360.
5. Qualify auth, session, source evidence, AI provider/model settings, security
   regressions and DEMO use; only then share the protected investor URL.

**No hosted DEMO environment has been provisioned by this repository change.**
The public page is intentionally unavailable in PRODUCTION, STAGING and TEST.

## 2026-10-25 hosted provisioning and deployment gate

- Owner confirmed `CI_DEMO_HOSTED_READ_VERIFICATION=PASS` using the
  read-only hosted verifier (operator-provided result, not independently
  executed by this repository's CI).
- Synthetic DEMO has eight Auth accounts and a published Patient 360
  projection for `central-metro-hospital/demo-ci-patient-001`.
- Vercel project `g-hims-clinical-intelligence-demo` remains a **separate**
  SSO-protected deployment target with Firebase Web SDK environment variables.
- A Git-source deployment was requested with a **preview** target, but the
  Vercel endpoint returned `target: production`. It was explicitly canceled
  (`dpl_HguXFjKTyw9YeUyg8y3WN4fNJGaG`) and is **not live**. Never
  assume the requested target matches the returned target. Do not retry until
  deployment classification is corrected.
- A Vercel team-scoped OIDC enablement configuration request was accepted;
  its actual runtime token exchange with Google STS has **not** been tested.
- A strictly scoped Cloud Shell IAM bootstrap exists at
  `scripts/demo/configure-vercel-preview-wif.sh`. It requires explicit
  operator approval before modifying **only** the `g-hims-ci-demo` GCP
  project's IAM. It creates pool `ghims-ci-demo-vercel`, provider
  `vercel-preview`, and service account `ghims-ci-demo-preview` with
  `roles/datastore.user` and `roles/firebaseauth.viewer`, impersonable
  only by the exact Vercel demo project's `preview` subject. It creates
  no service account keys and grants **no production/project-owner rights**.
- **No runtime WIF client or hosted browser Auth/Firestore check is yet
  verified.** OIDC IAM trust by itself does not make the investor demo live.
- GitHub Actions for the latest demo candidate have not supplied a passing
  release gate. Keep PR #218 draft and the investor URL private until CI
  resumes and the real clinician/browser review workflow passes.


### Vercel preview build and WIF read probe (October 25, 2026)

- Cloud Shell operator completed `CI_DEMO_WIF_IAM_CONFIGURED=PASS` after
  creating the pool `ghims-ci-demo-vercel`, provider `vercel-preview`,
  and demo-only service account `ghims-ci-demo-preview@g-hims-ci-demo.iam.gserviceaccount.com`.
  This grants Firestore data access and read-only Firebase Auth lookup solely
  in `g-hims-ci-demo`. No long-lived JSON key was created.
- Source commit `e93df975790e36c259dae979ae8ff3db71e09f51`
  deployed as Vercel ID `dpl_A32hUVjpVFV3cWYYhSkRHCFQzRSi`
  in the **separate** project `g-hims-clinical-intelligence-demo`, target
  `staging` (Vercel's non-production staging alias), SSO enabled for
  all deployments, state `READY`. Deployment URL:
  `https://g-hims-clinical-intelligence-demo-f3cqfbjzn.vercel.app`.
- New isolated API
  `/api/clinical-intelligence-demo/identity-check` validates the real
  Vercel OIDC token's team/project/preview claims using Google STS, performs
  a token exchange and read-only impersonation, then checks exactly one fixed,
  synthetic Firestore patient record. It returns only PASS or a generic error,
  no access tokens or patient data. It is **not** a replacement for the main
  G-HIMS AI Firebase Admin runtime authentication.
- **Not yet verified at the deployed endpoint.** Log into Vercel under the
  authorized demo team and visit the API path on the deployment URL. Expect
  `ready:true`, `federation:PASS`, `firestoreSyntheticRead:PASS` before
  proceeding. A 404/503 remains a blocker, not a reason to relax IAM rules.
- Do not promote any deployment or share the URL with investors yet. Clinical
  workflow E2E validation, session authorization, provider-backed AI evaluation
  and outstanding GitHub Actions gates remain open.


### Authenticated clinician review candidate (2026-10-25)

- The operator independently opened the deployed OIDC identity-check endpoint
  and returned `{"ready":true,"gcpProject":"g-hims-ci-demo","deploymentEnvironment":"preview","federation":"PASS","firestoreSyntheticRead":"PASS"}`.
- New DEMO-only read endpoint:
  `/api/clinical-intelligence-demo/physician-chart`. It requires BOTH
  (1) a Google STS-validated Vercel OIDC preview subject limited to the demo
  service account, and (2) a Google-signed Firebase **physician** user ID token
  from the **same dedicated** `g-hims-ci-demo` project.
  It also checks the live Firebase account, revocation floor, membership,
  credential status, synthetic patient and published Patient 360 projection.
  It returns only the bounded canonical synthetic projection fields.
  No write, approve, AI-generate, or sign endpoint is provided.
- New frontend at
  `/clinical-intelligence-demo/clinician-review` signs into
  `demo.doctor@example.invalid` using the privately retained DEMO-only
  password, obtains a Firebase ID token, then reads the exact synthetic chart
  through the protected, keyless read endpoint.
- Candidate deployment `dpl_2nXHvH5verjqadA7LSJCMGZmW97v` finished
  `READY` as non-production `staging` on Vercel,
  SHA `0c6060a60dbf4c22f909b268faa267c29cd2f461`.
  URL: `https://g-hims-clinical-intelligence-demo-j8h2ptkmn.vercel.app`;
  Vercel team SSO remains enabled for all deployment URLs.
- **Clinician login/end-to-end read NOT YET QUALIFIED:** owner must open the
  protected page and sign in with the DEMO physician account, check that
  Patient 360 facts render, and report any `CI_DEMO_CLINICIAN_REVIEW_DENIED`
  without sharing credentials. Check role-denied cases before investor access.
- This read-only viewer is *not* the complete governed G-HIMS clinician
  workflow. General hospital sessions, clinical AI generation, provenance
  acceptance, physician editing, explicit approval/signing and institutional
  validation remain gated. PR #218 must remain draft; GitHub CI is still red.
