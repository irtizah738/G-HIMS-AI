# G-HIMS OS — Final Product Perfection, Clinical UX, Reliability & Production Polish Audit
**Document Version:** 1.0.0-PROD-RC  
**Target Release:** G-HIMS OS Enterprise Pilot Release Candidate  
**Audit Scope:** Full-Stack Architecture, Clinical Continuity, ERP Financial Invariance, Real-Time Interoperability, Zero-Trust Authorization & Offline Resilience  

---

## 1. Executive Summary & Audit Baseline

G-HIMS OS (Generative Healthcare Information Management System) is an operating system uniting Clinical Care (EMR/EHR), Longitudinal Patient Intelligence Graphs, Workflow Protocol Engines, Universal Double-Entry ERP General Ledgers, HCM with Credential-Gated Privileges, Diagnostic Interoperability (LIS/RIS, HL7 v2, FHIR R4), Offline-First Edge Sync, and Human-in-the-Loop Clinical AI.

This audit evaluates the codebase against the **Single Hospital Operating System** doctrine:
```
ONE PATIENT → ONE LONGITUDINAL RECORD → ONE OPERATIONAL CONTEXT → ONE AUDITABLE EVENT HISTORY → ONE FINANCIAL TRUTH → ONE RESOURCE / WORKFORCE CONTEXT → ONE HOSPITAL OPERATING SYSTEM
```

### System Health Snapshot
- **Core Test Suite:** 52/52 automated tests passing (151 assertions across 5 suites).
- **TypeScript & Linting:** Clean build with Next.js 15.5 App Router; 0 ESLint warnings.
- **Active Firestore DB:** `ai-studio-ghimsos-8d860f4b-3a80-47b3-bf97-15b9dc0d7fa7`.
- **Primary Operational Tenants:** `central-metro-hospital` (Central Metro General Hospital, CMGH-01), `grace-valley-general` (GVGH-02), `government-gynae-hospital` (GGH-01), and `st-jude-trauma-center` (SJTC-04).

---

## 2. Comprehensive Inventory of Existing Subsystems

### 2.1 Existing Pages & Route Structure
| Route Path | View / Component | Functional Responsibility |
|---|---|---|
| `/` | `TenantDashboard` inside `AuthGuard` | Master single-screen Hospital Operating System console |
| `/[tenantId]` | `TenantDashboard` with dynamic tenant | Tenant-scoped entry point for multi-hospital networks |
| `/[tenantId]/admin` | Multi-Tenant Admin & Facility Config | Regional hospital directory, license limits, security policies |
| `/[tenantId]/billing` | Billing & Revenue Assurance | Claims scrubber (EDI 837), point-of-care audit engine |
| `/[tenantId]/diagnostics` | LIS & RIS Imaging Diagnostics | Lab specimen accessioning, DICOM viewer, blood bank |
| `/[tenantId]/erp` | Universal General Ledger ERP | Double-entry journals, chart of accounts, fixed assets |
| `/[tenantId]/hcm` | Workforce & Clinical Privileges | Roster scheduling, fatigue compliance, license lockout |
| `/[tenantId]/inpatient` | Bed Occupancy & Inpatient Census | Ward bed allocation, cleaning workflow, census projection |
| `/[tenantId]/or` | Operating Theater Management | Surgical suite scheduling, anesthesia readiness, timeout checklist |
| `/[tenantId]/scm` | Supply Chain & Pharmacy Point-of-Sale | FEFO batch tracking, min-max reordering, e-prescriptions |
| `/[tenantId]/settings` | System Settings & Governance | Security rules, HL7 MLLP endpoints, audit retention |

