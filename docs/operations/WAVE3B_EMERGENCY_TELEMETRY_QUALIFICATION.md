# Wave 3B — Emergency / Pre-arrival Telemetry Qualification

## Authority boundary

Certified ambulance/device telemetry is external clinical evidence. It does not automatically create a patient or encounter, assign a bay, diagnose a condition, advance the ED workflow, place orders, or write authoritative bedside vital signs.

Production packets require:

1. DEVICE_TELEMETRY integration state LIVE.
2. Platform integration API key.
3. Device-specific credential.
4. Active server-owned telemetry device profile.
5. CERTIFIED device status.
6. Valid calibration window.
7. Approved firmware.
8. Active Emergency encounter.
9. MRN matching the encounter patient.
10. Packet freshness/range/waveform validation.
11. Monotonic durable packet checkpoint.

Accepted packets persist in preArrivalTelemetryRecords as immutable source evidence and emit EMERGENCY_PREARRIVAL_TELEMETRY_INGESTED.

A credentialed clinician must execute AcknowledgeEmergencyPrearrivalTelemetryCommand before the evidence is marked reviewed.

## Explicit non-goals

The existing visual EMS simulation component is not an authority path and must remain unreachable from the governed Emergency console. Synthetic ECG rendering and local countdown/intercom behavior are demonstration-only and cannot be used in production decision support.