/**
 * G-HIMS Server-Side Authorization Context Resolver
 * Resolves complete RBAC, ABAC, Department & Facility Scopes, Clinical Privileges.
 */

import { AuthorizationContext } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';
import { VerifiedTokenResult } from './verify-token';
import { getTenantMembership } from './tenant-membership';
import { credentialsValid } from '@/lib/clinical/intelligence/consultant-directory-service';
import { getAdminFirestore } from '@/server/firebase/admin';
import type {
  ClinicalPrivilege,
  EmployeeCredential,
  EmployeeMaster,
} from '@/types/hcm-advanced';

function isClinicalRole(roles:string[]):boolean{
  const clinical=new Set([
    'doctor','physician','surgeon','nurse','pharmacist','radiologist',
    'consultant','attending_physician','medical_officer','medical_director',
    'anesthesiologist','lab_tech','labtechnician'
  ]);
  return roles.some(role=>clinical.has(role.toLowerCase()));
}

/** Clinical credential and privilege windows must never be open-ended or malformed. */
function hcmDateWindowActive(
  from: string | undefined,
  until: string | undefined,
  today: string
): boolean {
  const canonicalDate = (value: string | undefined): value is string => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
  };
  return canonicalDate(from) && canonicalDate(until) &&
    from <= today && today <= until;
}

function mapHcmPrivilegeToAuthorization(privilege: ClinicalPrivilege['privilegeType'] | string): string[] {
  const map: Record<string, string[]> = {
    CONSULT_OPD:['CONSULT_OPD'],
    RECORD_VITALS:['RECORD_VITALS'],
    TRIAGE_PATIENTS:['TRIAGE_PATIENTS'],
    ADMIT_INPATIENT:['ADMIT_INPATIENT'],
    DISCHARGE_INPATIENT:['DISCHARGE_INPATIENT'],
    ADMINISTER_MEDICATIONS:['ADMINISTER_MEDICATIONS'],
    EXECUTE_NURSING_CARE_PLAN:['EXECUTE_NURSING_CARE_PLAN'],
    PRESCRIBE_MEDICATION:['PRESCRIBE_MEDICATION','PRESCRIBE','ORDER_MEDICATIONS','SIGN_PRESCRIPTIONS'],
    PERFORM_GENERAL_SURGERY:['PERFORM_GENERAL_SURGERY','PERFORM_PROCEDURES'],
    PERFORM_CARDIOTHORACIC_SURGERY:['PERFORM_CARDIOTHORACIC_SURGERY','PERFORM_PROCEDURES'],
    ADMINISTER_ANESTHESIA:['ADMINISTER_ANESTHESIA','PERFORM_PROCEDURES'],
    ORDER_LAB:['ORDER_LAB','ORDER_DIAGNOSTICS'],
    ORDER_RADIOLOGY:['ORDER_RADIOLOGY','ORDER_DIAGNOSTICS'],
    ORDER_PROCEDURE:['ORDER_PROCEDURE'],
    ORDER_HIGH_COMPLEXITY_LAB:['ORDER_HIGH_COMPLEXITY_LAB'],
    APPROVE_LAB_RESULTS:['APPROVE_LAB_RESULTS'],
    VERIFY_LAB_RESULT:['VERIFY_LAB_RESULT'],
    ACKNOWLEDGE_CRITICAL_RESULT:['ACKNOWLEDGE_CRITICAL_RESULT'],
    INTERPRET_IMAGING:['INTERPRET_IMAGING'],
    INTERPRET_RADIOLOGY_CT_MRI:['INTERPRET_RADIOLOGY_CT_MRI','INTERPRET_IMAGING'],
    DISPENSE_MEDICATION:['DISPENSE_MEDICATION'],
    SIGN_CLINICAL_NOTE:['SIGN_CLINICAL_NOTE','SIGN_CLINICAL_NOTES'],
    SIGN_CLINICAL_NOTES:['SIGN_CLINICAL_NOTE','SIGN_CLINICAL_NOTES'],
    SIGN_DEATH_CERTIFICATE:['SIGN_DEATH_CERTIFICATE','SIGN_CLINICAL_NOTES'],
    PERFORM_INVASIVE_PROCEDURES:['PERFORM_INVASIVE_PROCEDURES','PERFORM_PROCEDURES'],
    SIGN_SOAP_CLINICAL_NOTE:['SIGN_SOAP_CLINICAL_NOTE','SIGN_CLINICAL_NOTES'],
  };
  const key = String(privilege || '').trim().toUpperCase();
  return map[key] || [key];
}

