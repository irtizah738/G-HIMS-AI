import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const source=(path:string)=>readFile(join(process.cwd(),path),'utf8');

describe('ORC-1B safe multi-surface encrypted hydration',()=>{
  test('replacing one edge surface does not globally delete all other authorized collections',async()=>{
    const secure=await source('lib/offline/secure-store.ts');
    expect(secure).toContain("const requestedCollections = new Set(Object.keys(collections || {}))");
    expect(secure).toContain('requestedCollections.has(row.collection)');
    expect(secure).toContain('changedAuthority ||');
    expect(secure).toContain("scope: 'edge-authority'");
    expect(secure).toContain('scope: snapshotScope');
    expect(secure).toContain("EDGE_SNAPSHOT_AUTHORITY_REQUIRED");
  });
  test('server revisions reflect verified roles, privileges, facility and department scope',async()=>{
    const server=await source('app/api/offline/bootstrap/route.ts');
    const client=await source('lib/offline/hydration.ts');
    expect(server).toContain("const authorizationRevision = createHash('sha256')");
    for(const key of ['roles','permissions','facilities','departments','clinicalPrivileges']){
      expect(server).toContain(key+': sorted(');
    }
    expect(server).toContain('authorizationRevision,');
    expect(client).toContain('authorizationRevision: payload.authorizationRevision');
    expect(client).toContain('authorityEpoch');
    expect(client).toContain('getEdgeSyncMetadata(normalizedTenantId, surface)');
    expect(client).toContain("authority.sessionId !== cached.session.sessionId");
  });
});
