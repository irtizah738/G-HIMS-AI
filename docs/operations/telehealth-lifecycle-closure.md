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
