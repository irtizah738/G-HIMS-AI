import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { CommandContext } from '@/lib/backend/types';
import type {
  ClinicalPrivilege,
  EmployeeCredential,
  EmployeeMaster,
  RosterShiftEntry,
} from '@/types/hcm-advanced';

type Membership = {
  userId?: string;
  documentId?: string;
  role?: string;
  roles?: string[];
  status?: string;
  facilityIds?: string[];
  departmentIds?: string[];
};

export interface EligibleConsultant {
  consultantId: string;
  employeeId: string;
  displayName: string;
  positionTitle: string;
  specialty: string;
  subSpecialties: string[];
  departmentId: string;
  departmentName: string;
  facilityId: string;
  availability: 'ON_DUTY' | 'ON_CALL' | 'OFF_DUTY' | 'UNKNOWN';
  shiftEndsAt?: string;
  activePrivilegeTypes: string[];
  credentialVerified: true;
}

function normalizedRoles(membership: Membership): Set<string> {
  return new Set(
    [
      ...(Array.isArray(membership.roles) ? membership.roles : []),
      membership.role || '',
    ]
      .map((role) => String(role).trim().toUpperCase())
      .filter(Boolean)
  );
}

function isClinicalConsultantMembership(membership: Membership): boolean {
  const roles = normalizedRoles(membership);
  return (
    String(membership.status || '').toUpperCase() === 'ACTIVE' &&
    (roles.has('DOCTOR') ||
      roles.has('CONSULTANT') ||
      roles.has('ATTENDING_PHYSICIAN') ||
      roles.has('MEDICAL_DIRECTOR'))
  );
}

