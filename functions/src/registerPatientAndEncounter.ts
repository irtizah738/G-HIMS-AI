import { registerPatientAndEncounter, RegisterPatientEncounterParams } from '@/lib/runtime/registration-orchestrator';

/**
 * Firebase Cloud Function Handler: registerPatientAndEncounter
 * Exposes a secure, transactional backend endpoint for patient registration & encounter initiation
 */
export async function registerPatientAndEncounterHandler(
  data: RegisterPatientEncounterParams,
  context?: { auth?: { uid: string; token?: { role?: string; name?: string } } }
) {
  const actorId = context?.auth?.uid || data.actorId || 'system_clerk';
  const actorRole = context?.auth?.token?.role || data.actorRole || 'receptionist';
  const actorName = context?.auth?.token?.name || data.actorName || 'Clinical Intake Staff';

  const enrichedParams: RegisterPatientEncounterParams = {
    ...data,
    actorId,
    actorRole,
    actorName,
  };

  try {
    const result = await registerPatientAndEncounter(enrichedParams);
    return {
      status: 'success',
      data: result,
    };
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Registration Orchestration Failed:', err);
    throw new Error(`Encounter Registration Failed: ${err.message}`);
  }
}
