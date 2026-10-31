# Helixis AI — Brand architecture and controlled migration

Status: **Brand selected by founder; implementation draft only**.  
Date: 2026-10-29  
Scope: **Identity, naming, and rollout only**. This document does not alter application behavior, deployment, clinical governance, security policy, or validation evidence.

## Company and products

| Purpose | Public-facing name | Legacy/internal identifier |
| --- | --- | --- |
| Proposed U.S. corporate entity | **Helixis Technologies, Inc.** | Former G-HIMS organization branding |
| Corporate identity | **Helixis AI** | G-HIMS / G-HIMS AI |
| Flagship healthcare AI | **Helixis Clinical Intelligence** | G-HIMS Clinical Intelligence / CI |
| Planned cross-industry finance AI | **Helixis Financial Intelligence** | Future product; no existing production deployment |
| Planned cross-industry operations AI | **Helixis Operations Intelligence** | Future product; no existing production deployment |
| Native healthcare infrastructure | **Helixis Health Platform** | G-HIMS OS |

Do **not** use "Helixis Core" as the infrastructure product name.

## Positioning and architecture

**Helixis AI** is an AI technology company that builds specialized intelligence products across industries. Its first commercial product is **Helixis Clinical Intelligence**, evidence-grounded clinical AI for hospital teams.

**Clinical Intelligence is independently deployable and must integrate with third-party hospital systems.** Buying or installing **Helixis Health Platform** must not be required to use Clinical Intelligence. The Health Platform is the native event-driven, offline-first hospital workflow and data infrastructure. It is not the same product as Operations Intelligence.

Commercial priority remains Clinical Intelligence. Financial Intelligence and Operations Intelligence are planned product families; do not describe them as launched, validated, or revenue-generating without corresponding evidence.

### Messaging guardrails

- Do not promise autonomous diagnosis, prescribing, treatment, or clinician replacement.
- Distinguish verified clinical validation from synthetic demonstrations.
- Preserve provenance, uncertainty, auditability, clinician authority, and governed draft/signature chains in product claims.
- Avoid claims of "absolute truth" or proven elimination of all clinical errors; use evidence-grounded and traceable language.
- Do not invent clinical customer deployments, quantitative outcomes, certifications, or regulatory clearances.

## Visual identity (provisional implementation tokens)

- Sovereign navy: `#0B132B`
- Clinical blue/cyan: `#48CAE4`
- Accent mint/cyan: `#00F5D4`
- Polar white: `#F8F9FA`

Use an original wordmark and icon system; independently verify logo distinctiveness and ownership before final public release.

## Rebrand change sequence

1. **Brand source-of-truth:** this document records the founder's selected working identities. Corporate and trademark filing decisions remain separate legal processes; user-reported availability checks are not represented as an attorney's clearance opinion.
2. **Investor documents:** update the 12-slide Clinical Intelligence fundraising deck and investor demo narrative consistently, without changing underlying claims, metrics, and paid-pilot strategy.
3. **Synthetic investor demo:** change visible text, headings, metadata, and visual marks in a dedicated reviewed PR; test demo identity isolation, synthetic-data guardrails, authentication, and investor access.
4. **Clinical Intelligence app:** change user-visible copy and assets only; run typecheck, build, authorization, safety, offline and regression qualification. No renaming of event types, telemetry fields, database paths, or service identifiers in a cosmetic PR.
5. **Health Platform:** inventory UI surfaces and stage a separate reviewed branding change in the appropriate source tree. Do not assume the historical G-HIMS-OS repository is the canonical production source.
6. **Operations and legal:** after brand assets are approved, update external domains, support addresses, legal policies, corporate filings and third-party integrations through individually tested plans.
7. **Cleanup:** remove obsolete *display* references only after customer migration and documentation review. Historical governance documents and immutable evidence preserve their original names with a cross-reference.

## Safety / deployment invariants

- `irtizah738/G-HIMS-AI` is the authoritative deployable application source under the documented repository contract. `irtizah738/G-HIMS-OS` is a separate historical staging/testing tree and must not be merged wholesale into the production application.
- Retain the existing GitHub repository names, branch protection, Firebase/GCP project IDs, database IDs, tenant IDs, environment variable keys, service accounts, webhook endpoints, Vercel deployment targets, event topics, audit payload keys, and stable API routes until a separately qualified technical migration.
- Preserve TEST/STAGING/DEMO/PRODUCTION isolation; synthetic-only demo data stays synthetic only.
- No customer-facing or production promotion before the necessary review, build/security qualification and explicit controlled release approval.
- Preserve traceability to the legacy G-HIMS names in research and clinical evaluation evidence.

## Draft PR acceptance criteria

- Naming map is reviewed and consistent.
- No runtime, auth, data, service configuration, governance, or deployment modifications.
- Follow-on design and UI rebrand PRs are isolated, testable and reversible.
