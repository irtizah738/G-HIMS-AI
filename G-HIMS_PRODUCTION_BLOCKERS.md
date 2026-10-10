# G-HIMS — Production Blocker Register

A blocker is closed only by evidence, not by changing a label.

## Active blockers

| ID | Area | Blocker | Required closure evidence |
| --- | --- | --- | --- |
| P3-ENV-01 | Deployment | Target production environment has not been evaluated by `/api/health/ready` with real production configuration | Readiness 200 response tied to deployed commit/environment |
| P3-DR-01 | Backup/restore | No repository evidence of a successful isolated restore drill | Drill record with export/import IDs, timestamps, measured recovery point and restore duration |
| P3-OBS-01 | Monitoring | External alert sink/on-call routing is not proven by repository code | Controlled alert delivery evidence and ownership |
| P3-IAM-01 | Production identity assurance | Verified-email and privileged-user Firebase MFA enrollment have no real deployment evidence | Production sign-in proof for each privileged role, IdP claim mapping, break-glass policy, and revocation test evidence |
| P3-OFF-01 | Offline identity continuity | No deployed evidence of cross-user cache isolation, local-only access restrictions, reconnect revocation and bounded offline lease behavior | Multi-device stale-session test, disconnected revocation simulation, denied online commands, and reauthorization-before-replay evidence |
| EXT-DICOM-01 | PACS | No live PACS/VNA conformance validation | Site integration test evidence |
| EXT-DEVICE-01 | Medical devices | Physical telemetry transport/device identity/calibration validation incomplete | Manufacturer/site validation and clinical engineering sign-off |
| EXT-HL7-01 | Interface engine | Institutional HL7 mappings/transport not validated | Interface-engine test evidence |
| EXT-EDI-01 | Claims | Payer/clearinghouse companion-guide validation incomplete | Accepted test transaction/certification evidence |
| EXT-GOV-01 | Governance | No hospital pilot/production approval exists in repository evidence | Institutional approval outside repository |
| EXT-SEC-01 | Security | Independent production penetration assessment not evidenced | Assessment + remediation report |

## Containment already implemented

- external integration states are explicit and fail closed;
- real device telemetry remains blocked until validated;
- DICOM simulation cannot silently substitute for live PACS;
- AI requires explicit live activation/provider and produces review-only provenance-linked drafts;
- environment policy blocks emulator/non-production project patterns in production;
- production readiness blocks stale/missing restore-drill evidence.

No blocker may be marked closed solely because an adapter, runbook, configuration variable, or automated unit test exists.
