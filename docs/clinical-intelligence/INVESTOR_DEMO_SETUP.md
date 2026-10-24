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
