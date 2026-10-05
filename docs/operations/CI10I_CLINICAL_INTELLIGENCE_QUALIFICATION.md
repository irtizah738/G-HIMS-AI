# CI-10I — Clinical Intelligence Offline + Production Qualification

CI-10I is the final engineering qualification gate for the CI-10 Clinical Intelligence program.

This runbook qualifies the Clinical Intelligence layer. It does **not** replace the broader hospital production blocker register or external institutional/security/integration approvals.

## Safety model

Clinical Intelligence uses an asymmetric offline model:

- Patient 360 remains the authoritative clinical context.
- Previously generated immutable CI-10B–E artifacts may be stored in the existing encrypted, actor-scoped edge store and viewed offline.
- Offline cached intelligence is explicitly labelled `OFFLINE_CACHED`; it is never current server authority.
- A revision/source-checkpoint mismatch is `STALE` even when the artifact is available locally.
- Governed clinical drafts are not stored in the CI-10I edge intelligence cache.
- New intelligence generation, governed draft generation, review, approval, signing and rejection require application-origin connectivity.
- Clinical Intelligence actions are not queued for later execution in the generic offline mutation outbox.
- CI-10H safety evaluation and current Patient 360 checks remain mandatory at the server authority boundary.

## Repository qualification

Run:

```bash
bun run validate:ci10i
```

Required result: all steps green.

This includes:
- TypeScript and lint;
- CI-10I offline/production contract tests;
- CI-10H adversarial safety release gate;
- CI-10G through CI-10A regression coverage;
- DRP-6 / P6 offline controls;
- P5C and P7 pilot contracts;
- security regression;
- production build.

## Device offline qualification

Use synthetic/non-production patient data only.

1. Sign in online as an authorized clinician on an approved test device.
2. Open Patient 360 and generate:
   - longitudinal summary;
   - encounter preparation;
   - trend intelligence;
   - medication reconciliation.
3. Verify the four successful authoritative results are written to the encrypted edge collection `clinicalIntelligenceArtifacts`.
4. Confirm no governed draft is written to that edge collection.
5. Physically disable network access.
6. Reload/restart the browser and reopen the same patient.
7. Verify Patient 360 loads from the existing encrypted edge snapshot.
8. Verify previously generated B–E artifacts render as `OFFLINE_CACHED`, never `CURRENT`.
9. Verify any artifact whose revision/checkpoint differs from local Patient 360 renders `STALE`.
10. Verify all new generation controls are disabled offline.
11. Verify governed draft generation, review, approval, signing and rejection cannot execute offline.
12. Restore network access.
13. Refresh Patient 360 and Clinical Intelligence.
14. Verify server-authoritative revision/checkpoint replaces the offline view and stale artifacts require regeneration where appropriate.

## Shared-device isolation

1. As User A, hydrate Patient 360 and CI-10B–E artifacts.
2. Sign out.
3. Verify PHI-bearing edge read models, including `clinicalIntelligenceArtifacts`, are purged by the logout boundary.
4. Sign in as User B.
5. User B must not be able to decrypt or render User A's cached intelligence.
6. Any actor mismatch must fail closed; never downgrade to plaintext or another actor's key.

## Interrupted generation / retry

For governed draft generation:

1. Start a draft request online.
2. Interrupt the response path after the server may have committed the request.
3. Retry from the same UI attempt.
4. Verify the same generation idempotency key is reused until a successful response.
5. Verify the server either returns the original draft/revision or rejects an integrity/scope conflict.
6. Verify no duplicate governed draft is created.

For deterministic B–E artifacts, repeated generation from the same frozen authoritative evidence must preserve immutable/idempotent artifact identity semantics already defined by CI-10B–E.

## Provider timeout / outage qualification

CI-10I requires a bounded provider request.

Configured `GHIMS_AI_TIMEOUT_MS` must be an integer from 5000 through 90000 milliseconds.

In a controlled non-production environment:

1. Configure AI as LIVE with an approved provider/model.
2. Exercise a successful synthetic provider call.
3. Introduce controlled provider failure/invalid credentials and verify:
   - request fails closed;
   - no clinical fallback is synthesized;
   - no governed draft is committed from failed generation;
   - the API surfaces service failure;
   - operational logs contain stable error code + duration, not prompt/source/output content.
4. Exercise a provider response that exceeds the configured timeout.
5. Verify `AI_PROVIDER_TIMEOUT` is contained as provider failure and no clinical authority is created.

## Production configuration preflight

Before a production Clinical Intelligence deployment, run with the target production environment loaded:

```bash
bun run ops:ci10i:production-preflight
```

It requires:
- server/public runtime = `PRODUCTION`;
- Firebase server/client project IDs match the explicit production project;
- Firestore database configured;
- no Auth/Firestore emulator host;
- Firebase Admin credentials configured;
- `GHIMS_INTEGRATION_AI_STATE=LIVE`;
- approved provider;
- explicit model;
- explicit `GHIMS_AI_APPROVED_MODELS` allowlist containing that model;
- AI credentials;
- explicit bounded `GHIMS_AI_TIMEOUT_MS`.

## Deployed readiness check

After deployment, call:

`GET /api/health/clinical-intelligence`

Required result is HTTP 200 and `status: "ready"`.

The endpoint returns only safe operational metadata and blocker codes. It must never return API keys, prompts, source evidence, patient identifiers or generated content.

## Live provider smoke

After the target deployment/configuration is ready, execute:

```bash
bun run ops:ci10i:live-ai-smoke
```

The smoke request is synthetic and contains no PHI. It validates:
- real provider connectivity;
- provider/model provenance;
- expected structured response;
- current CI-10H untrusted-source safety-boundary attestation;
- bounded request completion.

Do not use patient data for provider connectivity qualification.

## Operational signals

Required production log signals:
- `clinical_ai_generation`;
- `clinical_intelligence_operation`;
- success/failure outcome;
- correlation ID where available;
- non-reversible tenant fingerprint;
- duration;
- stable error code;
- safe purpose/operation/provider/model metadata.

Never log:
- patient ID or MRN;
- clinical notes;
- evidence payload;
- prompts;
- model response content;
- auth tokens or provider credentials.

## CI-10I pass criteria

CI-10I engineering qualification passes only when all of the following are true:

1. `validate:ci10i` is green on the exact merge candidate.
2. Offline cached CI-10B–E artifacts are encrypted, actor-scoped, read-only and never labelled current authority.
3. No Clinical Intelligence generation or governed draft authority operation is offline queued.
4. Current revision/source-checkpoint freshness remains enforced.
5. Interrupted governed draft generation is idempotent.
6. Provider calls are bounded and fail closed.
7. Production AI configuration is explicit and fail closed.
8. CI-10 readiness endpoint is green in the target environment.
9. Synthetic live-provider smoke passes in the target environment before clinical use.
10. CI-10H safety and CI-10F qualified-signature boundaries remain green.

Repository qualification can prove items 1–7 and 10. Items 8–9 require the actual target environment and are deployment evidence, not something a source-code test can truthfully fabricate.

## Relationship to hospital production readiness

Closing CI-10I closes the **CI-10 engineering program**, not every G-HIMS hospital go-live dependency.

The active blocker register remains authoritative for separate items such as:
- independent penetration testing;
- disaster-recovery/restore evidence;
- external monitoring/on-call proof;
- hospital governance approval;
- site PACS/HL7/device/EDI validation where applicable.

Those blockers require their own evidence and must not be marked closed by CI-10I source-code qualification.
