# G-HIMS OS — MASTER ARCHITECTURAL DOCTRINE & AGENT SPECIFICATION

This file establishes the foundational principles, architectural constraints, and engineering response standards for G-HIMS (Generative Healthcare Information Management System).

---

## 1. System Identity & Core Paradigm
G-HIMS is a **Programmable Healthcare + Enterprise Operating System** uniting:
- Clinical Information Systems & EMR/EHR
- Longitudinal Patient Intelligence Graph
- Workflow & Clinical Protocol Orchestration Engines
- Universal Journal ERP (SAP-style FI/CO General Ledger)
- Human Capital Management (HCM) with Credential-Gated Clinical Privileges
- Diagnostics (LIS, RIS, PACS/DICOM, Blood Bank)
- Offline-First Distributed Runtime with IndexedDB & Transactional Outbox
- Human-in-the-Loop AI Copilot & Ambient Intelligence

**Core Formula:**
```
Workflow Engine + Protocol Engine + Immutable Event Store + Projection Engine + Longitudinal Patient Graph + Enterprise ERP + AI Intelligence + Offline Runtime
```

---

## 2. Architectural Non-Negotiables (§95)
- **NEVER** directly mutate historical immutable events. Corrections require compensating reversal events.
- **NEVER** trust client-side authorization, client timestamps, or client-asserted tenant IDs.
- **NEVER** edit posted financial documents. All General Ledger postings follow double-entry ($\sum \text{Debits} = \sum \text{Credits}$); corrections require reversing entries in open periods.
- **NEVER** allow AI to act as an unreviewed clinical or financial authority. AI suggestions remain distinct from clinician-accepted domain commands.
- **NEVER** allow financial or administrative logic to block emergent/life-saving clinical care. Patient safety overrides simplistic revenue locks.
- **NEVER** query raw event streams directly for reporting; all queries and dashboards consume disposable, rebuildable projections (CQRS).
- **ALWAYS** enforce strict tenant isolation at `/tenants/{tenantId}/...` with authenticated server-side validation.
- **ALWAYS** enforce the Transactional Outbox pattern: write business mutations, immutable events, audit logs, and outbox records atomically within the same database transaction.

---

## 3. Engineering Response Format (§97)
Whenever tasked with designing or implementing a G-HIMS domain feature, execute in the following 21-step order:
1. Architecture
2. Domain boundaries
3. Data model
4. State machine
5. Commands
6. Events
7. Firestore schema
8. Indexes
9. Security rules
10. Server-side authorization
11. Transaction boundaries
12. Outbox behavior
13. Projection model
14. Offline behavior
15. Conflict handling
16. Retry / idempotency
17. TypeScript implementation
18. Tests
19. Failure modes
20. Acceptance criteria
21. Deployment considerations

---

## 4. Tenant Runtime Schema Map (§64-66)
All operational data must be rooted in tenant-scoped subpaths:
- `/tenants/{tenantId}/patients` & `/patientIdentityIndex/{identityKey}` (MPI)
- `/tenants/{tenantId}/encounters`, `/encounterStages`, `/encounterEvents`, `/encounterEvidence`
- `/tenants/{tenantId}/workflowDefinitions`, `/workflowSnapshots`, `/clinicalProtocols`
- `/tenants/{tenantId}/clinicalQueues`, `/timelineProjections`, `/clinicalTasks`
- `/tenants/{tenantId}/orders`, `/prescriptions`, `/labResults`, `/radiologyResults`
- `/tenants/{tenantId}/journalEntries`, `/journalLines`, `/patientInvoices`, `/arOpenItems`, `/paymentTransactions`
- `/tenants/{tenantId}/employees`, `/employeeIdentityIndex`, `/clinicalCredentials`, `/clinicalPrivileges`, `/rosterAssignments`, `/attendanceRecords`, `/payrollResults`
- `/tenants/{tenantId}/outbox`, `/auditLogs`

---

## 5. Master Backend Architecture Specification

### Core Execution Flow
```
                    G-HIMS Backend Execution Pipeline

                             COMMAND
                                │
                                ▼
                       Authentication (Firebase Auth)
                                │
                                ▼
                     Tenant Resolution (Claims & Scope)
                                │
                                ▼
                       RBAC + ABAC + IAM
                                │
                                ▼
                Clinical / Financial / HCM Authorization
               (Verified Credentials & Clinical Privilege)
                                │
                                ▼
                      Domain Input Validation (Zod)
                                │
                                ▼
                        State Machine Check
                                │
                                ▼
                          Domain Service
                                │
                                ▼
                      Firestore Transaction
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
                Domain       Domain       Audit
                State        Event        Record
                    │           │           │
                    └───────────┼───────────┘
                                ▼
                          Outbox Event
                                │
                                ▼
                       Transaction Commit
                                │
                                ▼
                        Outbox Dispatcher
                                │
                                ▼
                             Pub/Sub
                                │
                   ┌────────────┼────────────┐
                   ▼            ▼            ▼
               Clinical       Finance       HCM
              Projection    Projection   Projection
                   │            │            │
                   └────────────┼────────────┘
                                ▼
                           Read Models
                                │
                                ▼
                              QUERY
                                │
                                ▼
                           UI / PWA / API
```

### Backend Principles & Guarantees
1. **Server-Side Authoritative & Zero-Trust Client**: The UI and IndexedDB are strictly untrusted local environments. All domain mutations, state transitions, financial balance calculations, clinical privilege verifications, and event generations execute in trusted server-side execution contexts.
2. **Deterministic Transactional Atomic Multi-Writes**: Every domain mutation executes in an atomic Firestore transaction writing: `Domain Business Document` + `Immutable Event` + `Audit Log Record` + `Transactional Outbox Message`.
3. **Idempotency & Deduplication Engine**: Every retryable mutation enforces an `idempotencyKey` and request hash check to prevent duplicate invoice generation, double pharmacy dispensing, or phantom accounting journals.
4. **Asynchronous Outbox & Disposable Projections**: The Outbox Dispatcher guarantees at-least-once message delivery to Pub/Sub. Independent projection workers idempotently consume domain events to maintain rebuildable read models (`CQRS`).
5. **Multi-Layered Clinical Authorization**: Clinical actions require active verification of `User + Tenant + Role + Department + Verified Credentials + Clinical Privilege + Stage Context`.
6. **Double-Entry Monetary Invariance**: All monetary values use integer minor units (e.g. cents). All General Ledger postings balance precisely ($\sum \text{Debits} = \sum \text{Credits}$).
7. **Offline Mutation Reconciliation**: Reconnection batches from IndexedDB undergo deterministic server-side conflict resolution, preserving both historical offline attempts and system integrity.
