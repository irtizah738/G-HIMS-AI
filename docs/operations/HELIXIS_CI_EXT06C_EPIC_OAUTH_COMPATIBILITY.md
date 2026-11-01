# CI-EXT-06C — Epic developer sandbox OAuth compatibility

**Status: proposed, disabled unless a source is explicitly configured with `oauth.vendorProfile = 'EPIC_SANDBOX'`. No patient import or production activation is authorized by this change.**

## Proven synthetic sandbox observation (2026-11-01)

- Epic issued a valid `client_credentials` Bearer token for Helixis non-production, signed with RS384 and checked against public JWKS.
- Returned scopes included unqualified `system/Patient.r`, `system/Encounter.r`, `system/Observation.r` plus category-limited Observation read scopes.
- A read-by-ID of one documented synthetic Patient returned HTTP 200.
- Encounter/Observation **search** still awaits independent `.s` authorization and vendor API qualification.
- No real hospital connection, clinical import approval or production key is established.

## Behavioral contract

Default SMART broker retains existing exact `.rs` scope request/grant checks. The optional Epic profile:

1. Requires exact public Epic developer-sandbox FHIR base and token URL; denies explicit `GHIMS_RUNTIME_MODE=PRODUCTION`.
2. Requires tenant + source status/security review, explicit resource allowlist, exact host allowlists and a registered source-owned credential revision.
3. Uses the same GCP per-tenant/source Secret Manager accessor. It expects an onboarded **source-specific** secret in the existing hashed naming format; the separate Cloud Shell secret `helixis-epic-sandbox-rs384` is **not** automatically wired to this broker. Never store or copy private keys into Firestore, Vercel or the repo.
4. Signs a fresh RS384 client assertion with the pinned staging-only JKU. The sandbox token request omits `scope` to match the tested Epic behavior; it **never** treats an omitted request scope as authorization.
5. Requires the requested resource's unqualified `system/{Resource}.r` in both the server-owned source configuration and the returned token. A `.r` grant does **not** authorize searching.
6. Rejects wildcard, write, unapproved resource, duplicate, unknown filtered, or unexpected search scopes. Only the specifically observed category-qualified Observation **read** grants are tolerated, and only when generic Observation read is preapproved; they never substitute for that read grant.
7. Uses existing token envelope/expiry validation, revision-bound memory cache, error redaction and immutable import safety controls. No new browser or FHIR write endpoint is introduced.

If Epic later issues `.s` grants after registration sync, explicitly revise the source's approved `oauth.scopes` after independent review. Do not auto-approve whatever the vendor returns. This change alone does not implement FHIR search.

## Source onboarding example (non-secret metadata only)

```json
{
  "baseUrl": "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/",
  "oauth": {
    "mode": "SMART_BACKEND",
    "vendorProfile": "EPIC_SANDBOX",
    "clientId": "<non-production-client-id>",
    "tokenUrl": "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
    "keyId": "<registered-sandbox-kid>",
    "secretVersion": 1,
    "credentialRevision": 1,
    "scopes": [
      "system/Patient.r",
      "system/Encounter.r",
      "system/Observation.r"
    ]
  }
}
```

The metadata record is a reference, not a ready-to-deploy Firestore enrollment. Populate only via the governed onboarding process, after verified source/key identity, facility authorization and consent controls.

## Tests and release gates

```bash
bun test tests/ci-ext04-smart-backend-oauth.test.ts \
  tests/ci-ext04-fhir-sandbox-qualification.test.ts \
  tests/ci-ext06-vendor-sandbox-probe.test.ts \
  tests/ci-ext06c-epic-oauth-compatibility.test.ts
bun run typecheck
bun run lint
```

Still required: source-specific key migration with key fingerprint verification, least-privilege WIF/IAM, fixed egress proxy without direct bypass, approved fixture IDs, exact Epic read tests, independent clinical/security reviews, source credential rotation and outage testing. Do not enable external-to-native Patient 360 projection or clinical drafting based on these OAuth tests.

References:
- https://hl7.org/fhir/smart-app-launch/backend-services.html
- https://fhir.epic.com/Documentation/Index?docId=appfhirversion
- `docs/operations/HELIXIS_CI_EXT06B_EPIC_SANDBOX_REGISTRATION.md`
