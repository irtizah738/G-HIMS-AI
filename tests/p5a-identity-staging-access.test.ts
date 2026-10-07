import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AuthorizationPipeline } from '../lib/backend/auth/authorization-pipeline';
import type { CommandContext } from '../lib/backend/types';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

describe('G-HIMS P5A identity and staging access boundary',()=>{
  test('login source contains no embedded real-person credential or password bypass',async()=>{
    const login=await source('components/auth/login-portal.tsx');
    expect(login).not.toContain('irtiza.haider007@gmail.com');
    expect(login).not.toContain('HospitalAdmin2026!');
    expect(login).not.toContain('handleInstantPersonaLogin');
    expect(login).toContain("NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO'");
    expect(login).toContain('signInFederated');
  });

  test('Google login exchanges existing Firebase identity and requests no Workspace scopes',async()=>{
    const login=await source('components/auth/login-portal.tsx');
    const google=await source('lib/firebase/auth-context.tsx');
    const authClient=await source('lib/auth/auth-client.ts');

    expect(login).not.toContain("signIn(targetEmail");
    expect(authClient).toContain('signInWithCurrentFirebaseIdentity');
    expect(google).not.toContain('https://www.googleapis.com/auth/drive');
    expect(google).not.toContain('https://www.googleapis.com/auth/spreadsheets');
  });

  test('password reset sends through Firebase client instead of discarding an Admin link',async()=>{
    const client=await source('lib/auth/auth-client.ts');
    const route=await source('app/api/auth/password-reset/route.ts');
    expect(client).toContain('sendPasswordResetEmail(auth, cleanEmail)');
    expect(route).not.toContain('generatePasswordResetLink');
  });

  test('workstation unlock reauthenticates existing Firebase identity without new server session',async()=>{
    const client=await source('lib/auth/auth-client.ts');
    const context=await source('lib/auth/auth-context.tsx');
    expect(client).toContain('reauthenticateWithCredential');
    expect(context).toContain('reauthenticateCurrentSession');
    const unlockSection=context.slice(context.indexOf('// Unlock Session Action'),context.indexOf('// Break-Glass'));
    expect(unlockSection).not.toContain('AuthClient.signIn(');
  });

  test('staff administration cannot mutate membership documents directly from the browser',async()=>{
    const page=await source('app/[tenantId]/admin/users/page.tsx');
    expect(page).not.toContain("from 'firebase/firestore'");
    expect(page).not.toContain('setDoc(');
    expect(page).not.toContain('updateDoc(');
    expect(page).not.toContain('INITIAL_MOCK_USERS');
    expect(page).toContain("'/api/admin/users'");
  });

  test('UID-backed provisioning is server authoritative',async()=>{
    const service=await source('server/auth/user-provisioning-service.ts');
    expect(service).toContain('getUserByEmail');
    expect(service).toContain('createUser');
    expect(service).toContain(".doc(identity.uid)");
    expect(service).not.toContain('usr-');
  });

  test('shared workstation trust is tenant scoped, not permanently user bound',async()=>{
    const devices=await source('server/auth/device-service.ts');
    expect(devices).toContain('data.tenantId !== params.tenantId');
    expect(devices).not.toContain('data.userId !== params.userId ||');
    expect(devices).toContain('userId: params.userId');
  });

  test('STAT priority cannot self-assert break-glass authority',async()=>{
    const context:CommandContext={
      actorId:'doctor-a',
      tenantId:'tenant-a',
      roles:['DOCTOR'],
      permissions:[],
      clinicalPrivileges:[],
      correlationId:'corr-a',
      requestId:'req-a',
    };

    const denied=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['DOCTOR'],
      requiredPrivilege:'ORDER_LAB',
      allowBreakGlass:true,
      isEmergencyOverride:true,
    });
    expect(denied.authorized).toBe(false);
    expect(denied.code).toBe('CLINICAL_PRIVILEGE_DENIED');

    const granted=AuthorizationPipeline.evaluate({
      ...context,
      isEmergencyOverride:true,
      breakGlassGrantId:'bg-authoritative',
    },{
      requiredRoles:['DOCTOR'],
      requiredPrivilege:'ORDER_LAB',
      allowBreakGlass:true,
    });
    expect(granted.authorized).toBe(true);

    const orders=await source('lib/backend/services/clinical-order-domain-service.ts');
    expect(orders).not.toContain("isEmergencyOverride: payload.priority === 'STAT'");
    expect(orders).toContain("allowBreakGlass: payload.priority === 'STAT'");
  });

  test('tenant switching fails closed if custom claims cannot be synchronized',async()=>{
    const route=await source('app/api/auth/tenant-selection/route.ts');
    expect(route).toContain('Firebase Admin Auth is required to synchronize tenant claims');
    expect(route).not.toContain('Tenant claims update notice');
  });

  test('offline commands are UID-bound and only PHI-free navigation shells may be cached',async()=>{
    const sync=await source('lib/offline/sync-engine.ts');
    const secure=await source('lib/offline/secure-store.ts');
    const sw=await source('public/sw.js');
    const db=await source('lib/offline/db.ts');

    expect(sync).toContain('actorId: cached.user.uid');
    expect(sync).toContain('getSecurePendingMutations(activeTenantId, cached.user.uid)');
    expect(secure).toContain('item.actorId === normalizedActorId');
    expect(secure.indexOf('item.actorId === normalizedActorId')).toBeLessThan(
      secure.indexOf('rows.map(decryptMutation)')
    );
    expect(sw).toContain("url.pathname === '/' || url.pathname === '/login'");
    expect(sw).toContain('Never cache rendered clinical/deep-link HTML');
    expect(sw).toContain("caches.match('/')");
    expect(db).toContain("offline_cache: null");
    expect(db).toContain("clinical_patients: null");
    expect(db).toContain("bed_occupancy: null");
    expect(db).toContain("surgical_cases: null");
    expect(db).not.toContain('seedDefaultBedOccupancy');
    expect(db).not.toContain('seedDefaultSurgicalCases');
  });

  test('auth/session material is not mirrored into localStorage',async()=>{
    const storage=await source('lib/offline/auth-storage.ts');
    expect(storage).not.toContain("localStorage.setItem('ghims_cached_auth_user'");
    expect(storage).not.toContain("localStorage.setItem('ghims_cached_auth_session'");
    expect(storage).toContain('clearOfflineReadModelsForTenant');
  });

  test('staging readiness performs real Firebase connectivity probes and exposes only blocker codes',async()=>{
    const readiness=await source('app/api/health/ready/route.ts');
    const admin=await source('server/firebase/admin.ts');

    expect(readiness).toContain('await auth.listUsers(1)');
    expect(readiness).toContain("db.collection('_ghims_operational').limit(1).get()");
    expect(readiness).toContain('FIREBASE_ADMIN_AUTH_CONNECTIVITY_FAILED');
    expect(readiness).toContain('FIRESTORE_CONNECTIVITY_FAILED');
    expect(admin).toContain("!process.env.VERCEL");
    expect(admin).toContain('Use FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY on Vercel');
  });

  test('bootstrap requires explicit project and production confirmations',async()=>{
    const bootstrap=await source('scripts/ops/bootstrap-admin.ts');
    expect(bootstrap).toContain('GHIMS_ALLOW_ADMIN_BOOTSTRAP');
    expect(bootstrap).toContain('GHIMS_BOOTSTRAP_CONFIRM_PROJECT');
    expect(bootstrap).toContain('GHIMS_ALLOW_PRODUCTION_ADMIN_BOOTSTRAP');
    expect(bootstrap).toContain(".doc(identity.uid)");
  });
});
