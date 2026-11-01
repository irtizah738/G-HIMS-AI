/**
 * Epic shared developer sandbox OAuth compatibility, CI-EXT-06C.
 * Opt-in and pinned to the PUBLIC synthetic sandbox. No production Epic host,
 * wildcard grant, write scope or implicit search grant is authorized here.
 *
 * Scope expressions must remain server-owned (FHIR source onboarding), not
 * supplied by a browser or inferred from an OAuth response.
 */
export const EPIC_SANDBOX_FHIR_BASE =
  'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/';
export const EPIC_SANDBOX_TOKEN_URL =
  'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
export const EPIC_SANDBOX_JWKS_URL =
  'https://helixis-jwks-staging.vercel.app/api/jwks';

const EPIC_ALLOWED_SCOPES = new Set([
  'system/Patient.r', 'system/Encounter.r', 'system/Observation.r',
  'system/Patient.s', 'system/Encounter.s', 'system/Observation.s',
]);
// Epic's observed sandbox response includes category-filtered read grants.
// These do not authorize an unfiltered read or search on their own.
const OBSERVATION_READ_CATEGORIES = new Set([
  'http://hl7.org/fhir/us/core/CodeSystem/us-core-category|sdoh',
  'http://terminology.hl7.org/CodeSystem/observation-category|imaging',
  'http://terminology.hl7.org/CodeSystem/observation-category|laboratory',
  'http://terminology.hl7.org/CodeSystem/observation-category|social-history',
  'http://terminology.hl7.org/CodeSystem/observation-category|survey',
  'http://terminology.hl7.org/CodeSystem/observation-category|vital-signs',
]);

export function isEpicSandboxScopeConfiguration(scopes: readonly string[]): boolean {
  return scopes.length > 0 && new Set(scopes).size === scopes.length &&
    scopes.every(scope => EPIC_ALLOWED_SCOPES.has(scope));
}

function allowedCategoryReadGrant(scope: string, approved: ReadonlySet<string>): boolean {
  const prefix = 'system/Observation.r?category=';
  return approved.has('system/Observation.r') &&
    scope.startsWith(prefix) &&
    OBSERVATION_READ_CATEGORIES.has(scope.slice(prefix.length));
}

/**
 * Return an access token ONLY after confirming that every granted scope is
 * constrained to the server-approved read/search set. '.r' never implies '.s'.
 *
 * This is deliberately stricter than accepting all scopes returned by Epic.
 * If Epic adds an unreviewed scope, reject and perform source-approval revision.
 */
export function validateEpicSandboxGrantedScopes(
  value: unknown,
  approvedScopes: readonly string[],
  resourceType: 'Patient' | 'Encounter' | 'Observation',
): string[] {
  if (!isEpicSandboxScopeConfiguration(approvedScopes)) {
    throw new Error('CI_EXT06C_APPROVED_SCOPES_INVALID');
  }
  const requiredRead = 'system/' + resourceType + '.r';
  const approved = new Set(approvedScopes);
  if (!approved.has(requiredRead)) {
    throw new Error('CI_EXT06C_RESOURCE_READ_NOT_APPROVED');
  }
  const rawScope = (value as { scope?: unknown } | null)?.scope;
  if (typeof rawScope !== 'string' || !rawScope.trim() || rawScope.length > 4096) {
    throw new Error('CI_EXT04_GRANTED_SCOPES_UNVERIFIED');
  }
  const returned = rawScope.trim().split(/\s+/);
  if (returned.length > 32 || new Set(returned).size !== returned.length ||
      returned.some(scope => !approved.has(scope) &&
        !allowedCategoryReadGrant(scope, approved))) {
    throw new Error('CI_EXT06C_UNAPPROVED_EPIC_SCOPE');
  }
  if (!returned.includes(requiredRead)) {
    throw new Error('CI_EXT06C_REQUIRED_READ_SCOPE_MISSING');
  }
  // The caller must still verify token type, expiry and exact returned grants.
  return returned;
}