async function resolveCredentialGatedPrivileges(params:{
  tenantId:string;
  userId:string;
  email:string;
  roles:string[];
  facilityIds:string[];
  departmentIds:string[];
 }):Promise<string[]>{
  if(!isClinicalRole(params.roles)) return [];
  const db=getAdminFirestore();
  if(!db) return [];

  const tenantRef=db.collection('tenants').doc(params.tenantId);
  let employee:EmployeeMaster|undefined;

  const byUser=await tenantRef.collection('employees')
    .where('userId','==',params.userId).limit(2).get();
  if(byUser.size===1){
    employee=byUser.docs[0].data() as EmployeeMaster;
  }else if(byUser.size>1){
    return [];
  }

  // Never infer clinical identity from email, which can be renamed or reused.
  // HCM personnel authority must explicitly bind the authenticated Firebase UID.
  if (!employee || employee.userId !== params.userId) return [];

  // Clinical authority has exactly one source of truth: the canonical HCM
  // employee -> mandatory credentials -> scoped ClinicalPrivilege chain.
  // Tenant membership metadata may describe identity/role, but it can never
  // substitute for a missing clinical employee or credential record.
  if(!employee || employee.employmentStatus!=='ACTIVE') return [];

  const [credentialSnap,privilegeSnap]=await Promise.all([
    tenantRef.collection('clinicalCredentials')
      .where('employeeId','==',employee.employeeId).get(),
    tenantRef.collection('clinicalPrivileges')
      .where('employeeId','==',employee.employeeId).get(),
  ]);
  const credentials=credentialSnap.docs.map(doc=>doc.data() as EmployeeCredential);
  const privileges=privilegeSnap.docs.map(doc=>doc.data() as ClinicalPrivilege);
  const today=new Date().toISOString().slice(0,10);

  // Reuse directory's mandatory credential policy; VERIFIED without
  // independent verifier and timestamp does not grant clinical authority.
  if (!credentialsValid(credentials, Date.now())) return [];

  const facilityScope = new Set(
    params.facilityIds.map((id) => String(id || '').trim().toUpperCase()).filter(Boolean)
  );
  const departmentScope = new Set(
    params.departmentIds.map((id) => String(id || '').trim().toUpperCase()).filter(Boolean)
  );
  const employeeFacilities = new Set(
    (employee.facilityIds || []).map((id) => String(id || '').trim().toUpperCase()).filter(Boolean)
  );
  const employeeDepartments = new Set(
    (employee.departmentIds || []).map((id) => String(id || '').trim().toUpperCase()).filter(Boolean)
  );
  if (
    facilityScope.size === 0 ||
    departmentScope.size === 0 ||
    ![...facilityScope].some((id) => employeeFacilities.has(id)) ||
    ![...departmentScope].some((id) => employeeDepartments.has(id))
  ) return [];

  // Role and membership metadata are descriptive only. Every clinical
  // capability must come from a current HCM privilege grant.
  const effective = new Set<string>();
  for(const privilege of privileges){
    if(
      privilege.status!=='GRANTED' ||
      !hcmDateWindowActive(privilege.effectiveFrom, privilege.effectiveUntil, today)
    ) continue;
    const privFacility = String(privilege.facilityId || '').trim().toUpperCase();
    const privDept = String(privilege.departmentId || '').trim().toUpperCase();
    if (!privFacility || !privDept || !facilityScope.has(privFacility) ||
        !departmentScope.has(privDept) || !employeeFacilities.has(privFacility) ||
        !employeeDepartments.has(privDept)) continue;
    mapHcmPrivilegeToAuthorization(privilege.privilegeType)
      .forEach(value=>effective.add(value));
  }
  return [...effective];
}

export async function resolveAuthorizationContext(
  verifiedToken: VerifiedTokenResult,
  targetTenantId?: string,
  sessionId?: string,
  deviceId?: string
): Promise<AuthorizationContext> {
  const tenantId = (targetTenantId || verifiedToken.claims.tenantId || '').toLowerCase().trim();

  if (!tenantId) {
    throw new AuthError({
      code: 'TENANT_ACCESS_DENIED',
      message: 'Explicit tenant scope is required to resolve authorization.',
      statusCode: 403,
    });
  }

  const membership = await getTenantMembership(
    tenantId,
    verifiedToken.uid,
    verifiedToken.email,
    verifiedToken.name
  );

  if (membership.status === 'DISABLED') {
    throw new AuthError({
      code: 'ACCOUNT_DISABLED',
      message: `User account ${verifiedToken.uid} is disabled in tenant ${tenantId}`,
      statusCode: 403,
      userMessage: 'Your clinical account has been disabled by the Hospital IT Security Administrator.',
    });
  }

  if (membership.status === 'SUSPENDED') {
    throw new AuthError({
      code: 'ACCOUNT_SUSPENDED',
      message: `User account ${verifiedToken.uid} is suspended in tenant ${tenantId}`,
      statusCode: 403,
      userMessage: 'Your clinical account is currently suspended pending credential re-verification.',
    });
  }

  if (membership.status === 'PENDING') {
    throw new AuthError({
      code: 'ACCOUNT_PENDING',
      message: `User account ${verifiedToken.uid} is pending approval in tenant ${tenantId}`,
      statusCode: 403,
      userMessage: 'Your account registration is pending departmental administrator approval.',
    });
  }

  const clinicalPrivileges=isClinicalRole(membership.roles)
    ? await resolveCredentialGatedPrivileges({
        tenantId:membership.tenantId,
        userId:verifiedToken.uid,
        email:verifiedToken.email,
        roles:membership.roles,
        facilityIds:membership.facilityIds,
        departmentIds:membership.departmentIds,
       })
    : [];

  return {
    uid: verifiedToken.uid,
    email: verifiedToken.email,
    tenantId: membership.tenantId,
    roles: membership.roles,
    permissions: membership.permissions,
    financialAuthorityMinorUnits: membership.financialAuthorityMinorUnits,
    departmentIds: membership.departmentIds,
    facilityIds: membership.facilityIds,
    clinicalPrivileges,
    accountStatus: membership.status,
    sessionId: sessionId || '',
    deviceId,
    isEmergencyOverride: false,
  };
}
