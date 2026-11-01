# Helixis / Epic on FHIR — CI-EXT-06B registration and site-qualification plan

**Status: registration prepared; no Epic account accessed, no client registered, no public JKU deployed, no remote vendor request executed.** Reference vendor = Epic developer sandbox, NOT the undisclosed first hospital's production HIS. Do not claim affiliation or a customer connection.

## Verified Epic reference environment (2026-11-01)

| Parameter | Verified value / restriction |
|---|---|
| Vendor | Epic on FHIR — https://fhir.epic.com/ |
| Public developer registration | https://fhir.epic.com/Developer/ (login + organization info, requires user action) |
| FHIR R4 sandbox base URL | `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/` |
| OAuth token URL | `https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token` |
| SMART metadata | `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/.well-known/smart-configuration` |
| App type | `Backend Systems`, `Use OAuth 2.0` |
| JWT algorithm | RS384 supported; existing Helixis broker uses RS384 (other RSA and some EC algorithms are supported subject to Epic client configuration) |
| JKU | Public HTTPS JSON Web Key Set URL, unauthenticated, stable, distinct non-production vs production URLs AND keys |
| Test-data retention | Sandbox reset Sunday at approximately 8 PM US Central time; fixtures written since prior reset may disappear |
| Authorization | Epic's backend `client_credentials` example responds with `Patient.read Patient.search`, NOT proof of the exact SMART v2 `system/Patient.rs` grants Helixis currently requires |
| Published numeric rate limit | Not confirmed: DO NOT INVENT a vendor quota or operate as if unlimited |
| Usage terms | Synthetic data only; normal short test runs; no unrestricted paging, ongoing polling, performance, scalability or security testing on Epic shared sandbox |
| Production customer setup | Separate Epic community member onboarding and local client-to-Epic-user audit mapping; NOT available merely by registering in the shared sandbox |

Official sources:
- https://fhir.epic.com/Documentation/Index?docId=appfhirversion (SMART backend, OAuth, JWKS and sandbox)
- https://fhir.epic.com/Resources/Terms (developer obligations and shared sandbox restrictions)
- https://fhir.epic.com/Developer/ (registration)
- https://open.epic.com/DeveloperResources (integration release/customer onboarding)

**Critical engineering compatibility gate:** existing `fhir-smart-backend-oauth.ts` accepts exactly `system/Patient.rs`, `system/Encounter.rs` and `system/Observation.rs`. Epic explicitly notes some differences from SMART Backend Services, and documentation examples show `Patient.read`. The registration's actual **returned** token scopes and access to each `Patient.Read`, `Encounter.Read`, `Observation.Read` API must be verified *before* any vendor-specific adapter is enabled. No wildcard, synthetic scope mapping, skipped verification or shared bearer token workaround is permitted. If Epic does not grant the expected scopes, build a separately qualified vendor-specific authorization adapter and its tests in a new reviewed PR; do not silently reinterpret the grant.

## Registration plan (operator-owned, not completed)

1. An authorized Helixis operator creates or logs into an Epic on FHIR developer account using a verified company email. Legal company identity must be supplied accurately; do not assert incorporation if it is not complete.
2. Register **Helixis Clinical Intelligence — Interoperability Sandbox** as a **Backend Systems / OAuth 2.0** app. The app is an independent read-only hospital clinical-evidence connector, not an Epic plugin or an Epic-affiliated service.
3. Request only the documented `Patient.Read`, `Encounter.Read`, `Observation.Read` R4 capabilities. Check the permission model and scopes Epic actually returns; do not add unrelated resources.
4. Provide a **stable, publicly accessible, unauthenticated HTTPS JKU** with a dedicated **STAGING** signing key. Never use or republish production signing material. Epic may validate reachability before accepting registration.
5. Save the **non-secret** Non-PRD client ID, Epic app registration reference, approved API list, vendor sandbox authorization reference and endpoint metadata in a controlled internal onboarding record. Do not put access tokens, private keys, patient identifiers or fixtures into GitHub issues.
6. Confirm sandbox acceptable testing windows and rate limits directly in the portal or with Epic support. Unless a numeric quota is supplied, use a conservative operator-governed one-shot read-only sequence with four resource GETs and bounded token requests, and stop on 429/Retry-After. Never automate endless or frequent polling.
7. Independently verify one synthetic Patient, a linked Encounter and linked Observation, including exact FHIR IDs, LOINC coding, `meta.versionId`, `meta.lastUpdated`, and their reset policy. Do not reuse publicly listed IDs without verification that the application can access them.

