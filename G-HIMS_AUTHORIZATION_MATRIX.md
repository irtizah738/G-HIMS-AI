# G-HIMS OS — MULTI-LAYERED AUTHORIZATION & PRIVILEGE MATRIX
**Version:** 2.0 (Zero-Trust Production Standard)  
**Verification Level:** Server-Side Authoritative (§5, §6, §10)  
**Security Governance:** All actions require authenticated token validation, tenant scope match, role membership, department clearance, and verified clinical privileges where applicable.

---

## 1. Multi-Layered Security Evaluation Pipeline
Access in G-HIMS is NEVER decided by role alone. Every sensitive mutation passes through the 6-layer evaluation pipeline:
```
User Identity (Firebase Auth)
  └── Tenant Context (/tenants/{tenantId}/...)
        └── Role Clearance (RBAC)
              └── Department & Facility Scope (ABAC)
                    └── Credential Verification (MD/Director Signed)
                          └── Active Clinical Privilege (Procedure/Action Gated)
```

---

## 2. Comprehensive Domain Authorization Matrix

| Domain & Action | Allowed Roles | Facility Scope | Department Scope | Required Clinical Privilege | Required Credential | Mandatory Approval Requirement |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Patient Registration (MPI)** | `REGISTRAR`, `RECEPTIONIST`, `SYSTEM_ADMIN` | Local Facility | Admissions / Front Desk | None | Administrative Employment | None (Self-contained) |
| **Emergency Triage Intake** | `NURSE`, `DOCTOR`, `PARAMEDIC` | Emergency Dept / Trauma Center | Emergency (`dept_er`) | `TRIAGE_ASSESS` | RN License or Paramedic Cert | None (Immediate emergency intake) |
| **STAT Emergency Break-Glass** | `DOCTOR`, `CONSULTANT` | Any Clinical Area | All Clinical Depts | `EMERGENCY_OVERRIDE` | MD / DO License (Active) | Post-action peer review audit log within 24 hours |
| **Inpatient Admission & Bed Allocation** | `ADMISSIONS_OFFICER`, `WARD_NURSE`, `DOCTOR` | Inpatient Ward / ICU | IPD (`dept_ipd`) | None | Healthcare Worker ID | Admitting Physician Order required |
| **Diagnostic Lab Order (Routine)** | `DOCTOR`, `CONSULTANT` | Attending Facility | OPD / IPD / ED | `ORDER_LAB` | Active Medical License | Cashier clearance OR Active Insurance coverage |
| **Diagnostic Lab Order (STAT)** | `DOCTOR`, `CONSULTANT`, `PARAMEDIC` | Attending Facility / Ambulance | ED / ICU / Trauma | `ORDER_LAB` | Active Medical / Paramedic License | Immediate execution; bypasses cashier locks |
| **Diagnostic Radiology Order (CT/MRI/X-Ray)** | `DOCTOR`, `CONSULTANT` | Attending Facility | OPD / IPD / ED | `ORDER_RADIOLOGY` | Active Medical License | Radiation safety checklist + Clinical indication |
| **Medication Prescription Signing** | `DOCTOR`, `CONSULTANT` | Attending Facility | OPD / IPD / ED | `PRESCRIBE` | State DEA / Medical Board License | Double-sign for Schedule II controlled substances |
| **Pharmacy Dispensing (Inpatient/Outpatient)** | `PHARMACIST`, `PHARMACY_TECH` | Hospital Pharmacy | Pharmacy (`dept_pharm`) | `DISPENSE_MEDICATION` | Registered Pharmacist (RPh) License | Prescription sign-off check + Allergy reconciliation |
| **Surgical Case Booking (OT)** | `SURGEON`, `OR_MANAGER` | Operating Theater Suite | Surgery (`dept_ot`) | `PERFORM_SURGERY` | Surgical Board Specialty Board Cert | Biomedical calibration check on anesthesia workstation |
| **PACU Bed Reservation & Transfer** | `ANESTHESIOLOGIST`, `PACU_NURSE` | Surgical Suite / Recovery | PACU (`dept_pacu`) | `SEDATION_RECOVERY` | Anesthesiology Cert / PACU RN | Anesthesiologist sign-out score $\ge 9$ (Aldrete score) |
| **Laboratory Result Validation & Release** | `LAB_TECHNICIAN`, `PATHOLOGIST` | Central Lab / Blood Bank | Laboratory (`dept_lab`) | `VERIFY_LAB_RESULT` | Medical Technologist (ASCP/equivalent) | Pathologist review required for Critical values |
| **Radiology Image Interpretation & Sign-Off** | `RADIOLOGIST` | Diagnostic Imaging Center | Radiology (`dept_rad`) | `INTERPRET_IMAGING` | Board Certified Radiologist | Peer discrepancy double-reading on complex CT/MRI |
| **Patient Invoice Finalization** | `BILLING_CLERK`, `FINANCE_MANAGER` | Hospital Finance | Billing Office | None | Financial Administration ID | Final clinical discharge order |
| **General Ledger Journal Posting** | `ACCOUNTANT`, `FINANCE_MANAGER` | Tenant Wide | Finance (`dept_fin`) | None | Certified Accountant (CPA/equivalent) | Dual sign-off on manual adjustments $> \$10,000$ |
| **GL Journal Reversal (Compensating Entry)** | `FINANCE_MANAGER`, `CFO` | Tenant Wide | Finance (`dept_fin`) | None | Finance Director Authority | Mandatory audit justification and open fiscal period |
| **Biomedical Calibration Record** | `BIOMEDICAL_ENGINEER`, `FACILITIES_MGR` | All Clinical Suites | Biomedical Eng | `CALIBRATE_EQUIPMENT` | Biomedical Equipment Tech (BMET) | Formal pass/fail test certificate attachment |
| **Employee Onboarding & Organization** | `HR_ADMIN`, `SYSTEM_ADMIN` | Tenant Wide | Human Resources | None | HR Management Authority | Identity & Background check sign-off |
| **Clinical Credential Verification** | `MEDICAL_DIRECTOR`, `CREDENTIALING_COMM` | Tenant Wide | Medical Affairs | `VERIFY_CREDENTIAL` | Medical Director Authority | Primary source verification (PSV) document |
| **Clinical Privilege Grant / Suspension** | `CHIEF_MEDICAL_OFFICER`, `CREDENTIAL_BOARD` | Tenant Wide | Executive Board | `GRANT_CLINICAL_PRIVILEGE` | CMO / Hospital Executive Credentials | Institutional Credentialing Committee Resolution |
| **Master System & Security Configuration** | `SYSTEM_ADMIN` | Tenant Wide | IT / Informatics | `SYSTEM_SECURITY_ADMIN` | Enterprise Admin MFA Token | Executive sponsor approval for permission alterations |

---

## 3. Privilege Escalation Defenses & Boundary Enforcement
1. **Separation of Clinical vs. Financial Roles**: Clinicians cannot post to the General Ledger; financial personnel cannot sign prescriptions or advance clinical stages.
2. **Credential Expiry Practice Lockout**: An automated trigger freezes prescribing, surgical, and diagnostic privileges the second a mandatory license expires in the HR credential engine.
3. **Emergency Override (Break-Glass)**: Allows doctors to execute STAT orders in life-threatening scenarios without pre-payment clearance, triggering an immutable audit event for subsequent review.
4. **Zero Client Trust**: Role assertions in client payloads are ignored; user credentials and claims are re-verified on the server using verified session tokens.
