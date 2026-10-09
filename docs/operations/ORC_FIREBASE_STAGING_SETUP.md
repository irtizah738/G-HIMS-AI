# G-HIMS ORC — Dedicated Firebase STAGING Setup

**Status:** infrastructure onboarding guide. Do not mark staging deployed or Hospital-0 qualified until the protected workflow produces evidence.

## What runs where

- **Frontend and Next.js API:** existing Vercel project `g-hims-ai`, guarded Preview deployment with `GHIMS_RUNTIME_MODE=STAGING`.
- **Backend:** a new, distinct Firebase/GCP project for Firestore and Firebase Auth. Do not use production data, users, service accounts or client app configuration.
- **Firebase Hosting and App Hosting:** not part of the current G-HIMS deployment architecture; `firebase.json` configures only Firestore rules/indexes and local emulators. Keep Next.js on Vercel. Do not run `firebase hosting:channel:deploy staging` unless Hosting is intentionally configured later.

## 1 — Create and verify the separate project

1. From [Firebase Console](https://console.firebase.google.com/), create a new Firebase project. Example project ID: `g-hims-ai-staging` **only if available**; the actual ID must be copied from Firebase, not guessed.
2. Register its Web app, enable the required Firebase Authentication providers, and create its Cloud Firestore `(default)` database in an appropriate data region. Do not import real patient or financial records.
3. Start on Spark only if all required products and quotas are supported. **App Hosting, Cloud Functions deployments, Cloud Run, Pub/Sub and paid Google Cloud services may require Blaze**. Using Vercel for Next.js does not automatically require Firebase App Hosting.
4. Record the actual Firebase project ID, web app config (API key, Auth domain, app ID, sender ID, storage bucket) and database ID. Firebase web API keys are client configuration, not substitutes for Admin credentials.
5. Create a **staging-only** Admin service account whose email belongs to the staging project (`…@STAGING_PROJECT_ID.iam.gserviceaccount.com`), with the minimum project permissions required for G-HIMS. Store its private key only in Vercel Preview sensitive variables, never in GitHub source or client-side environment variables. Rotate it if ever exposed.

## 2 — Configure Firebase CLI aliases without risking production

```bash
npm install -g firebase-tools
firebase login
firebase projects:list
firebase use --add
# Select the NEW staging project; enter alias: staging
firebase use --add
# Select the EXISTING production project; enter alias: production
firebase use
```

`firebase use --add` writes `.firebaserc` locally. Do not commit placeholder aliases or assume the active alias is correct. Prefer an explicit `--project staging` on every deploy command. The project **ID** and the project **alias** are different concepts.

Once staging is configured, deploy **only** the existing Firestore rules and indexes, after reviewing their staging impact:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project staging
```

**Do not run unqualified bare `firebase deploy`:** it uses the active project alias and might target production. The repository's `firebase.json` has no Hosting configuration, so Firebase Hosting previews are not the way to deploy this Next.js app.

## 3 — Vercel environment separation

Open the connected Vercel **g-hims-ai** project → Settings → Environment Variables. Set the following **Preview-only** variables from the new staging project's actual configuration (do not copy production values):

| Variable | Required value/source |
|---|---|
| `GHIMS_RUNTIME_MODE`, `NEXT_PUBLIC_GHIMS_RUNTIME_MODE` | `STAGING` |
| `GHIMS_FIREBASE_PROJECT_ID_STAGING`, `NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING` | Actual NEW staging project ID |
| `FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Same staging project ID |
| `GHIMS_FIREBASE_PROJECT_ID_PRODUCTION` | Existing production project ID, **non-secret comparison reference only** |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_APP_ID` | New staging Web app config |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | New staging Web app config |
| `FIRESTORE_DATABASE_ID`, `NEXT_PUBLIC_FIRESTORE_DATABASE_ID` | Staging Firestore database, usually `(default)` |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Dedicated **staging-only** Admin account; sensitive, server-only |

Add any other config required by the staging preflight and authentication workflow. All experimental integrations (AI, HL7, FHIR, DICOMweb, device telemetry and EDI) must remain disabled until separately qualified. Do not attach Production-only Admin secrets to Preview. On 2026-10-09, the shared Firebase Admin credential variable targets were restricted to **Production**; Preview now needs distinct staging credentials.

The Vercel Preview environment must be intentionally controlled because Preview variables generally apply to all non-production branches unless branch-scoped. G-HIMS has automated Git deployments disabled in `vercel.json` and uses the guarded manual workflow. Review Vercel project access and deployed URLs before enabling clinical staging activity.

Next.js does not automatically select `.env.staging` as a standard production build environment; the guarded workflow uses `vercel env pull .env.staging --environment=preview` then explicitly sources it. Do not check any `.env.staging` or Admin credentials into Git.

## 4 — GitHub Actions deployment credentials

In the repository's Settings → Secrets and variables → Actions configure:

- `VERCEL_TOKEN`: newly authorized token for the connected Vercel team and project.
- `VERCEL_AUTOMATION_BYPASS_SECRET`: Vercel Deployment Protection automation bypass, where protection is enabled.
- `GHIMS_P7_BOOTSTRAP_PASSWORD`: strong synthetic staging identity/bootstrap secret.

Never paste secrets in PR comments or commit them. The workflow uses the Vercel token from environment variables. Verify `vercel whoami --scope` for the configured team before deployment.

## 5 — Fail-closed qualification and deployment order

1. Verify **staging ≠ production** Firebase project ID. Verify staging Admin service-account email belongs to staging and that client/server Firebase IDs match the staging project.
2. Confirm Firestore rules and indexes are deployed to `staging` explicitly, and Auth authorized domains/providers match the protected staging host(s).
3. Run the repository's `bun run ops:staging-preflight` with the **staging Preview** environment loaded. It must reject project collisions, missing comparison references, wrong runtime, unqualified integrations and wrong-project Admin credentials.
4. Manually dispatch GitHub Actions → **STAGING Deployment**, input `STAGING`. This workflow checks out the exact current `main`, builds and deploys to guarded Vercel Preview and runs staging smoke checks.
5. Only after smoke checks pass, provision **synthetic** staging identities/fixtures. Run ORC-7 read-only audit, ORC-8 authenticated cross-role/offline/error injection, and ORC-9 rollback and release evidence. Do not mutate production.
6. Retain exact Git SHA, Vercel deployment ID/URL, preflight output, audit/event/ledger references, cross-role test results and clinical/financial sign-off. Source CI alone does not satisfy the 15 Hospital-0 acceptance checks.

**Known blocker as of setup:** Preview and Production Firebase project IDs previously matched. A separate Firebase project and new Preview credentials must be installed before deploying. A protected Preview build that points at production is not a staging release.

## Billing note

Firebase Spark can cover early Firestore and Authentication testing within product quotas. Confirm the plan supports *all* G-HIMS dependencies; no-cost tier is not a promise of full staging feature parity. Cloud Functions and several GCP services need a billing-enabled Blaze project. Set billing budgets and alerts if Blaze is necessary.

## Official references

- [Firebase project aliases and CLI deployment](https://firebase.google.com/docs/cli)
- [Firebase Spark versus Blaze](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Vercel Preview environment variables](https://vercel.com/docs/environment-variables)
- [Next.js supported env files](https://nextjs.org/docs/app/guides/environment-variables)