## Public JKU publication architecture (code ready, hosting NOT verified)

Proposed STAGING JKU path:
`https://<permanent-public-Helixis-domain>/api/integrations/fhir/jwks/<opaque-keySetId>`

Endpoint is implemented at `app/api/integrations/fhir/jwks/[keySetId]/route.ts`.

- It reads **public-key-only** registry `/fhirPublicJwks/{opaqueKeySetId}` using the server identity.
- The public response is limited to `{"keys":[{"kty":"RSA","use":"sig","alg":"RS384","kid":"...","n":"...","e":"..."}]}`. Any private JWK parameter (including `d`, `p`, `q`) is rejected.
- Accept one or two distinct active keys (supports bounded rotation overlap); reject weak RSA modulus, wrong environment, expired or revoked publication, and same publishing/reviewing identity.
- Registry records are **not** accessible via browser Firestore SDK; provision through a privileged, audited operator pathway.
- The private PKCS#8 key MUST exist in the matching source-scoped Secret Manager version and never be checked into the repo, displayed in logs or stored in a normal env var.
- Key provenance must be checked before publishing: derive the public modulus/exponent from the actual Secret Manager signing key using approved WIF/ADC, confirm `kid` and RSA fingerprint match the configured `fhirSources/{sourceId}.oauth`, and require independent review.
- `GHIMS_FHIR_JWKS_ENVIRONMENT=STAGING` is an opt-in and **does not enable FHIR imports**. Use a different dedicated key and URL for production. No live registry documents or environment settings have been provisioned.
- Verify real public HTTPS reachability and JSON response with Epic's registration checker; a protected Vercel preview deployment or login wall is unsuitable for an Epic JKU.
- During rotation, overlap public old/new keys only for the authorized period, publish new key before signing switch, and remove old key after vendor caches and old tokens expire. Preserve immutable publication history under operational governance.

Sample *metadata-only* registry record (not a deployable key):

```json
{
  "environment": "STAGING",
  "status": "PUBLISHED",
  "revision": 1,
  "publishedAt": 1793500000000,
  "expiresAt": 1796000000000,
  "publisherActorId": "authorized-operator-uid",
  "reviewerActorId": "independent-security-uid",
  "keys": []
}
```

The example has zero keys and is **intentionally invalid**. Do not publish before real key material exists.

## Written scope and rate approval

The website's developer terms authorize *specified kinds* of shared synthetic sandbox testing subject to their conditions; this is **not** a personalized authorization for Helixis's exact test plan. Record an email/ticket/portal authorization reference showing the app/client, read-only scope, approved synthetic fixtures, testing window, request budget, Retry-After behavior and designated vendor support contact. Written permission for any fault injection against Epic itself must be explicit; otherwise run all 401/403/429/5xx, network loss and security probes solely against local synthetic/mock endpoints under Helixis control.

Suggested vendor request:

**Subject:** Helixis Clinical Intelligence — Backend FHIR R4 sandbox registration and synthetic read test authorization

> We are preparing a read-only SMART Backend Services interoperability qualification for Helixis Clinical Intelligence. We request confirmation of the proper Backend Systems registration, non-production OAuth client requirements, supported RSA/JWKS configuration and exact access scopes for Patient.Read, Encounter.Read and Observation.Read. Our proposed sequence uses only vendor-approved synthetic test data: one Patient GET, one associated Encounter GET, and two GETs of the same associated Observation to inspect version consistency. We will not write to the sandbox, enumerate patients, run load/security tests, or use real patient information. Please confirm any rate/burst limits, acceptable testing window, the weekly reset effect on fixture IDs, and whether additional written authorization is required. We will retain a support reference and independently review test results before considering any hospital implementation.

