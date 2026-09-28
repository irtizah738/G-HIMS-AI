# G-HIMS Identity & Staging Access Runbook

## Purpose

P5A replaces the historical mock/auto-provisioning login model with real Firebase Authentication identities and server-managed tenant memberships.

A valid sign-in requires both:

1. a real Firebase Auth identity in the active Firebase project; and
2. an ACTIVE membership at `tenants/{tenantId}/users/{firebaseUid}`.

The browser may not create or modify tenant memberships directly.

## Vercel Firebase Admin configuration

For Vercel STAGING/PRODUCTION configure the server runtime with:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIRESTORE_DATABASE_ID`

Configure the matching public client values:

- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- other Firebase web-app identifiers as required.

Do **not** use a local `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json` strategy on Vercel. P5A deliberately does not treat that as valid Vercel Admin configuration.

Never commit the service-account private key to Git.

## Readiness

After deployment:

```
GET /api/health/ready
```

must return HTTP 200.

P5A readiness performs real, non-PHI Firebase Auth and Firestore connectivity probes. A 503 blocker such as:

- `FIREBASE_ADMIN_AUTH_UNAVAILABLE`
- `FIREBASE_ADMIN_AUTH_CONNECTIVITY_FAILED`
- `FIRESTORE_ADMIN_UNAVAILABLE`
- `FIRESTORE_CONNECTIVITY_FAILED`

must be resolved before staging authentication is considered usable.

## First administrator bootstrap

Use an operator environment that has Firebase Admin credentials for the **target** Firebase project.

Required values:

```
GHIMS_ALLOW_ADMIN_BOOTSTRAP=true
GHIMS_BOOTSTRAP_ADMIN_EMAIL=<administrator email>
GHIMS_BOOTSTRAP_ADMIN_TENANT=<tenant id>
GHIMS_BOOTSTRAP_CONFIRM_PROJECT=<exact FIREBASE_PROJECT_ID>
```

For a production runtime, the additional explicit override is required:

```
GHIMS_ALLOW_PRODUCTION_ADMIN_BOOTSTRAP=true
```

Then run:

```
bun run ops:bootstrap-admin
```

The script creates/reuses the Firebase identity and writes the tenant membership under the Firebase UID. It never sets a hard-coded administrator password.

If a new Firebase identity was created, use the normal **Forgot password** flow to establish the password.

## Staff provisioning

After the first administrator can sign in, use Tenant User & Access Administration.

The UI calls the authenticated server IAM API:

- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users`

The server creates/reuses Firebase identities and stores memberships using the Firebase UID as the document key.

New doctor/nurse identities start with `credentialStatus=UNVERIFIED`; clinical privileges must remain unavailable until credentialing is explicitly verified.

## DEMO personas

Demo identities are available only in `GHIMS_RUNTIME_MODE=DEMO`.

Provision them explicitly with:

```
GHIMS_RUNTIME_MODE=DEMO
GHIMS_DEMO_BOOTSTRAP_PASSWORD=<demo-only password>
bun run demo:provision-identities
```

Do not provision demo personas into STAGING or PRODUCTION.

## Shared workstations

A workstation registration is tenant-scoped. Multiple staff may use the same enrolled workstation sequentially. User authority remains session-scoped.

On logout/user switch:

- cached auth/session material is cleared;
- PHI-bearing read caches for the tenant are purged;
- pending offline commands are preserved but remain bound to the Firebase UID that created them;
- another user cannot replay those queued commands.

## Google identity

Google login authenticates identity only. It does not request Drive/Sheets scopes and does not retry with an application password. After Firebase Google authentication, the ID token is exchanged for the authoritative G-HIMS tenant session.

## Break-glass

Emergency access is not activated by a client boolean or STAT priority.

A grant must be:
- created by the authenticated break-glass route;
- bound to user + tenant + patient + encounter;
- ACTIVE and unexpired;
- resolved server-side before command dispatch.

Every domain audit generated under emergency override carries the grant ID and scope metadata, and each grant is marked `PENDING_REVIEW`.
