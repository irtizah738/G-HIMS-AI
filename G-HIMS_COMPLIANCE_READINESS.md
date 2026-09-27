# G-HIMS Compliance Readiness — Evidence Boundary

## Important boundary

G-HIMS can implement technical controls that support regulatory and security objectives. This repository does **not** establish legal compliance, certification, regulatory clearance, or institutional approval.

Statements about HIPAA, GDPR, 21 CFR Part 11, ISO 27001, SOC 2, HITRUST, medical-device regulation, local health-data laws, or payer rules require deployment-specific legal, organizational and independent-assessment evidence.

## Repository-supported control areas

### Identity and authorization
- Firebase identity is verified server-side for protected actions.
- Tenant membership, session state, roles and clinical privileges are re-resolved from authoritative server data.
- Sensitive command execution does not trust client-supplied actor/role/permission headers.
- Revoked and expired sessions fail closed.

### Data authority and auditability
- Sensitive domain mutations use server-owned command/transaction paths.
- Domain writes can produce immutable event, audit and outbox records within the transaction boundary.
- Browser clients cannot directly write the protected event/audit/outbox/idempotency collections.
- Client-originated audit activity is re-authenticated and persisted server-side.
- The repository does not claim that every audit record participates in a global cryptographic hash chain.

### AI governance
- Clinical AI output is a draft requiring authorized human review.
- Draft provenance records provider/model/purpose and input/output hashes.
- AI activation is explicit; the presence of an API credential alone does not enable clinical generation.
- AI output is not an autonomous diagnosis, prescription, order or claim-submission authority.

### Integration governance
- External integrations have explicit activation states.
- DICOM/FHIR adapters do not silently fall back to fake production data.
- Real device telemetry is blocked until the physical integration validation package is complete.
- X12 output is structurally validated only; payer/clearinghouse conformance remains external.

### Operational resilience
- DEMO, STAGING and PRODUCTION project separation is enforced by runtime project contracts.
- Backup/restore entrypoints require explicit project/environment targeting.
- Disaster-recovery RPO/RTO values are engineering **targets** until measured in a timed recovery exercise.
- Structured operational logs redact PHI-shaped and credential-shaped attributes.

## Controls that require external evidence

Examples include:

- cloud provider contractual terms and any required business-associate/data-processing agreements;
- network/TLS configuration actually used by the deployed environment;
- storage encryption and key-management configuration actually enabled in the cloud project;
- vulnerability management, endpoint security and workforce security processes;
- retention/deletion schedules approved by the hospital and jurisdiction;
- independent penetration test results;
- SIEM alerting, incident response and breach-notification procedures;
- backup schedule execution, retention and successful restore exercises;
- computerized system validation where applicable;
- clinical safety review and medical-device/regulatory classification where applicable.

## Evidence language

Use:
- “architecturally supports”
- “implemented in repository”
- “repository-tested”
- “integration ready”
- “simulation only”
- “external validation required”

Do not use without independent evidence:
- “HIPAA compliant”
- “certified”
- “regulator approved”
- “validated production system”
- “guaranteed tamper-proof”
- “verified RPO/RTO”
- “safe for unrestricted clinical production”