No request has been sent yet.

## Firestore enrollment schema (NOT provisioned)

Existing tenant-owned metadata records:
- `/tenants/{tenantId}/fhirSources/{sourceId}`: validated source host URL, APPROVED + ACTIVE, allowed resource types, SMART backend non-secret client ID/token URL, key ID/version/credential revision, facility, security review; must remain disabled until complete enrollment and clinical/site approval.
- `/tenants/{tenantId}/fhirSyntheticFixtureManifests/{sourceId}`: confirmed vendor synthetic Patient/Encounter/Observation fixture IDs, approved FHIR base and token URL, operator/vendor authorization reference, credential revision, dates, syntheticOnly=true. Browser SDK access denied.
- `/tenants/{tenantId}/fhirVendorProbes/{evidenceId}`: immutable technical-only remote observation, never clinical PASS.
- `/tenants/{tenantId}/fhirSyntheticQualifications/{id}`: **separate** externally validated clinical and operational site qualification evidence, not auto-written by probe. CI-EXT-05 requires additional independent clinical/security review and activation.

Do not create any of these source records using guessed fixture IDs, assumed scopes or an unverified domain.

## Egress requirement — BLOCKED until enforced

The runtime's existing `assertPublicSandboxEgress` is a preliminary DNS/hostname check, **not** binding to the socket destination and insufficient against DNS rebinding. The actual site probe must run from a dedicated **STAGING** workload with:
- a network-controlled egress proxy / integration gateway restricting **both** the FHIR hostname and auth-token hostname to approved destinations;
- no direct outbound path around that proxy; DNS/IP revalidation at connect time, TLS certificate/host validation, no redirects to unapproved hosts;
- source-scoped WIF principal and Secret Manager IAM; no production Firestore authority or key;
- bounded request counts and failure audit;
- an incident kill switch and emergency `SUSPEND_SOURCE` workflow.

No network gateway configuration has been verified here. Accordingly **do not enable** the probe in a hosted STAGING deployment until an infrastructure engineer has evidenced the actual outbound policy.

## External qualification / sign-off matrix

| Case | Evidence required | Can use shared Epic sandbox? |
|---|---|---|
| Registered SMART client and signed JWT | Epic-issued non-prod client ID, key match, exact token grant/scope | Yes, after registration |
| Patient/Encounter/Observation linkage | 3 vendor-confirmed synthetic fixtures with exact id, provenance and LOINC | Yes, approved fixture reads |
| Stable read vs updated version | immutable source version/timestamp evidence, replay policy | Minimal read-only; do not mutate vendor sandbox without explicit permission |
| Import replay/idempotency | Helixis isolated Firestore state/evidence, reconciliation behavior | Local controlled test |
| Consent withdrawal and identity collision | deny-after-revoke, cross-patient rejection, audit | Local controlled test |
| Cross-tenant source isolation | tenant/facility denial, no proxy bypass | Local controlled test |
| OAuth credential rotation | key version plus JKU overlap and old-token rejection | Approved vendor rotation window plus local controlled test |
| 401/403/429/5xx/timeouts/offline recovery | request budget, safe retry, Retry-After and rollback | Local mocked gateway; NOT deliberate vendor stress or security testing |
| Clinical signoff | independent clinical reviewer outcome | Requires qualified human reviewer |
| Security signoff | independent security reviewer and egress/IAM evidence | Requires qualified human reviewer |
| Production release | independent recorded go/no-go decision | Not authorized by CI tests |

### Remaining closure conditions

- Epic developer login and app registration are user/operator actions.
- Public STAGING domain and a real key material/provisioning path must be selected.
- Real proxy policy and outbound verification must be evidenced.
- Exact vendor OAuth grants and synthetic fixture IDs must be observed, not inferred.
- Written testing scope, clinical/security approvals and site acceptance must be obtained.
- Production imports, external-context clinical drafting and patient-data use stay disabled until all separate acceptance gates pass.
