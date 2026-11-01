# CI-EXT-04 — Tenant-scoped SMART Backend Services and FHIR R4 sandbox qualification

**Engineering status:** qualification candidate, feature disabled by default. **No live hospital has been tested.**

## Why this design

A Helixis deployment can serve many hospitals, each owning its own HIS/EHR FHIR R4 authorization server. The previous FHIR ingest used one runtime-pinned bearer token. This milestone replaces that mechanism with the SMART Backend Services authorization pattern using short-lived OAuth client-credentials tokens and asymmetric JWT client authentication. It does not create a hospital-authorized connection by itself.

Key reference: HL7 SMART App Launch 2.2 Backend Services, `https://hl7.org/fhir/smart-app-launch/backend-services.html`.

## Trust path

```text
Browser: resourceType, sourceId, resourceId, tenantId ONLY
 -> verify Firebase token, tenant membership, active device/session
 -> require explicit FHIR_IMPORT and facility grant
 -> read /tenants/{tenantId}/fhirSources/{sourceId}
 -> source ACTIVE + securityReview APPROVED + resource allowlist
 -> GHIMS_CI_FHIR_AUTH_MODE=SMART_BACKEND (default: blocked)
 -> exact HTTPS host allowlists for FHIR and OAuth token origin
 -> source-specific Secret Manager key resource
 -> create one-time RS384 client assertion (aud, iss, sub, iat, exp, jti, kid)
 -> OAuth POST client_credentials, system/{Resource}.rs only
 -> verify Bearer response, requested returned scope and expiry
 -> read only one approved FHIR R4 resource (redirect:error)
 -> Firestore atomic version import with OAuth revision fencing
 -> HELD external evidence; native Patient 360/AI authority unchanged
```

The user may not select a base URL, secret name, client ID, signing key, access token or OAuth scope. `FHIR_IMPORT` is server-authoritative and cannot be inferred from a general administrator role. The import transaction checks `credentialRevision` again after the remote resource read; a rotation or registration change aborts ingestion.

## Tenant-scoped Firestore source record

```json
{
  "tenantId": "hospital-a",
  "sourceId": "his-a",
  "facilityId": "hospital-a-campus",
  "baseUrl": "https://fhir.hospital-vendor.example/r4",
  "status": "ACTIVE",
  "securityReviewStatus": "APPROVED",
  "approvedResourceTypes": ["Patient", "Encounter", "Observation"],
  "oauth": {
    "mode": "SMART_BACKEND",
    "clientId": "hospital-registered-client",
    "tokenUrl": "https://auth.hospital-vendor.example/token",
    "keyId": "key-2026-1",
    "secretVersion": 1,
    "credentialRevision": 1,
    "scopes": ["system/Patient.rs", "system/Encounter.rs", "system/Observation.rs"]
  }
}
```

All fields are server-provisioned after a hospital integration agreement and security review. Firestore stores metadata only: **never private keys, client secrets, or bearer tokens**. Direct browser access to FHIR source documents remains denied.

## Google Secret Manager

For each tenant/source, derive the secret name as:

```text
projects/<secret-project>/secrets/helixis-fhir-<sha256(JSON.stringify([tenantId,sourceId])).slice(0,32)>/versions/<integer-secretVersion>
```

The secret payload is only a PEM-encoded PKCS#8 RSA private key of at least 2048 bits. The vendor registers the matching public key and `kid`. Use Workload Identity Federation / ADC, no stored service account key. Give the runtime principal `roles/secretmanager.secretAccessor` **only on the specific hospital secret**. Rotate by publishing a *new numbered version*, updating the source `secretVersion`, `keyId`, and incrementing `credentialRevision` in a controlled server write. Do not use the `latest` alias or make token-cache invalidation depend on wall-clock alone.

## Required server-only environment

```dotenv
GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED=false
GHIMS_INTEGRATION_FHIR_R4_STATE=DISABLED
GHIMS_CI_FHIR_AUTH_MODE=DISABLED
GHIMS_CI_FHIR_SECRET_PROJECT_ID=<approved-project>
GHIMS_CI_FHIR_OAUTH_ALLOWED_TOKEN_HOSTS=auth.vendor.example
GHIMS_CI_FHIR_OAUTH_ALLOWED_FHIR_HOSTS=fhir.vendor.example
```

All allowlist hosts are exact HTTPS domain names; no ports, userinfo, query fragments, local IP literals or HTTP. The production network egress layer must independently restrict DNS, egress and private-address resolution, since application-level host allowlists alone do not eliminate DNS rebinding/SSRF.

