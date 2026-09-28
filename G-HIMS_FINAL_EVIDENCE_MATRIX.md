# G-HIMS — Evidence Matrix

**Status taxonomy:** `IMPLEMENTED` | `AUTOMATED-VERIFIED` | `INTEGRATION_READY` | `SIMULATION_ONLY` | `EXTERNALLY_BLOCKED` | `NOT_IMPLEMENTED`

| Capability | Code evidence | Automated evidence | External dependency | Status |
| --- | --- | --- | --- | --- |
| Default-deny tenant data rules | `firestore.rules` | P0 emulator rules test | None | AUTOMATED-VERIFIED |
| Auth/session/tenant authority | `server/auth/*`, authoritative context | P0/security tests | Firebase Auth | AUTOMATED-VERIFIED |
| Durable command/event/audit/outbox writes | transaction manager | P1 tests | Firestore | AUTOMATED-VERIFIED |
| Governed offline replay | sync engine + command replay | P1/P2 tests | Network reconnect | AUTOMATED-VERIFIED |
| AI provider boundary/provenance | AI gateway + AI draft repository | P2 tests | Approved AI provider | AUTOMATED-VERIFIED |
| FHIR R4 adapter | `lib/interop/fhir-r4-adapter.ts` | P2 boundary test | Target FHIR server | INTEGRATION_READY |
| DICOMweb adapter | `lib/interop/dicomweb-client.ts` | P2 boundary test | PACS/VNA | INTEGRATION_READY |
| Physical device telemetry | safety adapter | P2 verifies production is blocked | Manufacturer/device transport | EXTERNALLY_BLOCKED |
| HL7 ORU^R01 ingestion | HL7 route/parser | P0/P2 tests | Interface engine + institutional mapping | INTEGRATION_READY |
| X12 837 structural generation | EDI generator | claims + P2 tests | Payer/clearinghouse companion guide | INTEGRATION_READY |
| Server-owned audit records | transaction/auth audit services | P0/P1/P3 tests | External SIEM optional | AUTOMATED-VERIFIED |
| Cryptographic audit-chain attestation | none | none | Design/implementation required if mandated | NOT_IMPLEMENTED |
| Environment separation | environment policy | P3 tests | Deployment configuration | IMPLEMENTED |
| Liveness/readiness probes | health routes | P3 tests | Runtime/platform health checks | IMPLEMENTED |
| Structured operational log redaction | structured logger | P3 tests | Log sink/alert platform | IMPLEMENTED |
| Firestore backup procedure | DR runbook + readiness config | configuration tests only | GCS/IAM/scheduler | IMPLEMENTED |
| Measured restore/RPO/RTO evidence | external drill record | none in repo | Restore environment + operators | EXTERNALLY_BLOCKED |
| HIPAA/GDPR/ISO certification | none | impossible via repo test | Independent/institutional process | EXTERNALLY_BLOCKED |
| Hospital pilot approval | none | impossible via repo test | Hospital governance | EXTERNALLY_BLOCKED |

A green CI run proves only the automated checks executed by that workflow. It is not a regulatory, clinical, integration, availability, or disaster-recovery certification.
