# G-HIMS Environment Separation

G-HIMS treats DEMO, TEST, STAGING, and PRODUCTION as separate trust domains.

### Local development and Google AI workspaces

A fresh Next.js development workspace (`NODE_ENV=development`) defaults to the G-HIMS `TEST` runtime when no explicit G-HIMS runtime mode is supplied. This allows local/Google AI preview environments to boot without being misclassified as `PRODUCTION`.

Explicit runtime variables always take precedence:

- server: `GHIMS_RUNTIME_MODE`;
- browser: `NEXT_PUBLIC_GHIMS_RUNTIME_MODE`.

Production and other non-development builds remain fail-closed: an unspecified runtime resolves to `PRODUCTION` and requires an explicitly declared dedicated production Firebase project.

For a stricter local setup, set both runtime variables to `TEST` and declare `GHIMS_FIREBASE_PROJECT_ID_TEST` / `NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST` to the intended sandbox project.

## Mandatory rule

DEMO, STAGING, and PRODUCTION must use distinct Firebase/GCP project IDs. Application startup fails closed in deployed environments when the configured project does not match the declared runtime.

Server variables:
- `GHIMS_RUNTIME_MODE`
- `GHIMS_FIREBASE_PROJECT_ID_DEMO`
- `GHIMS_FIREBASE_PROJECT_ID_STAGING`
- `GHIMS_FIREBASE_PROJECT_ID_PRODUCTION`
- optional `GHIMS_FIREBASE_PROJECT_ID_TEST`

Client builds use the matching `NEXT_PUBLIC_GHIMS_...` project variables.

## Secrets

- Do not reuse service-account keys, integration API keys, AI credentials, webhook secrets, or signing material across environments.
- Production credentials belong in the deployment secret manager, not repository files or build logs.
- A production service account must not have authority over DEMO or STAGING.
- Integration states default to disabled unless explicitly activated for that environment.

## Promotion

Code may be promoted across environments. Data and secrets must not be copied automatically.

A release should progress:
1. TEST validation
2. DEMO/STAGING validation
3. controlled production deployment

Production promotion requires the CI gates, environment contract, backup status, and rollback/recovery plan to be reviewed.
