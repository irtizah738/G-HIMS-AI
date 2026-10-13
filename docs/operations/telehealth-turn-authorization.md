# Telehealth ICE / TURN capability hardening

## Trust boundary

Patient room IDs are routing identifiers, not sufficient access credentials. The patient must present a clinician-issued random 256-bit `patientJoinToken` over HTTPS for signaling POST, signaling GET and the ICE/TURN credential endpoint. The server keeps SHA-256 only, compares timing-safely, verifies exact tenant, room, session, encounter, patient and an active, unexpired signaling lease.

A clinician can request TURN credentials only with a server-derived identity, active canonical HCM signing privilege, assigned encounter and authorized facility. Neither browser has the server's TURN shared secret. Coturn REST credentials are minted on-demand and valid for 1 hour. Previously minted credentials cannot be remotely revoked by this application before their TTL expires without an operational TURN-side revocation mechanism.

## Deployment settings (server-only)

- `GHIMS_WEBRTC_STUN_URLS_JSON`: optional JSON array of institution-approved STUN URLs.
- `GHIMS_WEBRTC_TURN_URLS_JSON`: JSON array of institution-approved TURN URLs.
- `GHIMS_WEBRTC_TURN_REST_SECRET`: high-entropy secret configured in Coturn and server-side deployment secret manager. Never `NEXT_PUBLIC_`.

The application no longer reads `NEXT_PUBLIC_GHIMS_WEBRTC_ICE_SERVERS_JSON` in browser components. With TURN absent, direct peer-to-peer remains possible but clinician UI clearly warns; hospitals requiring reliable restricted-network operation must fail their site readiness gate without TURN.

## Qualification and operational blockers

Source tests alone cannot certify deployed Telehealth. Run full CI, Firestore emulator tests, staging browser journeys on assigned doctor/patient and negative cases: missing/forged/expired patient join token, wrong tenant, ambiguous room token, completed encounter, revoked clinician privileges, wrong facility, mobile NAT, TURN outages and credential expiry. Validate no secrets/tokens in logs, browser persistent cache, referrer or telemetry. New invitation links carry the bearer capability in a browser URL fragment, not the HTTP query. The patient join page reads both new fragments and legacy query links, clears the visible URL and sets no-referrer/private no-store response headers. Secure invitation delivery, access logging and browser compatibility still require staging verification.

This is a narrow independent extraction from draft PR #157; cancellation, signed-note recovery and legacy room repair remain unmerged and must be reconciled against current clinical authorization rules.
