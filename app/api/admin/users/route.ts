import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import {
  UserProvisioningService,
  type ProvisionableUiRole,
} from '@/server/auth/user-provisioning-service';
import { logAuthEvent } from '@/server/auth/audit-service';

const IAM_ADMIN_ROLES = new Set([
  'ADMIN',
  'ADMINISTRATOR',
  'SYSTEM_ADMIN',
  'SUPER_ADMIN',
  'HOSPITAL_ADMIN',
]);

async function requireIamAdmin(req: NextRequest, tenantId: string) {
  const { context } = await deriveAuthoritativeContext(req, tenantId);
  if (!context.roles.some((role) => IAM_ADMIN_ROLES.has(role))) {
    throw new Error('IAM_ADMIN_REQUIRED');
  }
  return context;
}

function statusForError(message: string): number {
  if (/AUTH|TENANT|SESSION|IAM_ADMIN_REQUIRED/i.test(message)) return 403;
  if (/EXISTS/.test(message)) return 409;
  if (/NOT_FOUND/.test(message)) return 404;
  if (/INPUT|ROLE_INVALID/.test(message)) return 400;
  if (/UNAVAILABLE/.test(message)) return 503;
  return 500;
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim().toLowerCase();
    if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });

    await requireIamAdmin(req, tenantId);
    const users = await UserProvisioningService.listTenantUsers(tenantId);
    return NextResponse.json({ users });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list tenant users';
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    const context = await requireIamAdmin(req, tenantId);

    const result = await UserProvisioningService.provision({
      tenantId,
      email: String(body.email || ''),
      displayName: String(body.displayName || ''),
      role: String(body.role || '') as ProvisionableUiRole,
      department: body.department,
      licenseId: body.licenseId,
      assignedWards: Array.isArray(body.assignedWards) ? body.assignedWards : [],
    });

    await logAuthEvent({
      eventType: 'USER_PROVISIONED',
      tenantId,
      userId: context.actorId,
      reason: 'Hospital administrator provisioned tenant membership',
      metadata: {
        targetUserId: result.user.userId,
        targetRole: result.user.role,
        identityCreated: result.identityCreated,
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to provision tenant user';
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    const context = await requireIamAdmin(req, tenantId);
    const targetUserId = String(body.userId || '').trim();

    if (
      targetUserId === context.actorId &&
      String(body.status || '').toLowerCase() === 'disabled'
    ) {
      return NextResponse.json(
        { error: 'IAM_SELF_DISABLE_FORBIDDEN' },
        { status: 409 }
      );
    }

    const user = await UserProvisioningService.update({
      tenantId,
      userId: targetUserId,
      status: body.status,
      role: body.role,
      department: body.department,
      licenseId: body.licenseId,
      assignedWards: Array.isArray(body.assignedWards) ? body.assignedWards : undefined,
    });

    await logAuthEvent({
      eventType: 'USER_ACCESS_UPDATED',
      tenantId,
      userId: context.actorId,
      reason: 'Hospital administrator updated tenant IAM membership',
      metadata: {
        targetUserId,
        targetRole: user.role,
        targetStatus: user.status,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update tenant user';
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}
