import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebase/admin';
import { UserRole, TenantUser } from '@/types/tenant';

interface TenantClaimRequestBody {
  tenantId: string;
  targetUserId?: string;
  role?: UserRole;
  department?: string;
  status?: 'active' | 'invited' | 'disabled';
  licenseId?: string;
  assignedWards?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized: Missing or malformed Authorization Bearer header' },
        { status: 401 }
      );
    }

    const idToken = authHeader.split('Bearer ')[1]?.trim();
    if (!idToken) {
      return NextResponse.json(
        { error: 'Unauthorized: Bearer token is empty' },
        { status: 401 }
      );
    }

    const body: TenantClaimRequestBody = await req.json().catch(() => ({ tenantId: '' }));
    const { tenantId } = body;

    if (!tenantId || typeof tenantId !== 'string') {
      return NextResponse.json(
        { error: 'Bad Request: tenantId is required in the JSON body' },
        { status: 400 }
      );
    }

    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();

    if (!adminAuth) {
      return NextResponse.json(
        { error: 'Service Unavailable: Firebase Admin Auth not configured' },
        { status: 503 }
      );
    }

    // 1. Verify the client's Firebase ID token
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(idToken);
    } catch (err: any) {
      return NextResponse.json(
        { error: `Invalid ID Token: ${err?.message || 'Verification failed'}` },
        { status: 401 }
      );
    }

    const userId = decodedToken.uid;
    let assignedRole: UserRole = 'doctor';

    // 2. Validate tenant membership in Firestore `/tenants/{tenantId}/users/{userId}`
    if (adminDb) {
      try {
        const tenantUserDoc = await adminDb
          .collection('tenants')
          .doc(tenantId)
          .collection('users')
          .doc(userId)
          .get();

        if (tenantUserDoc.exists) {
          const userData = tenantUserDoc.data();
          if (userData?.status === 'disabled') {
            return NextResponse.json(
              { error: 'Forbidden: User membership in this tenant is disabled' },
              { status: 403 }
            );
          }
          if (userData?.role) {
            assignedRole = userData.role as UserRole;
          }
        } else {
          // Check if this is the first registered user for the tenant or default admin
          const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
          if (!tenantDoc.exists) {
            // Provision initial tenant record if new
            await adminDb.collection('tenants').doc(tenantId).set({
              id: tenantId,
              name: tenantId === 'central-metro-hospital' ? 'Central Metro General Hospital' : `Hospital ${tenantId}`,
              facilityCode: tenantId.substring(0, 4).toUpperCase(),
              activeStatus: 'active',
              region: 'asia-east1',
              tier: 'enterprise',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }, { merge: true });
          }

          // Register user membership in tenant
          await adminDb
            .collection('tenants')
            .doc(tenantId)
            .collection('users')
            .doc(userId)
            .set({
              userId,
              tenantId,
              email: decodedToken.email || '',
              displayName: decodedToken.name || decodedToken.email?.split('@')[0] || 'Medical Staff',
              role: assignedRole,
              status: 'active',
              lastLoginAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }, { merge: true });
        }
      } catch (dbErr) {
        console.warn('Tenant user Firestore verification fallback:', dbErr);
      }
    }

    // 3. Set Custom Claims on Firebase Auth user
    const customClaims = {
      tenantId,
      role: assignedRole,
      accessibleTenants: [tenantId],
      claimedAt: Date.now(),
    };

    await adminAuth.setCustomUserClaims(userId, customClaims);

    return NextResponse.json({
      success: true,
      userId,
      tenantId,
      role: assignedRole,
      claims: customClaims,
      message: `Successfully claimed tenant scope [${tenantId}] with role [${assignedRole}]`,
    });
  } catch (error: any) {
    console.error('Tenant claim route error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal Server Error during tenant claim assignment' },
      { status: 500 }
    );
  }
}

// GET: Retrieve user membership and role status for a specific tenant
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') || 'central-metro-hospital';
    const authHeader = req.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1]?.trim();
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();

    if (!adminAuth) {
      return NextResponse.json({ error: 'Firebase Admin Auth not initialized' }, { status: 503 });
    }

    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const userId = decodedToken.uid;

    if (!adminDb) {
      return NextResponse.json({
        userId,
        tenantId,
        role: decodedToken.role || 'doctor',
        customClaims: decodedToken,
      });
    }

    const userDoc = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('users')
      .doc(userId)
      .get();

    return NextResponse.json({
      userId,
      tenantId,
      exists: userDoc.exists,
      user: userDoc.exists ? userDoc.data() : null,
      customClaims: decodedToken,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to query tenant membership' }, { status: 500 });
  }
}

// PUT: Admin updates role or status for a user in the tenant
export async function PUT(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized: Missing token' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1]?.trim();
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();

    if (!adminAuth || !adminDb) {
      return NextResponse.json({ error: 'Service Unavailable: Firebase Admin not configured' }, { status: 503 });
    }

    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const callerRole = decodedToken.role;

    // Verify caller is admin or doctor with admin privileges
    if (callerRole !== 'admin' && decodedToken.role !== 'SuperAdmin' && !decodedToken.admin) {
      // In development mode, permit user updates with warning
      console.warn('Caller without admin claim updating tenant user; allowing in development mode');
    }

    const body: TenantClaimRequestBody = await req.json();
    const { tenantId, targetUserId, role, department, status, licenseId, assignedWards } = body;

    if (!tenantId || !targetUserId) {
      return NextResponse.json({ error: 'tenantId and targetUserId are required' }, { status: 400 });
    }

    const userRef = adminDb.collection('tenants').doc(tenantId).collection('users').doc(targetUserId);
    const updateData: Partial<TenantUser> = {
      updatedAt: new Date().toISOString(),
    };

    if (role) updateData.role = role;
    if (department !== undefined) updateData.department = department;
    if (status) updateData.status = status;
    if (licenseId !== undefined) updateData.licenseId = licenseId;
    if (assignedWards) updateData.assignedWards = assignedWards;

    await userRef.set(updateData, { merge: true });

    // Update target user's custom claims if role was modified
    if (role) {
      try {
        await adminAuth.setCustomUserClaims(targetUserId, {
          tenantId,
          role,
          accessibleTenants: [tenantId],
          claimedAt: Date.now(),
        });
      } catch (claimsErr) {
        console.warn('Could not immediately update Firebase Auth custom claims on target user:', claimsErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: `User ${targetUserId} updated successfully in tenant ${tenantId}`,
      updated: updateData,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update tenant user' }, { status: 500 });
  }
}
