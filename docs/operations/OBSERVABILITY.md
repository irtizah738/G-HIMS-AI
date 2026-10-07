# G-HIMS Operational Observability Contract

## What the application emits

Server operational logs use the `ghims.operational.v1` JSON schema. The logger intentionally drops attribute keys that may contain PHI, credentials, tokens, raw messages, notes, or payload bodies.

Every critical path should emit:
- event name
- success/rejected/failure outcome
- correlation/request ID when available
- non-reversible tenant correlation label
- duration
- safe bounded attributes
- stable error code

## Required dashboard signals

External log/metrics infrastructure should build dashboards for:
- authentication rejection rate by stable error code
- protected-command failure rate
- offline replay pending/conflict counts
- outbox pending/failed/lease-expired counts
- HL7 accepted/rejected/error rates
- AI gateway availability and rejection rates without prompt/response content
- Clinical Intelligence operation success/failure and latency by safe purpose/operation metadata
- Clinical Intelligence provider timeout and safety-gate rejection rates by stable error code
- reconciliation findings by severity/domain
- API p50/p95/p99 latency
- readiness failures and deployment restarts

## Minimum alerts

Alert on:
- sustained readiness failure
- sudden cross-tenant/authorization rejection spike
- outbox backlog above agreed operational threshold
- repeated idempotency conflicts
- HL7 authentication failures or malformed-message spike
- backup job failure
- reconciliation financial imbalance
- repeated production integration attempts while state is not LIVE
- sustained Clinical Intelligence provider failures/timeouts
- Clinical Intelligence readiness becoming not-ready in a deployed pilot/production environment

Thresholds are deployment-specific and must be set from measured hospital traffic. This repository does not claim that an external dashboard, SIEM, pager, or SLO is already provisioned.


## Wave 5 evidence boundary

Wave 5 treats repository telemetry contracts and external alerting as separate gates.

Engineering qualification proves PHI-sanitized structured event emission, readiness behavior, and operational-check logic. STAGING/PILOT qualification additionally requires evidence that the deployment's external log/metrics destination received the test signal and that the configured alert route was delivered and acknowledged.

The authenticated Wave 5 load probe records p50/p95/p99 latency and error rate for a bounded synthetic STAGING read-model workload. Those measurements are qualification samples, not a long-term availability/SLO claim.
