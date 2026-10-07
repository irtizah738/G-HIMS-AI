# Wave 5 — Enterprise Hardening

## Purpose

Wave 5 is the final engineering and operational qualification program before a controlled Hospital-0 pilot.

It does **not** convert repository CI into a production claim. G-HIMS uses the following readiness states:

- BUILDING
- ENGINEERING_QUALIFIED
- STAGING_QUALIFIED
- PILOT_QUALIFIED
- PRODUCTION_QUALIFIED

Wave 5 may be called ENGINEERING_QUALIFIED after its deterministic CI gate is green. STAGING/PILOT qualification requires evidence from a deployed environment and external/human gates.

## W5A — Deployed cross-role E2E

Existing assets are reused rather than replaced:

- STAGING readiness smoke;
- P7 authenticated multi-role hospital-day rehearsal;
- DRP-10 authenticated clinical/Finance/SCM/HCM/Facilities rehearsal;
- deployed OPD cross-role Playwright journey;
- Wave 2 deployed clinical workspace Playwright journey where fixture evidence is available.

All qualification tenants and patients are synthetic.

## W5B — Load and concurrency

Wave 5 adds an authenticated remote-STAGING load probe against the server-authoritative offline/bootstrap read model.

The probe:

- signs in through Firebase Authentication;
- establishes a G-HIMS server session;
- performs bounded concurrent authenticated requests;
- records p50/p95/p99 and error rate;
- contains no token/password/email in evidence;
- fails when the configured error-rate or p95 threshold is exceeded.

This is qualification evidence, not a claim of a long-term SLO.

## W5C — Backup, restore, rollback and projection recovery

The existing isolated Firestore restore and deterministic projection rebuild remain authoritative.

Wave 5 adds an explicit isolated failure-injection point after projection-worker execution. Production remains blocked from destructive rebuild and from failure injection.

Required recovery evidence includes:

1. real Firestore export/import into an isolated project;
2. measured RPO/RTO;
3. injected rebuild failure with FAILED manifest;
4. clean deterministic rerun;
5. known-good deployment rollback/redeploy rehearsal.

Never repair recovery failures by deleting immutable events.

## W5D — Security closure

Repository penetration regressions remain required, but they are not an independent penetration test.

PILOT_QUALIFIED still requires an independent security assessment artifact and documented retest outcome.

## W5E — Observability and alerting

G-HIMS emits PHI-sanitized structured operational telemetry and already exposes readiness/liveness checks.

Wave 5 requires deployment evidence for:

- outbox pending/failed/dead-letter/expired-lease health;
- readiness availability;
- authentication/authorization rejection trends;
- integration failure rates;
- p95/p99 latency;
- external alert delivery and acknowledgement.

The repository does not claim an external SIEM/pager is provisioned until alert-routing evidence is supplied.

## W5F — Retention and governance

Application code must never TTL-delete clinical, financial, event, or audit authority.

Retention classes are defined in `lib/governance/data-retention-policy.ts`.

Key rules:

- clinical and financial authority are immutable;
- security audit evidence is immutable;
- projections are disposable only through guarded operational rebuild;
- operational telemetry must be PHI-free;
- raw integration payload retention is off by default;
- deployed STAGING/PRODUCTION environments require explicit retention configuration.

Legal/regulatory retention durations remain deployment/jurisdiction policy and must not be invented by the application.

## Engineering gate

Run:

`bun run validate:wave5`

The gate covers Wave 5 contracts, DRP recovery/security boundaries, Wave 4 interoperability, Wave 3 clinical integration, P8 baseline, offline resilience, security regression, Firestore rules and production build.

## Live STAGING gate

Use the manual Wave 5 STAGING qualification workflow against a remote HTTPS deployment.

Evidence must be stored under `artifacts/wave5` and evaluated with:

`bun run ops:wave5:evidence`

Set `GHIMS_WAVE5_REQUIRE_COMPLETE=true` only when all external/human artifacts are genuinely present.
