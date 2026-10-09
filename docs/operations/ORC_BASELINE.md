# ORC operational reliability closure baseline

Baseline: 2026-10-09. Source: G-HIMS-AI `main` PR #132 (`3836102b8`) and PR #133 (`dbb3716d`). Tenant production state is **not** verified by source or CI results.

## Invariants
1. No module hydrates across an unverified tenant/session boundary.
2. Consultant identity must resolve from the canonical tenant membership document UID, with verified HCM credential/privilege and facility/service scope.
3. Emergency treatment starts independently of prepayment; encounter and care-setting transitions remain server-governed.
4. Vital signs are recorded against a verified encounter as immutable clinical observations and are never called committed while offline queued.
5. Patient billing clearance requires authoritative payment posting, AR and final encounter reconciliation.
6. All command retries use durable idempotency, and failed operations cannot present an optimistic authoritative state.
7. Every of the 52 directory domains is separately qualified. Edge hydration surfaces are not the same thing as domain readiness.

## Evidence requirements
Per ORC change: source SHA, test names, branch checks, staging deployment SHA, authenticated tenant/role/facility, sanitized command/event/audit identifiers, offline/failure injection evidence, and clinical/finance approvals as relevant.

## Source integration completed; operational checks outstanding

As of October 9, ORC integrated PR #145 and Firebase staging preparation PR #146 are merged into `main` (baseline merge SHA `af9812c97290633159fedf538abd7be28dfe0e06`). This supersedes the earlier branch-level source concerns listed below. Full Hospital-0 operational acceptance remains 0/15 until deployed evidence exists.

## Historical pre-integration blockers (retain for traceability)
- PR #133 code merged after passing 73 CI checks; live consultant directory remains unverified.
- **Addressed in merged code:** HCM credential and privilege authority was tightened in PR #145; deployed cross-role authority tests are still pending.
- **Addressed in merged code:** ORC-1 and ORC-1B tenant/session cache guards were integrated; deployed tenant switch/recovery qualification remains outstanding.
- Direct ER admission still requires deployed facility-scoped census, provisional identity and ER-to-IPD transfer qualification.
- Recording vitals requires correct credential/privilege grant and explicit NEWS2 completeness.
- Billing must pass collection -> GL/AR -> final reconciliation, including contention and network failure.
- All 52 domains require per-domain verification: never report green from navigation cards or eight edge surfaces alone.

## Release state
Block Hospital-0 operational sign-off until all ORC-0 through ORC-9 qualified in the target staging environment. Do not rewrite prior events or payments for fixture repair; use governed corrections.
