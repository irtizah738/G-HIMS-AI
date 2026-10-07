export interface Hl7SourceTenantRoute {
  sendingApplication: string;
  sendingFacility?: string;
  tenantId: string;
}

function normalized(value: string | undefined): string {
  return String(value || '').trim().toUpperCase();
}

export function parseHl7SourceRoutes(value: string | undefined): Hl7SourceTenantRoute[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('HL7_SOURCE_ROUTES_INVALID');
  }

  const routes = parsed.map((item) => ({
    sendingApplication: String(item?.sendingApplication || '').trim(),
    sendingFacility: String(item?.sendingFacility || '').trim() || undefined,
    tenantId: String(item?.tenantId || '').trim().toLowerCase(),
  }));

  if (
    routes.some(
      (route) => !route.sendingApplication || !route.tenantId
    )
  ) {
    throw new Error('HL7_SOURCE_ROUTE_FIELDS_REQUIRED');
  }
  return routes;
}

export function resolveHl7TenantForSource(
  routes: Hl7SourceTenantRoute[],
  sendingApplication: string,
  sendingFacility: string
): string | null {
  const app = normalized(sendingApplication);
  const facility = normalized(sendingFacility);

  const exact = routes.filter(
    (route) =>
      normalized(route.sendingApplication) === app &&
      normalized(route.sendingFacility) === facility
  );
  if (exact.length === 1) return exact[0].tenantId;
  if (exact.length > 1) throw new Error('HL7_SOURCE_ROUTE_AMBIGUOUS');

  const appOnly = routes.filter(
    (route) =>
      normalized(route.sendingApplication) === app &&
      !normalized(route.sendingFacility)
  );
  if (appOnly.length === 1) return appOnly[0].tenantId;
  if (appOnly.length > 1) throw new Error('HL7_SOURCE_ROUTE_AMBIGUOUS');

  return null;
}
