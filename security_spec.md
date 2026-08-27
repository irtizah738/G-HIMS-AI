# G-HIMS Security Specification & Firestore Hardening Blueprint

## Security Decisions Log

### Sprint 1 — Security Foundation & Contract Fixes (May 18, 2026)

#### Decision 1: Enforce authentication at callable function boundary
- **Applies to:** `createPatient`, `createEncounterAndPatient`
- **Rule:** Reject requests without `request.auth.uid`.
- **Error contract:** `HttpsError('unauthenticated', 'Authentication is required.')`
- **Rationale:** Prevent anonymous writes into sensitive clinical runtime.

#### Decision 2: Enforce role-based authorization in callable functions
- **Allowed roles:** `doctor`, `front-desk`, `hospital-admin`
- **Error contract:** `HttpsError('permission-denied', 'Insufficient role privileges.')`
- **Rationale:** Restrict mutation paths to explicit operational roles.

#### Decision 3: Validate request payloads with Zod schemas
- **Rule:** Requests must pass strict input schema checks before any runtime action.
- **Error contract:** `HttpsError('invalid-argument', <first validation issue>)`
- **Rationale:** Reduce malformed writes and prevent undefined runtime behavior.

#### Decision 4: Normalize callable contracts to tenant-aware payloads
- `createPatient` payload contract: `{ tenantId, patient }`
- `createEncounterAndPatient` payload contract: `{ tenantId, patient, encounter }`
- **Rationale:** Align function-layer payloads with runtime server action signatures and multi-tenant design.

#### Decision 5: Add handler-level contract tests for authz and validation behavior
- **Coverage:** unauthenticated, unauthorized, invalid payload, and valid-role success paths.
- **Rationale:** Ensure deterministic security behavior and reduce authz regression risk.

### Sprint 1.1 — Contract Confidence Expansion (May 18, 2026)

#### Decision 6: NodeNext import compatibility for function runtime loading
- Updated dynamic import path to explicit `.js` extension for NodeNext compatibility.
- **Rationale:** Eliminate TS2835 editor/runtime resolution mismatch in function package context.

#### Decision 7: Expanded contract test coverage
- Added positive authorization test for `hospital-admin` role.
- Added invalid payload test for `createEncounterAndPatientHandler` missing required fields.
- **Rationale:** Improve contract confidence before emulator-level integration testing.

---

## 1. Data Invariants
1. **Patient Invariant**: Patients must have valid alphanumeric IDs (`isValidId`), valid MRN, and full name.
2. **Bed Invariant**: Ward bed updates must preserve bed number and ward assignment, and only permit valid status transitions (`available`, `occupied`, `maintenance`, `cleaning`, `reserved`).
3. **Billing Reconciliation Invariant**: Billing mismatch items must include a positive recoverable revenue number and valid status (`pending_review`, `reconciled`, `dismissed`).
4. **OPD Queue Invariant**: Outpatient tokens must belong to a known patient and hospital department.
5. **Audit Ledger Invariant**: Audit log records are append-only / immutable once recorded to satisfy HIPAA log tamper-proofing rules. Updates and deletions on audit logs are strictly denied.
6. **Master Gate / Authentication Invariant**: All read and write operations require authenticated medical or administrative credentials (`isSignedIn()`).
7. **Identity Integrity**: Staff member updates can only be modified by verified clinical administrators or assigned staff users.

## 2. The "Dirty Dozen" Threat Payloads (Must be Denied by Rules)
1. **Unauthenticated Read on Patient EHR**: Direct access from anonymous actor without auth token.
2. **Ghost Field Poisoning on Bed**: Injecting unauthorized `isAdmin: true` or `bypassedSecurity: true` into a Bed document.
3. **1MB ID String Overflow**: Injecting 1MB junk document ID instead of standard regex-bounded ID (`isValidId`).
4. **Negative Revenue Recovery**: Writing `-50000` to `estimatedRecoverableRevenue` in billing mismatches.
5. **Audit Log Tampering**: Attempting an `update` or `delete` on an existing `/auditLogs/{logId}` record.
6. **Blanket Collection Scrape Without Auth**: Querying `/patients` without authentication.
7. **Cross-Tenant MRN Spoofing**: Overwriting `mrn` on an existing patient record to hijack medical charts.
8. **Invalid Ward Status**: Assigning status `'destroyed'` or non-conforming status strings to a bed.
9. **Unbounded Payload Injection**: Injecting a 20KB raw note into a short description field.
10. **Orphaned Token Creation**: Creating an OPD queue token without a valid `patientId`.
11. **Direct User Privilege Escalation**: Setting `role: 'SuperAdmin'` on standard staff profile.
12. **Tampering with HL7 Message Telemetry**: Overwriting a parsed diagnostic HL7 message status to bypass physician review.

