# Telehealth lifecycle closure — ORC remediation

## User-facing actions and command authority

| User action | Backend command | Gate | Result |
|---|---|---|---|
| Start video call | governed signaling API | valid UUID room capability and assigned clinician; authorized server context | ephemeral media connection only, **not** clinical closure |
| Repair legacy media room | `RepairTelehealthRoomTokenCommand` | clinician role; nonterminal session; invalid legacy token; exact `updatedAt`; no signaling room ever created | replace credential with new UUID token; event/audit/outbox |
| Sign note & complete encounter | `SignClinicalNoteCommand` then `CompleteTelehealthSessionCommand` | active HCM-verified `SIGN_CLINICAL_NOTES`; final signed evidence belongs to the same patient and encounter | session/encounter/patient care pointers atomically marked complete |
| Cancel unused encounter | `CancelUnusedTelehealthEncounterCommand` | authorized administrative or clinician role; substantive reason; exact session version; no clinical/billing/media evidence | session and encounter CANCELLED; patient telehealth pointer closed; immutable event/audit/outbox |
| End call | signaling `LEAVE` | active authorized media lease | media only; never completes or cancels clinical episode |

## Nonnegotiable safety requirements

- A cancellation is **not** a clinical discharge and must never mint signed notes.
- The cancellation command reads tenant-scoped session, encounter, and patient in a single mutation transaction, and transactionally confirms **zero** references in guarded collections. It rejects any signed evidence, SOAP content, vitals, orders, prescriptions, clinical observations, invoice/payment references, call duration or started media room.
- A room credential that is missing or uses a legacy format cannot be used for WebRTC. It may be repaired only when there is no governed signaling-room evidence. A repaired link must be re-shared privately.
- The existing HCM privilege checks remain authoritative for signing; administrators cannot circumvent clinical signing controls.
- Offline mode must not finalize or cancel sessions. The UI leaves the commands disabled offline.
- The context reuses the same idempotency keys for signing and completion after retryable failures within the current authenticated app session. **A browser reload after partial success still requires an evidence lookup/reconciliation workflow.** Do not sign a second note automatically without verifying the first.
- Every cancellation needs an explicit human reason. Failed guarded attempts must leave patient/encounter/session unchanged.

## Hospital-0 verification before merge or deployment

1. **Runtime parity**: record backend deployment SHA, Firebase project, tenant, and role for each test. Verify the app is running the PR's commit (not an older deployment).
2. **Empty legacy synthetic encounter**: confirm session, encounter, pointer and room evidence; repair invalid room credential in a dedicated test; separately cancel an unused encounter and verify three atomic states, event, audit, outbox. No patient deletion or fabricated note.
3. **Real clinical evidence**: create sandbox session with signed note or vitals; cancellation must reject without changing state. Verify a valid clinician can sign and complete.
4. **Media activity**: start then leave a governed test room. Cancellation must reject even if call duration is zero. End call alone must leave encounter open.
5. **RBAC/HCM**: unauthorized role cannot cancel; user without credentialed `SIGN_CLINICAL_NOTES` cannot sign; test tenant isolation.
6. **Concurrency**: mutate session between UI hydration and cancellation; expect version conflict. Create linked encounter evidence concurrently; expect cancellation transaction to abort.
7. **Failures and retries**: simulate network failure after signing and after completion commit; repeat exact command IDs and assert no duplicate signed note, event or audit action. Browser reload during partial completion must surface unresolved signed evidence for manual review, not falsely show completion.
8. **Offline and projection lag**: cancellation/signing unavailable offline; after server success, reconcile Patient 360 and MPI projection from authoritative events.
9. **Legacy mock retirement**: repeat the read-only inspector, confirm correct tenant identifier and matching patient MRN, then test existing guarded retirement only if all remaining synthetic-only gates pass. Do not directly clear Firestore pointers.

## Known remaining qualification gaps

- Repository-level static regression tests alone do not constitute successful deployed clinical testing.
- The retry cache is in memory and cannot recover a signed-but-uncompleted encounter after full browser reload. A separate server-authoritative evidence lookup/repair workflow is needed before calling this fully production-qualified.
- The cancellation guard list must be maintained as new encounter-linked financial and clinical collections are introduced. Every writer should also enforce terminal encounter status.
- Firestore rules already disallow client writes to tenant telehealth session state. Administrative commands use server-derived tenant context, role checks, and atomic writes.