function isoDayActive(from: string | undefined, until: string | undefined, now: number): boolean {
  const start = from ? Date.parse(`${from}T00:00:00.000Z`) : Number.NEGATIVE_INFINITY;
  const end = until ? Date.parse(`${until}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;
  return now >= start && now <= end;
}

function credentialsValid(credentials: EmployeeCredential[], now: number): boolean {
  const mandatory = credentials.filter((item) => item.isMandatoryForPractice);
  if (!mandatory.length) return false;
  return mandatory.every((credential) => {
    const expiry = Date.parse(`${credential.expiryDate}T23:59:59.999Z`);
    return credential.verificationStatus === 'VERIFIED' && Number.isFinite(expiry) && expiry >= now;
  });
}

function activePrivileges(
  privileges: ClinicalPrivilege[],
  now: number,
  facilityId: string,
  departmentId: string
): ClinicalPrivilege[] {
  return privileges.filter(
    (privilege) =>
      privilege.status === 'GRANTED' &&
      privilege.facilityId === facilityId &&
      privilege.departmentId === departmentId &&
      isoDayActive(privilege.effectiveFrom, privilege.effectiveUntil, now)
  );
}

function availabilityFor(
  shifts: RosterShiftEntry[],
  now: number
): Pick<EligibleConsultant, 'availability' | 'shiftEndsAt'> {
  const active = shifts.find((shift) => {
    if (!['PUBLISHED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(shift.status)) return false;
    const start = Date.parse(shift.startTime);
    const end = Date.parse(shift.endTime);
    return Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end;
  });
  if (active) {
    return {
      availability:
        String(active.shiftName || '').toUpperCase().includes('ON CALL') ? 'ON_CALL' : 'ON_DUTY',
      shiftEndsAt: active.endTime,
    };
  }

  const hasCurrentDayRoster = shifts.some((shift) => {
    const start = Date.parse(shift.startTime);
    return Number.isFinite(start) && new Date(start).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
  });
  return { availability: hasCurrentDayRoster ? 'OFF_DUTY' : 'UNKNOWN' };
}

export class ConsultantDirectoryService {
  public static async listEligible(
    context: CommandContext,
    options: { departmentId?: string; specialty?: string } = {}
  ): Promise<EligibleConsultant[]> {
    const now = Date.now();
    const [employees, memberships, credentials, privileges, shifts] = await Promise.all([
      DomainStateRepository.list<EmployeeMaster>(context.tenantId, 'employees', 1000),
      DomainStateRepository.listWithDocumentIds<Membership>(context.tenantId, 'users', 1000),
      DomainStateRepository.list<EmployeeCredential>(context.tenantId, 'clinicalCredentials', 5000),
      DomainStateRepository.list<ClinicalPrivilege>(context.tenantId, 'clinicalPrivileges', 5000),
      DomainStateRepository.list<RosterShiftEntry>(context.tenantId, 'rosterAssignments', 5000),
    ]);

    // Membership documents are canonically keyed by Auth UID. A duplicated
    // userId field may be absent, but if present it must agree with the key.
    // Ambiguous/corrupt memberships fail closed; never join on an alias.
    const membershipByUser = new Map(
      memberships
        .filter((membership) => {
          const documentId = String(membership.documentId || '').trim();
          const embeddedId = String(membership.userId || '').trim();
          return Boolean(documentId) && (!embeddedId || embeddedId === documentId);
        })
        .map((membership) => [String(membership.documentId), membership])
    );
    const credentialsByEmployee = new Map<string, EmployeeCredential[]>();
    const privilegesByEmployee = new Map<string, ClinicalPrivilege[]>();
    const shiftsByEmployee = new Map<string, RosterShiftEntry[]>();

    for (const credential of credentials) {
      const current = credentialsByEmployee.get(credential.employeeId) || [];
      current.push(credential);
      credentialsByEmployee.set(credential.employeeId, current);
    }
    for (const privilege of privileges) {
      const current = privilegesByEmployee.get(privilege.employeeId) || [];
      current.push(privilege);
      privilegesByEmployee.set(privilege.employeeId, current);
    }
    for (const shift of shifts) {
      const current = shiftsByEmployee.get(shift.employeeId) || [];
      current.push(shift);
      shiftsByEmployee.set(shift.employeeId, current);
    }

    const requestedDepartment = String(options.departmentId || '').trim().toLowerCase();
    const requestedSpecialty = String(options.specialty || '').trim().toLowerCase();

    return employees
      .filter((employee) => employee.employmentStatus === 'ACTIVE' && Boolean(employee.userId))
      .map((employee): EligibleConsultant | null => {
        const membership = membershipByUser.get(String(employee.userId));
        if (!membership || !isClinicalConsultantMembership(membership)) return null;
        const facilityId = String(employee.primaryFacilityId || '').trim();
        const departmentId = String(employee.primaryDepartmentId || '').trim();
        if (!facilityId || !departmentId) return null;
        if (Array.isArray(employee.facilityIds) && !employee.facilityIds.includes(facilityId)) return null;
        if (Array.isArray(employee.departmentIds) && !employee.departmentIds.includes(departmentId)) return null;
        if (Array.isArray(membership.facilityIds) && !membership.facilityIds.includes(facilityId)) return null;
        if (Array.isArray(membership.departmentIds) && !membership.departmentIds.includes(departmentId)) return null;
        if (!credentialsValid(credentialsByEmployee.get(employee.employeeId) || [], now)) return null;

        const granted = activePrivileges(
          privilegesByEmployee.get(employee.employeeId) || [], now, facilityId, departmentId
        );
        if (!granted.length) return null;

        const departmentName = String(employee.primaryDepartmentName || departmentId).trim();
        const specialty = String(employee.specialty || employee.positionTitle || departmentName).trim();
        const searchableSpecialty = [
          specialty,
          ...(employee.subSpecialties || []),
          departmentName,
          employee.positionTitle,
        ]
          .join(' ')
          .toLowerCase();

        if (requestedDepartment && departmentId.toLowerCase() !== requestedDepartment) return null;
        if (requestedSpecialty && !searchableSpecialty.includes(requestedSpecialty)) return null;

        const displayName = [
          employee.personalInfo?.preferredName || employee.personalInfo?.legalFirstName,
          employee.personalInfo?.legalLastName,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();

        return {
          consultantId: String(employee.userId),
          employeeId: employee.employeeId,
          displayName: displayName || employee.employeeNumber,
          positionTitle: employee.positionTitle || 'Consultant',
          specialty,
          subSpecialties: employee.subSpecialties || [],
          departmentId,
          departmentName,
          facilityId: employee.primaryFacilityId,
          ...availabilityFor(
            (shiftsByEmployee.get(employee.employeeId) || []).filter(
              (shift) => shift.facilityId === facilityId && shift.departmentId === departmentId && shift.tenantId === context.tenantId
            ), now
          ),
          activePrivilegeTypes: Array.from(new Set(granted.map((item) => item.privilegeType))).sort(),
          credentialVerified: true,
        };
      })
      .filter((item): item is EligibleConsultant => Boolean(item))
      .sort((left, right) => {
        const availabilityRank = { ON_DUTY: 0, ON_CALL: 1, UNKNOWN: 2, OFF_DUTY: 3 };
        return (
          availabilityRank[left.availability] - availabilityRank[right.availability] ||
          left.displayName.localeCompare(right.displayName)
        );
      });
  }
}
