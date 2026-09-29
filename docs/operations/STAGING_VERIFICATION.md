# G-HIMS P5B — Staging Verification

P5B is an operational verification layer. It does not weaken or bypass the P0–P5A trust boundaries.

## Prerequisites

Before running the smoke gate:

- deploy the current `main` commit through the guarded `STAGING Deployment` workflow;
- on Vercel Hobby, this workflow uses a manual **Preview** deployment as the G-HIMS STAGING trust domain because Vercel Custom Environments are not available on Hobby;
- automatic Vercel Git deployments must remain disabled for all branches so staging credentials are never exposed to arbitrary feature previews;
- configure the Vercel **Preview** environment variables for this project with `GHIMS_RUNTIME_MODE=STAGING` and `NEXT_PUBLIC_GHIMS_RUNTIME_MODE=STAGING`;
- use a dedicated STAGING Firebase project;
- configure Firebase Admin with `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`;
- configure the matching Firebase web client values;
- keep pilot-unneeded external integrations DISABLED.

The staging URL must use HTTPS and must not point to localhost.

## Deployment credential

The guarded GitHub Actions workflow requires a repository secret named
`VERCEL_TOKEN`. The value is a Vercel access token and must never be committed
or pasted into logs. The workflow fails before deployment when the secret is
missing.

## Run

```bash
GHIMS_STAGING_BASE_URL=https://<staging-host> \
bun run ops:staging-smoke
```

Optional:

```bash
GHIMS_STAGING_EXPECTED_RUNTIME=STAGING
GHIMS_STAGING_SMOKE_TIMEOUT_MS=15000
```

For a protected staging host, one optional header can be supplied without embedding it in source:

```bash
GHIMS_STAGING_SMOKE_HEADER_NAME=<header-name>
GHIMS_STAGING_SMOKE_HEADER_VALUE=<header-value>
```

Do not commit the header value.

## Required checks

The command fails unless all of the following are true:

1. `GET /api/health/ready` returns HTTP 200 and `status=ready`.
2. The readiness payload reports the expected runtime, normally `STAGING`.
3. `GET /api/health` returns HTTP 200.
4. An unauthenticated request to `POST /api/commands/execute` is rejected with HTTP 401 or 403.
5. `GET /login` returns HTTP 200.

The readiness endpoint is the important gate: P5A makes it perform real Firebase Auth and Firestore connectivity checks rather than merely checking that SDK objects can be constructed.

## Current external blocker

If Vercel reports a build-rate limit, no code change can convert that into a valid staging deployment. Wait for the platform quota window to clear or change the account capacity, then deploy the current `main` commit and run this smoke gate.

A green repository build is not equivalent to a green staging environment.