These gaps are release blockers for uncontrolled hospital deployment, not reasons to disable the existing clinical safety guard.

## ICE relay provisioning (required for restrictive networks)

This application cannot create or operate institution TURN infrastructure merely by
setting frontend values. Provision a Coturn-compatible TURN server (or an equivalent
approved provider implementing coturn REST ephemeral credentials) with DNS/TLS,
UDP/TCP listener access and a firewall-approved relay port range.

Configure **server environment / secret manager**, never the client bundle:

```dotenv
GHIMS_WEBRTC_STUN_URLS_JSON=["stun:turn.example-hospital.org:3478"]
GHIMS_WEBRTC_TURN_URLS_JSON=["turn:turn.example-hospital.org:3478?transport=udp","turns:turn.example-hospital.org:5349?transport=tcp"]
GHIMS_WEBRTC_TURN_REST_SECRET=<32+ character shared secret stored in deployment secret manager>
```

`GHIMS_WEBRTC_TURN_REST_SECRET` must exactly match the trusted TURN service's
REST shared secret. Credentials are HMAC-SHA1 of a one-hour expiring username,
generated server-side and returned only to an assigned authenticated clinician or
the patient holding an **active** session capability. Do not place this secret in
`NEXT_PUBLIC_` or commit credentials to Git, Firestore, URLs, analytics, or logs.
The old `NEXT_PUBLIC_GHIMS_WEBRTC_ICE_SERVERS_JSON` is no longer consumed by
the Telehealth clients. An unconfigured provider remains a visible warning:
**code cannot silently provision TURN hosting, DNS, certificates, firewall ports or
a service secret**.

Qualification: validate WebRTC ICE relay candidates and audio/video bidirectionally
on separate NATs and a restrictive hospital/mobile network. Confirm rejected room
tokens cannot retrieve credentials; patient cannot request relay credentials before
the clinician activates the room; credentials expire; media and signaling stop at
session finality. An expired TURN credential should be recovered through a new
authorized configuration request on reconnect, not persisted indefinitely.

## HCM signing authorization

The backend requires the actor's authenticated tenant-scoped
DOCTOR/CONSULTANT role and HCM-verified `SIGN_CLINICAL_NOTES` privilege.
The Telehealth UI cannot create an HCM employee, credential, privilege grant or
consultant roster. An authorized HCM officer must verify the real clinician's
employment, professional registration, location/facility assignment, active
credential, privilege grant and consultant routing before testing clinical signing.
After changing authority, use **Refresh my clinical authorization** and repeat
the signed-note flow with the assigned clinician. Never grant a mock signature to
an administrator merely to unblock deletion.

## Recover signed-but-open encounters

The client checks the read-only `/api/telehealth/signed-evidence` endpoint before
signing. It searches the current actor's exact-content final signed SOAP evidence
within the tenant encounter, reuses its ID if uniquely matched, and rejects any
conflicting existing telehealth SOAP note for human review. This prevents common
duplicate-signature retries after a page reload. A concurrent two-tab signature
race still needs server-authoritative single-note uniqueness qualification.

## Provider assignment and facility isolation

New sessions must be explicitly scoped to a facility in the authenticated
user's authoritative `facilityIds`. A receptionist or scheduler never becomes
`assignedProviderId` by virtue of creating the encounter.
A verified DOCTOR/CONSULTANT holding `SIGN_CLINICAL_NOTES` can accept an
unassigned encounter using `ClaimTelehealthEncounterCommand`; the acceptance
atomically updates session + encounter and emits an immutable event and audit.
The actor must have the exact encounter facility in their server-derived grants.
An existing assignment cannot be stolen via the claim endpoint: refer the case
to governed HCM routing review. Clinician WebRTC signaling, TURN issuance,
signed-note recovery and final completion all require the assigned provider and
facility match. Older encounters lacking a canonical facility/assignment
require authorized migration or review, never automatic self-privileging.

### Additional qualification
- A receptionist with scheduling authority creates a scoped unassigned episode;
  their user ID must not appear as the treating clinician.
- A credentialed assigned doctor can accept once, and then join and sign.
- A second clinician, another facility, or an account without HCM clinical
  privilege cannot claim, join, mint TURN credentials or complete this episode.
- Sessions with ambiguous or legacy assignments must surface a routing error
  and must not silently clear clinical authority.
