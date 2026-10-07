export const EDGE_HYDRATION_SURFACES = [
  'HOSPITAL_SHELL',
  'OPD',
  'CLINICAL',
  'BILLING',
  'FINANCE',
  'HCM',
  'SCM',
  'FACILITIES',
] as const;

export type EdgeHydrationSurface = (typeof EDGE_HYDRATION_SURFACES)[number];

const EDGE_HYDRATION_SURFACE_SET = new Set<string>(EDGE_HYDRATION_SURFACES);

export function requireEdgeHydrationSurface(value: unknown): EdgeHydrationSurface {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    throw new Error('EDGE_HYDRATION_SURFACE_REQUIRED');
  }
  if (!EDGE_HYDRATION_SURFACE_SET.has(normalized)) {
    throw new Error('EDGE_HYDRATION_SURFACE_INVALID');
  }
  return normalized as EdgeHydrationSurface;
}