### 2.2 Existing Dashboard Views (`components/views/`)
1. **`command-hub-view.tsx`**: Executive & clinical command center, real-time census, revenue recovery metrics, pending mismatches, bed capacity gauge.
2. **`patient-mpi-view.tsx`**: Master Patient Index, longitudinal EHR history, biometric barcodes, digital wristbands, clinical notes, lab orders.
3. **`opd-encounters-view.tsx`**: Outpatient Department queue, token calling, SOAP documentation, e-prescribing, consultant routing.
4. **`emergency-triage-view.tsx`**: Emergency trauma center, ESI 1-5 triage, EMS pre-hospital radio, telemetry ingestion, fast-track transfers.
5. **`bed-occupancy-view.tsx`**: Visual ward census, interactive bed board, telemetry vitals, admission/discharge management.
6. **`surgery-theater-view.tsx`**: Operating Theaters (OT 1-6), surgical procedure schedule, anesthesia clearance, WHO surgical safety checklist.
7. **`disease-centric-intake-view.tsx`**: Protocol-driven disease workflows (cardiac, stroke, sepsis, maternal, trauma, pediatric), dynamic symptom trees.
8. **`workflow-runtime-view.tsx`**: Interactive DAG workflow orchestrator, stage execution, visual node editor, state progression.
9. **`telehealth-view.tsx`**: WebRTC video consult room, live transcription, dual-sync clinical notes, electronic prescribing (e-Rx).
10. **`ancillary-services-view.tsx`**: Diagnostic laboratory, specimen barcode scanner, PACS/DICOM viewer with radiology reporting.
11. **`blood-bank-view.tsx`**: Blood inventory, crossmatch safety verification, donor management, transfusion reaction tracking.
12. **`orders-interop-view.tsx`**: HL7 v2.x parser/dispatcher (ADT, ORU, ORM) and FHIR R4 resource transformation hub.
13. **`google-sheets-view.tsx`**: Google Sheets bidirectional sync, tabular data export, spreadsheet reconciliation.
14. **`billing-erp-view.tsx`**: Clinical documentation vs. billing mismatch validator, revenue recovery tracker, patient invoices.
15. **`claims-preauth-view.tsx`**: Insurance claim scrubber, EDI 837 generation, ANSI X12 validator, pre-authorization requests.
16. **`supply-chain-scm-view.tsx`**: Pharmaceutical inventory, FEFO batch expiry control, automated purchase requisitions, POS dispensing.
17. **`hr-management-view.tsx`**: Hospital workforce directory, credential verification, license expiry lockouts, shift rosters.
18. **`resource-capacity-view.tsx`**: Biomedical equipment asset register, calibration log, maintenance work orders, room scheduling.
19. **`audit-ledger-view.tsx`**: Immutable cryptographic audit logs, SHA-256 hash chaining, edge sync outbox monitor.
20. **`patient-portal-view.tsx`**: Patient self-service portal, appointments, medication refills, diagnostic reports, invoice payment.
21. **`all-modules-directory.tsx`**: Complete 52-domain taxonomy directory across clinical, operational, and financial subsystems.
22. **`module-readiness-matrix-view.tsx`**: Enterprise architecture maturity, compliance matrices, security controls.
23. **`settings-view.tsx`**: Hospital configuration, network sync status, localization, tenant metadata.
24. **`staff-view.tsx`**: Clinical department staff scheduling, contact directory, on-call roster.

