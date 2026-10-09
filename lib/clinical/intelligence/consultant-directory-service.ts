import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { CommandContext } from '@/lib/backend/types';
import type {
  ClinicalPrivilege,
  EmployeeCredential,
  EmployeeMaster,
  RosterShiftEntry,
} from '@/types/hcm-advanced';

/** ORC-2B: Canonical result type for the assertConsultantEligibility() predicate. */
export interface ConsultantEligibilityResult {
  eligible: boolean;
  employeeId: string;
  /** Populated only when eligible === false. */
  reason?: string;
  /** Active privilege types for eligible consultants (sorted). */
  activePrivilegeTypes?: string[];
  availability?: EligibleConsultant['availability'];
  shiftEndsAt?: string;
}

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

export function isClinicalConsultantMembership(membership: Membership): boolean {
  const roles = normalizedRoles(membership);
  return (
    String(membership.status || '').toUpperCase() === 'ACTIVE' &&
    (roles.has('DOCTOR') ||
      roles.has('CONSULTANT') ||
      roles.has('ATTENDING_PHYSICIAN') ||
      roles.has('MEDICAL_DIRECTOR'))
  );
}

/**
 * Authorization dates are explicitly bounded. Missing, malformed, reversed,
 * or future-effective HCM records never grant clinical access.
 */