To enable for an approved environment only after qualification, an authorized operator explicitly sets `GHIMS_CI_FHIR_AUTH_MODE=SMART_BACKEND`, `GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED=true` and FHIR integration `LIVE`. Do not enable in production on the strength of the synthetic tests.

## Token lifecycle

- SMART client assertion: signed RS384, exact configured audience/token endpoint, one-time UUID `jti`, five-minute maximum validity, key ID header.
- Token POST: `grant_type=client_credentials`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, resource-specific system read scope; no redirects; bounded response and network timeout.
- Strictly require Bearer token, explicit returned scope equal to requested scope, valid `expires_in`; refuse privilege widening or undocumented grants.
- Memory-only short cache keyed by tenant ID, source ID, registration, credential revision and requested scope. Failed or aborted tokens are not cached. No access tokens or JWT assertions are logged or exposed to clients.
- Source activation, facility authority and consent are rechecked transactionally before publishing a new external import receipt; token issuance alone never grants access.

## Sandbox qualification procedure

1. Obtain written hospital/vendor approval, a dedicated synthetic FHIR R4 sandbox URL and the precise SMART metadata/token endpoint. Confirm permitted `Patient`, `Encounter`, `Observation` read scopes.
2. Provision a source-specific RSA key pair in Secret Manager, register only its public JWK/key ID with the sandbox, and grant least-privilege secret access through the approved runtime identity.
3. Use `qualifySmartFhirSandbox` from an isolated operator process with the approved registered source and token broker. It checks `/.well-known/smart-configuration` token endpoint and `private_key_jwt`, then authenticated `/metadata` and R4.0.1 resource-read capabilities.
4. Follow up with approved **synthetic** patients, correct `meta.versionId`/`meta.lastUpdated`, verified patient mappings, repeated same-version imports, historical versions and source revocations.
5. Capture a signed qualification report covering interoperability profile, OAuth rotation, consent withdrawal, identity collision, resource version gaps, denied scopes, vendor rate limits, network loss and incident rollback. Require hospital sign-off before accepting real patient records.

This automated conformance harness **never** retrieves patient data. It returns `qualifiedForPatientData=false` and `qualifiedForProduction=false`, including when every protocol check succeeds. It cannot substitute for steps 4–5 or a real vendor endpoint.

## CI and operational caveats

Synthetic suites:

```sh
bun run typecheck
bun run lint
bun test tests/ci-ext04-smart-backend-oauth.test.ts tests/ci-ext04-fhir-sandbox-qualification.test.ts
```

Remaining work: tested vendor-specific connection, GCP IAM policy and WIF principal qualification, private-network gateway/egress restrictions, OAuth discovery metadata pinning at onboarding, operational rotation and revocation drills, cross-tenant concurrency stress, retry jitter and 429 handling, clinical normalizer conformance, verified real HIS data and clinical sign-off. The existing clinical evidence reader remains review-only and the native drafting path still rejects EXTERNAL mode.

## Staging-only qualification endpoint and audit

`POST /api/integrations/fhir/qualify` accepts **only** `tenantId` and `sourceId`.
It requires the existing authenticated tenant membership, active session and device,
an explicit `FHIR_INTEGRATION_QUALIFY` grant, and the registered source's facility.
It is unavailable unless **all** of the following hold:

- `GHIMS_RUNTIME_MODE=STAGING`
- `GHIMS_CI_FHIR_SANDBOX_QUALIFICATION_ENABLED=true`
- `GHIMS_CI_FHIR_AUTH_MODE=SMART_BACKEND`
- `GHIMS_INTEGRATION_FHIR_R4_STATE=INTEGRATION_READY`

The server retrieves the source from tenant-scoped Firestore, enforces exact
source/token host allowlists, checks SMART discovery, obtains the resource-scoped
backend OAuth token, and checks a read-only FHIR R4 CapabilityStatement. It does
**not** issue any Patient/Encounter/Observation `GET` requests.

The qualification is written to
`/tenants/{tenantId}/fhirSandboxQualifications/{qualificationId}` as an immutable
`PROTOCOL_PASSED_SITE_PENDING` or `FAILED` receipt, tied to the reviewer, source,
facility and OAuth credential revision. The server rechecks source status,
OAuth metadata, approved facility and credential revision before committing.
Browser Firestore reads/writes are denied.

Even a successful report explicitly retains
`qualifiedForPatientData=false` and `qualifiedForProduction=false`.
Clinical site approval and a vendor-connected synthetic patient roundtrip
remain separate and mandatory.

**Do not set** the sandbox qualification flag on production deployments.