### 2.3 Existing Backend Domain Services & Infrastructure
- **Command Bus (`lib/backend/commands/command-bus.ts`)**: Authoritative command router enforcing idempotency caching, role authorization, and state transitions.
- **Transaction Manager (`lib/backend/transactions/transaction-manager.ts`)**: 4-way atomic multi-document writes: Domain State + Immutable Event + Audit Record + Outbox Entry.
- **Encounter Domain Service (`lib/backend/services/encounter-domain-service.ts`)**: Governed clinical encounters, stage transitions, handoff SBAR, evidence links.
- **Clinical Order Domain Service (`lib/backend/services/clinical-order-domain-service.ts`)**: Diagnostic lab orders, STAT overrides, e-prescriptions with allergy checks.
- **Financial Ledger Service (`lib/backend/services/financial-ledger-domain-service.ts`)**: Double-entry journal voucher posting ($\sum \text{Debits} = \sum \text{Credits}$), balance calculations.
- **HR & Workforce Domain Service (`lib/backend/services/hr-workforce-domain-service.ts`)**: Employee lifecycle, credential verification, shift rosters, 10-hour rest enforcement.
- **Resource Capacity Service (`lib/backend/services/resource-capacity-domain-service.ts`)**: Biomedical equipment reservation, calibration safety lockouts, maintenance orders.
- **Idempotency Service (`lib/backend/idempotency/idempotency-service.ts`)**: Zero-duplicate request deduplication with payload hash collision checks.
- **Projection Workers (`lib/backend/projections/projection-workers.ts`)**: CQRS asynchronous projection workers maintaining disposable read models.
- **Outbox Dispatcher (`lib/backend/outbox/dispatcher.ts`)**: At-least-once message delivery pipeline.
- **Registration Orchestrator (`lib/runtime/registration-orchestrator.ts`)**: Atomic patient registration and encounter creation with national ID indexing.
- **Double-Entry Ledger Engine (`lib/finance/double-entry-ledger.ts`)**: Authoritative debit/credit accounting engine.
- **NEWS2 Calculator (`lib/clinical/triage/news2-calculator.ts`)**: National Early Warning Score 2 algorithm for patient deterioration detection.
- **FEFO Pharmacy Manager (`lib/clinical/pharmacy/fefo-manager.ts`)**: First-Expired, First-Out batch allocation and dispensation safety.
- **Diagnostic Revenue Guard (`lib/clinical/diagnostic-lock/revenue-guard.ts`)**: Revenue leakage prevention with emergent clinical life-safety bypass.
- **Device Telemetry Adapter (`lib/interop/device-telemetry-adapter.ts`)**: Ingestion and validation of external telemetry packets and Lead II ECG waveforms.
- **Radio Intercom Adapter (`lib/interop/radio-intercom-adapter.ts`)**: Paramedic verbal medical orders with closed-loop readback verification.
- **HL7 v2.x Processor (`lib/interop/hl7-parser.ts`)**: Standards-compliant parser for ADT^A01, ORU^R01, and ORM^O01 messages.

### 2.4 Existing Firestore Collections & Data Model
- `/user_profiles/{userId}`: User identity, roles, assigned departments.
- `/patients/{patientId}`: Master Patient Index (MPI), demographic records, allergies, chronic conditions, encounter history.
- `/beds/{bedId}`: Ward bed inventory, occupancy state, assigned patient, equipment telemetry.
- `/billing_mismatches/{mismatchId}`: Discovered clinical note vs. billing fee discrepancies.
- `/opd_queue/{tokenId}`: Outpatient clinic queue, priority, consultation status.
- `/audit_logs/{logId}`: Immutable system audit records with SHA-256 integrity hashes.
- `/telehealth_sessions/{sessionId}`: Virtual visit rooms, vitals, transcription logs, e-prescriptions.
- `/tenants/{tenantId}/...`: Multi-tenant subcollections (accounts, journal entries, staff, resources, work orders).

---

## 3. Findings Matrix & Classification

Findings are classified into five severity tiers:
- **CRITICAL**: Threatens patient safety, financial integrity, system stability, or core architectural non-negotiables.
- **HIGH**: Inconsistent clinical workflow, broken cross-module patient context, unhandled navigation routes, or unvalidated state transitions.
- **MEDIUM**: Suboptimal user feedback, missing empty states, redundant local states, or minor styling discrepancies.
- **LOW**: Minor layout polish, alignment adjustments, or missing tooltips.
- **COSMETIC**: Typography kerning, subtle color adjustments, or micro-spacing.

### 3.1 CRITICAL Findings