export function isoDayActive(from: string | undefined, until: string | undefined, now: number): boolean {
  if (!Number.isFinite(now)) return false;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !until || !datePattern.test(from) || !datePattern.test(until) || from > until) {
    return false;
  }
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${until}T23:59:59.999Z`);
  return Number.isFinite(start) && Number.isFinite(end) &&
    new Date(start).toISOString().slice(0, 10) === from &&
    new Date(end).toISOString().slice(0, 10) === until &&
    now >= start && now <= end;
}

export function credentialsValid(credentials: EmployeeCredential[], now: number): boolean {
  const mandatory = credentials.filter((item) => item.isMandatoryForPractice);
  if (!mandatory.length) return false;
  return mandatory.every((credential) =>
    credential.verificationStatus === 'VERIFIED' &&
    Boolean(credential.verifiedByActorId) &&
    Boolean(credential.verifiedAt) &&
    isoDayActive(credential.issueDate, credential.expiryDate, now)
  );
}

export function activePrivileges(privileges: ClinicalPrivilege[], now: number, facilityId?: string, departmentId?: string): ClinicalPrivilege[] {
  return privileges.filter(
    (privilege) =>
      privilege.status === 'GRANTED' &&
      (!facilityId || privilege.facilityId === facilityId) &&
      (!departmentId || privilege.departmentId === departmentId) &&
      isoDayActive(privilege.effectiveFrom, privilege.effectiveUntil, now)
  );
}

/** Only roster-confirmed, credentialed and scoped consultants may receive a direct assignment. */
export function isRoutableConsultant(
  consultant: EligibleConsultant | undefined,
  encounterFacilityId: string
): boolean {
  const facilityId = String(encounterFacilityId || '').trim().toUpperCase();
  return Boolean(
    consultant && facilityId &&
    String(consultant.facilityId || '').trim().toUpperCase() === facilityId &&
    consultant.credentialVerified === true &&
    consultant.activePrivilegeTypes.includes('CONSULT_OPD') &&
    (consultant.availability === 'ON_DUTY' || consultant.availability === 'ON_CALL')
  );
}

export function availabilityFor(
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
  /**
   * ORC-2B: Authoritative consultant eligibility predicate.
   *
   * This is the canonical, re-usable check for whether a specific employee can
   * act as a consultant **right now** for a given facility and department.
   * Call this from:
   *   - ER routing command handler (before assigning a consultant)
   *   - Referral command handler (before recording an internal referral)
   *   - Consultant assignment API (before persisting the assignment)
   *
   * The check is a pure in-memory evaluation over pre-fetched HCM records;
   * all reads happen before the call so this can run inside a Firestore
   * transaction's prepare() callback without additional Firestore reads.
   *
   * @param employee     The HCM EmployeeMaster record.
   * @param membership   The tenant membership document for employee.userId.
   * @param credentials  All clinicalCredentials docs for this employee.
   * @param privileges   All clinicalPrivileges docs for this employee.
   * @param shifts       All rosterAssignments docs for this employee.
   * @param facilityId   The target facility; must match a privilege scope.
   * @param departmentId Optional department filter; must match a privilege scope.
   * @param now          Evaluation timestamp (Date.now()). Pass explicitly for testability.
   */
  public static assertConsultantEligibility(params: {
    employee: EmployeeMaster;
    membership: Membership | undefined;
    credentials: EmployeeCredential[];
    privileges: ClinicalPrivilege[];
    shifts: RosterShiftEntry[];
    facilityId: string;
    departmentId?: string;
    now: number;
  }): ConsultantEligibilityResult {
    const { employee, membership, credentials, privileges, shifts, facilityId, departmentId, now } = params;
    const employeeId = employee.employeeId;

    if (employee.employmentStatus !== 'ACTIVE') {
      return { eligible: false, employeeId, reason: 'EMPLOYEE_NOT_ACTIVE' };
    }
    if (!employee.userId) {
      return { eligible: false, employeeId, reason: 'EMPLOYEE_HAS_NO_USER_ACCOUNT' };
    }
    if (!membership || !isClinicalConsultantMembership(membership)) {
      return { eligible: false, employeeId, reason: 'MEMBERSHIP_NOT_CLINICAL_CONSULTANT' };
    }
    const normalizedFacilityForMembership = String(facilityId || '').trim().toUpperCase();
    const memberFacilityScope = (membership.facilityIds || [])
      .map(value => String(value || '').trim().toUpperCase());
    if (!memberFacilityScope.includes(normalizedFacilityForMembership)) {
      return { eligible: false, employeeId, reason: 'MEMBERSHIP_FACILITY_SCOPE_MISMATCH' };
    }
    if (departmentId && !(membership.departmentIds || [])
      .some(value => String(value || '').trim().toUpperCase() === String(departmentId).trim().toUpperCase())) {
      return { eligible: false, employeeId, reason: 'MEMBERSHIP_DEPARTMENT_SCOPE_MISMATCH' };
    }
    if (!credentialsValid(credentials, now)) {
      return { eligible: false, employeeId, reason: 'MANDATORY_CREDENTIALS_INVALID_OR_EXPIRED' };
    }

    const granted = activePrivileges(privileges, now);
    if (!granted.length) {
      return { eligible: false, employeeId, reason: 'NO_ACTIVE_CLINICAL_PRIVILEGE' };
    }

    // ORC-2B: Facility scope is mandatory. A privilege at another facility does
    // not authorize consultation at the requested facility.
    const normalizedFacility = facilityId.trim();
    if (!normalizedFacility) {
      return { eligible: false, employeeId, reason: 'FACILITY_ID_REQUIRED' };
    }
    const facilityPrivileges = granted.filter(
      (p) => String(p.facilityId || '').trim() === normalizedFacility
    );
    if (!facilityPrivileges.length) {
      return { eligible: false, employeeId, reason: `NO_PRIVILEGE_AT_FACILITY_${normalizedFacility}` };
    }

    if (departmentId) {
      const normalizedDept = departmentId.trim();
      const deptPrivileges = facilityPrivileges.filter(
        (p) => String(p.departmentId || '').trim().toUpperCase() === normalizedDept.toUpperCase()
      );
      if (!deptPrivileges.length) {
        return { eligible: false, employeeId, reason: `NO_PRIVILEGE_AT_DEPARTMENT_${normalizedDept}` };
      }
    }

    if (!facilityPrivileges.some(p => p.privilegeType === 'CONSULT_OPD')) {
      return { eligible: false, employeeId, reason: 'CONSULTATION_PRIVILEGE_REQUIRED' };
    }
    const activePrivilegeTypes = Array.from(
      new Set(facilityPrivileges.map((p) => p.privilegeType))
    ).sort();

    const avail = availabilityFor(shifts.filter(shift =>
      shift.employeeId === employeeId &&
      String(shift.facilityId || '').trim().toUpperCase() === normalizedFacility.toUpperCase() &&
      (!departmentId || String(shift.departmentId || '').trim().toUpperCase() === String(departmentId).trim().toUpperCase())
    ), now);
    return {
      eligible: true,
      employeeId,
      activePrivilegeTypes,
      availability: avail.availability,
      shiftEndsAt: avail.shiftEndsAt,
    };
  }

  public static async listEligible(
    context: CommandContext,
    options: {
      departmentId?: string;
      specialty?: string;
      /** ORC-2B: Explicit facility scope. Defaults to actor's authoritative facilityIds. */
      facilityId?: string;
    } = {}
  ): Promise<EligibleConsultant[]> {
    const now = Date.now();

    // ORC-2B: Determine the authoritative facility scope for this request.
    // The actor can only see consultants at facilities they are authorized for.
    // An explicit facilityId option narrows further; it cannot expand scope.
    const actorFacilityIds = new Set(
      (context.facilityIds || []).map((id) => String(id).trim()).filter(Boolean)
    );
    const requestedFacilityId = String(options.facilityId || '').trim();
    const effectiveFacilityIds: Set<string> =
      requestedFacilityId && actorFacilityIds.has(requestedFacilityId)
        ? new Set([requestedFacilityId])
        : requestedFacilityId && actorFacilityIds.size > 0
          ? new Set() // requested a facility the actor cannot access — return empty
          : actorFacilityIds; // no explicit request: use all authorized facilities

    // An actor with no authorized facility must never enumerate HCM records.
    if (effectiveFacilityIds.size === 0) return [];

    const [employees, memberships, credentials, privileges, shifts] = await Promise.all([
      DomainStateRepository.listAllWithDocumentIds<EmployeeMaster>(context.tenantId, 'employees'),
      DomainStateRepository.listAllWithDocumentIds<Membership>(context.tenantId, 'users'),
      DomainStateRepository.listAllWithDocumentIds<EmployeeCredential>(context.tenantId, 'clinicalCredentials'),
      DomainStateRepository.listAllWithDocumentIds<ClinicalPrivilege>(context.tenantId, 'clinicalPrivileges'),
      DomainStateRepository.listAllWithDocumentIds<RosterShiftEntry>(context.tenantId, 'rosterAssignments'),
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
      .filter((employee) =>
        employee.employmentStatus === 'ACTIVE' &&
        Boolean(employee.userId) &&
        effectiveFacilityIds.has(String(employee.primaryFacilityId || '').trim())
      )
      .map((employee): EligibleConsultant | null => {
        const membership = membershipByUser.get(String(employee.userId));

        // ORC-2B: Use the authoritative eligibility predicate rather than
        // duplicating the credential + privilege + facility logic inline.
        // facilityId from primaryFacilityId is the canonical facility scope;
        // if the employee has no primaryFacilityId, they are not placeable.
        const primaryFacilityId = String(employee.primaryFacilityId || '').trim();
        if (!primaryFacilityId) return null;

        // ORC-2B: Facility-scope filter — actor can only see consultants at
        // their own authorized facilities.
        if (!effectiveFacilityIds.has(primaryFacilityId)) return null;

        const eligibility = ConsultantDirectoryService.assertConsultantEligibility({
          employee,
          membership,
          credentials: credentialsByEmployee.get(employee.employeeId) || [],
          privileges: privilegesByEmployee.get(employee.employeeId) || [],
          shifts: shiftsByEmployee.get(employee.employeeId) || [],
          facilityId: primaryFacilityId,
          departmentId: options.departmentId,
          now,
        });
        if (!eligibility.eligible) return null;

        const departmentId = String(employee.primaryDepartmentId || '').trim();
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
          facilityId: primaryFacilityId,
          // ORC-2B: Use availability computed by the eligibility predicate.
          availability: eligibility.availability ?? 'UNKNOWN',
          shiftEndsAt: eligibility.shiftEndsAt,
          activePrivilegeTypes: eligibility.activePrivilegeTypes || [],
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
