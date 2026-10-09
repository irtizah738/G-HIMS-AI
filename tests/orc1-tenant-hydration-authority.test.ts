import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireEdgeHydrationSurface } from '@/lib/offline/hydration-policy';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

describe('ORC-1 tenant hydration authority', () => {
  test('explicitly rejects invalid/ambiguous surface input', () => {
    expect(requireEdgeHydrationSurface('facilities')).toBe('FACILITIES');
    expect(() => requireEdgeHydrationSurface('')).toThrow('EDGE_HYDRATION_SURFACE_REQUIRED');
    expect(() => requireEdgeHydrationSurface('ALL_DATA')).toThrow('EDGE_HYDRATION_SURFACE_INVALID');
  });
  test('facilities are actually authorized for verified administrators', async () => {
    const server = await source('app/api/offline/bootstrap/route.ts');
    const adminBranch = server.slice(server.indexOf("normalized.has('SYSTEM_ADMIN')"), server.indexOf('const selected = new Set<string>()'));
    expect(adminBranch).toContain('...FACILITIES_COLLECTIONS');
    expect(server).toContain('scopeOfflineCollections(');
    expect(server).toContain('deriveAuthoritativeContext');
  });
  test('client refuses stale route/session and in-flight tenant switching', async () => {
    const client = await source('lib/offline/hydration.ts');
    const guard = await source('components/tenant/tenant-route-authority-guard.tsx');
    expect(client).toContain('cached.session.tenantId.trim().toLowerCase() !== normalizedTenantId');
    expect(client).toContain('cached.session.userId !== currentUser.uid');
    expect(client).toContain("latest.session.sessionId !== cached.session.sessionId");
    expect(client).toContain('EDGE_HYDRATION_SESSION_CHANGED');
    expect(client).toContain('payload.surface !== surface');
    expect(client).toContain('EDGE_HYDRATION_BAD_REQUEST');
    expect(client).toContain("freshness: 'CURRENT'");
    expect(client).toContain("freshness: 'UNHYDRATED'");
    expect(guard).toContain('if (loading || unresolved)');
    expect(guard).toContain('if (mismatched)');
  });
});