#### [FINDING-CRIT-01] Broken Module Navigation via Hardcoded External Routes in Collapsible Sidebar
- **Location:** `components/navigation/collapsible-sidebar.tsx` (lines 203, 210, 287, 294, 301, 366-373)
- **Description:** The sidebar declared `directHref: '/metro-health/or/schedule'`, `directHref: '/metro-health/inpatient/bed-board'`, `directHref: '/metro-health/erp/chart-of-accounts'`, `directHref: '/metro-health/hcm'`, and `directHref: '/metro-health/hcm/resources'`. When clicked, `handleSelectTab` called `router.push(item.directHref)`, navigating the user away from the unified single-page `TenantDashboard` to isolated legacy routes hardcoded to `metro-health` rather than the active tenant (`central-metro-hospital`). Furthermore, `TenantDashboard` already contains complete, rich in-tab components (`SurgeryTheaterView`, `BedOccupancyView`, `BillingErpView`, `HrManagementView`, `ResourceCapacityView`) that were bypassed.
- **Impact:** Shatters the "One Hospital Operating System" architectural mandate; disrupts active clinical session state; creates confusion when switching between inpatient and surgical contexts.
- **Remediation:** Remove `directHref` from internal modules in `navigationSections`; let `handleSelectTab` route directly via `setActiveTab(item.id)` so the user remains in the unified, synchronized application shell.

#### [FINDING-CRIT-02] TypeScript Build-Breaking Enums in Telehealth & Offline Mutations
- **Location:** `components/views/telehealth-view.tsx` (line 385), `lib/types/ghims.ts` (lines 210, 332)
- **Description:** `telehealth-view.tsx` assigned `status: 'PENDING_TRANSMISSION'`, but `TelehealthPrescription.status` in `lib/types/ghims.ts` only permitted `'DRAFT' | 'TRANSMITTED' | 'DISPENSED'`. Similarly, `lib/context/hospital-context.tsx` called `recordMutation('INSERT_TELEHEALTH_SESSION')` and `recordMutation('COMPLETE_TELEHEALTH_SESSION')`, but `OfflineMutation.actionType` lacked these members.
- **Impact:** Broke `next build` during production compilation.
- **Status:** **RESOLVED** (Updated `lib/types/ghims.ts` to include `'PENDING_TRANSMISSION'` and the full union of mutation action types; `compile_applet` now compiles with 0 errors).

---

### 3.2 HIGH Findings

#### [FINDING-HIGH-01] Hardcoded Tenant ID in SCM & ERP Integrations
- **Location:** `components/tenant-dashboard.tsx` (line 332), `app/[tenantId]/erp/chart-of-accounts/page.tsx` (line 33)
- **Description:** `<SupplyChainScmView tenantId="metro-health" />` was hardcoded to `metro-health`, ignoring the active tenant (`central-metro-hospital` or user-selected tenant).
- **Impact:** Multi-tenant leakage and broken inventory queries when switching facilities.
- **Remediation:** Pass the dynamic tenant ID from `useTenant()` or `useHospital()` into `SupplyChainScmView`.

#### [FINDING-HIGH-02] Fragmented Patient Context Across Clinical Views
- **Location:** `components/views/disease-centric-intake-view.tsx` (line 56), `components/views/billing-erp-view.tsx` (line 31), `components/views/opd-encounters-view.tsx` (line 42)
- **Description:** Multiple views maintained isolated local states (e.g. `const [activePatientId, setActivePatientId] = useState('p-1001')` or `const [selectedTokenId, setSelectedTokenId] = useState('tok-01')`) rather than synchronizing with the central `selectedPatientId` and `setSelectedPatientId` in `HospitalContext`.
- **Impact:** When a clinician selected a patient in the MPI (Patient EHR Index) and navigated to Disease Intake or Billing, the view did not automatically focus on the selected patient, violating the "ONE PATIENT → ONE OPERATIONAL CONTEXT" principle.
- **Remediation:** Wire `selectedPatientId` from `useHospital()` as the primary source of truth across all views, updating local state when `selectedPatientId` changes.

#### [FINDING-HIGH-03] Missing In-App View Mapping for Enterprise Chart of Accounts (`erp-coa`)
- **Location:** `components/tenant-dashboard.tsx`
- **Description:** The sidebar had an item with `id: 'erp-coa'` ("Enterprise General Ledger"), but `TenantDashboard` had no `{activeTab === 'erp-coa' && ...}` branch. Clicking it would render nothing if `directHref` was removed.
- **Impact:** Inaccessible general ledger view from the unified dashboard.
- **Remediation:** Map `erp-coa` to `BillingErpView` or provide a seamless tab inside the financial view displaying the full Chart of Accounts and Universal Journal vouchers.

