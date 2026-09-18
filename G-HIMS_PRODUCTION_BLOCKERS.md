# G-HIMS OS — PRODUCTION BLOCKER REGISTER
**Verification Date:** September 17, 2026  
**Evaluation Standard:** Zero-Trust Audit & Production Hardening Directive  
**Rule:** No P0 or P1 blocker may remain unresolved for a general hospital production declaration. Controlled pilot deployment may proceed only with explicit containment and exclusion of incomplete external integrations.

---

## 1. Blocker Registry Summary
- **P0 Blockers (Patient Safety / Security / Irreversible Corruption):** 0 Active (All resolved in codebase)
- **P1 Blockers (Major Clinical / Financial / System Integrity):** 2 Active (External Institutional Prerequisites)
- **P2 Blockers (Important Functionality / Interface Standards):** 2 Active (Interoperability Network Connectivity)
- **P3 Blockers (UX / Telemetry Ergonomics):** 1 Active

---

## 2. Detailed Production Blocker Entries

### BLOCKER-01 [SEVERITY: P1]
- **Affected Module:** Hospital Clearinghouse Billing Adapter (EDI 837P / 837I / 835)
- **Risk:** Inability to submit automated health insurance claims to payers directly via electronic clearinghouses, requiring manual billing export.
- **Evidence:** Interface stubs exist, but live B2B AS2 / SFTP clearinghouse endpoints (e.g. Change Healthcare, Availity) are not contracted or provisioned in the cloud container.
- **Owner:** Revenue Cycle & Health Informatics Engineering
- **Dependency:** Contracted Clearinghouse Gateway Partner & Payer Enrollment IDs
- **Remediation:** Implement X12 EDI 837 engine with automated payer remittance advice (835) ingestion pipeline and payer connectivity testing.
- **Acceptance Criteria:** Successful end-to-end transmission, validation, and claim acceptance receipt from test clearinghouse endpoint.
- **Pilot Impact:** Non-blocking for controlled pilot using self-pay, direct employer billing, or manual claim generation.

### BLOCKER-02 [SEVERITY: P1]
- **Affected Module:** Institutional PACS / DICOM Storage Server Connectivity
- **Risk:** Inability to retrieve actual multi-gigabyte diagnostic CT/MRI slices from an on-premise hospital PACS archive without physical hospital network VPN.
- **Evidence:** `DICOMwebAdapter` implements QIDO-RS, WADO-RS, and STOW-RS client logic, but tests run against mock endpoints; no live hospital DICOM AE (Application Entity) is physically reachable.
- **Owner:** Diagnostic Imaging & Infrastructure Team
- **Dependency:** Hospital Site-to-Site IPsec VPN / Cloud Healthcare DICOM API Endpoint
- **Remediation:** Configure secure VPN tunnel or Google Cloud Healthcare DICOM store and execute live C-STORE / WADO-RS retrieval tests with certified radiologist review.
- **Acceptance Criteria:** Radiologist retrieves and renders 100+ slice CT series within <3 seconds without image corruption or loss of spatial calibration tags.
- **Pilot Impact:** Pilot is restricted to local image uploads and pre-rendered review, excluding primary on-premise PACS reading until VPN established.

### BLOCKER-03 [SEVERITY: P2]
- **Affected Module:** Pre-Hospital Physical Telemetry Ingestion Gateway
- **Risk:** Incoming telemetry relies on simulated websocket feeds or manual adapter injection rather than direct Bluetooth/Cellular modem feed from ZOLL or Physio-Control defibrillators.
- **Evidence:** `DeviceTelemetryAdapter` validates freshness (>30s stale rejection) and Lead II ECG normalization, but inputs are injected via API rather than direct serial/modem hardware interface.
- **Owner:** Pre-Hospital & Emergency Informatics Team
- **Dependency:** Physical medical device manufacturer SDK license & ambulance cellular modem gateway.
- **Remediation:** Deploy edge telemetry receiver service with manufacturer-approved protocol parser (e.g. ZOLL WiFi/Cellular push).
- **Acceptance Criteria:** Real ZOLL X Series or LIFEPAK 15 successfully streams 12-lead ECG and vitals packet directly to cloud endpoint with <1.5s latency.
- **Pilot Impact:** EMS module operates in "Manual Vitals & Waveform Import" mode during pilot.

### BLOCKER-04 [SEVERITY: P2]
- **Affected Module:** Hospital Interface Engine (HL7 v2 MLLP Listener)
- **Risk:** Hospital laboratory instruments cannot transmit direct unsolicited results without a running TCP/MLLP socket listener behind a secure firewall.
- **Evidence:** HL7 parser and ACK generator pass all unit and framing tests, but require a permanent TCP socket listener daemon for live MLLP 2575 port traffic.
- **Owner:** Interoperability & Network Engineering
- **Dependency:** Institutional interface engine (Mirth Connect, Cloverleaf, or Rhapsody) and network ingress routing.
- **Remediation:** Deploy cloud-hosted or on-premise edge MLLP listener container that converts incoming TCP frames to G-HIMS domain commands.
- **Acceptance Criteria:** Bi-directional exchange of ADT_A01 and ORU_R01 messages with <500ms round-trip acknowledgment.
- **Pilot Impact:** Pilot uses structured REST/FHIR endpoints for lab order and result entry.

### BLOCKER-05 [SEVERITY: P3]
- **Affected Module:** Waveform Render Smoothing & Dark-Mode Canvas Resizing
- **Risk:** Minor visual aliasing on canvas-rendered real-time ECG waveforms on high-DPI retina displays during browser viewport resizing.
- **Evidence:** Synthetic waveform generator produces mathematically correct samples, but `ResizeObserver` on canvas requires sub-pixel smoothing optimization.
- **Owner:** Frontend Experience & Clinical UI Team
- **Dependency:** None (Pure client-side canvas optimization)
- **Remediation:** Apply high-DPI pixel ratio scaling (`window.devicePixelRatio`) to canvas context.
- **Acceptance Criteria:** Pristine 60fps waveform rendering with no visual artifacting or layout shift during rapid window resize.
- **Pilot Impact:** Negligible; strictly aesthetic refinement.