#### [FINDING-HIGH-04] Metadata & HTML Entrypoint Title Discrepancy
- **Location:** `metadata.json` vs. `app/layout.tsx`
- **Description:** `metadata.json` specified `name: "G-HIMS OS | Hospital Information System"`, whereas `app/layout.tsx` had `title: "G-HIMS OS | Generative Healthcare Information Management System"`.
- **Impact:** Violates framework synchronization guidelines.
- **Remediation:** Synchronize `metadata.title` and `metadata.description` in `app/layout.tsx` to match `metadata.json` exactly.

---

### 3.3 MEDIUM Findings

#### [FINDING-MED-01] OPD Consultation to EHR Clinical Notes Sync Toast Verification
- **Location:** `components/views/opd-encounters-view.tsx`
- **Description:** Saving an OPD consultation correctly calls `addClinicalNote`, but does not visibly notify the user with the exact patient name and target encounter stage.
- **Remediation:** Add contextual confirmation toast with quick-action links to view the newly logged note in the Patient EHR Index.

#### [FINDING-MED-02] Patient Emergency Transfer to Bed Allocation Handshake
- **Location:** `components/views/emergency-triage-view.tsx`
- **Description:** When an emergency case is transitioned to `admitted_icu`, the system should prompt for immediate ICU bed reservation or auto-link to an available ICU bed from `beds`.
- **Remediation:** Enhance `handleAdmitIcu` to allocate an available ICU bed and update the bed's status to `occupied` with patient details.

#### [FINDING-MED-03] SCM Reorder Trigger to ERP Accounts Payable Flow
- **Location:** `components/views/supply-chain-scm-view.tsx`
- **Description:** Automated purchase orders in SCM do not generate a corresponding pending Accounts Payable journal voucher in the ERP financial engine.
- **Remediation:** Connect the PO generation action to emit an ERP journal voucher event (`PostJournalCommand`) with DR Inventory / CR Accounts Payable.

---

### 3.4 LOW & COSMETIC Findings

#### [FINDING-LOW-01] Missing Patient Filter Badge in Telehealth Consultation Queue
- **Location:** `components/views/telehealth-view.tsx`
- **Description:** Filter buttons lack badge counts for Waiting Room vs. In Consultation sessions.
- **Remediation:** Add numeric badges to tab pills.

#### [FINDING-COSM-01] Mobile Drawer Backdrop Touch Target
- **Location:** `components/navigation/collapsible-sidebar.tsx`
- **Description:** Mobile drawer close button has 40px touch target; guidelines recommend at least 44px on mobile viewports.
- **Remediation:** Update `min-w-[44px] min-h-[44px]` on the mobile close button.

---

## 4. Prioritized Execution & Remediation Plan

1. **Step 1 (CRITICAL & HIGH): Navigation Continuity & Tenant Consistency**
   - Refactor `CollapsibleSidebar` to remove disruptive `directHref` navigation for core clinical/operational views (`surgery`, `beds`, `hcm`, `resources`, `erp-coa`).
   - Add `{activeTab === 'erp-coa' && ...}` in `TenantDashboard`.
   - Pass dynamic `tenantId` into `SupplyChainScmView`.
   - Synchronize `app/layout.tsx` metadata with `metadata.json`.

2. **Step 2 (HIGH): Cross-Subsystem Patient Continuity**
   - Synchronize `selectedPatientId` across `DiseaseCentricIntakeView`, `BillingErpView`, and `OpdEncountersView`.
   - Ensure selecting a patient in any view immediately updates the global context.

3. **Step 3 (MEDIUM): Cross-Subsystem Clinical Handshakes**
   - Connect ER ICU admission directly to Bed Census bed allocation.
   - Verify automated double-entry ledger balance for billing reconciliations.

4. **Step 4: Verification & Compilation**
   - Run `bun test tests/` to confirm all 52 tests remain green.
   - Run `lint_applet` and `compile_applet` to ensure pristine production readiness.
