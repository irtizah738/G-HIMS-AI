/**
 * G-HIMS Server-Side Authorization Context Resolver
 * Resolves complete RBAC, ABAC, Department & Facility Scopes, Clinical Privileges.
 */

import { AuthorizationContext } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';
import { VerifiedTokenResult } from './verify-token';
import { getTenantMembership } from './tenant-membership';
import { getAdminFirestore } from '@/server/firebase/admin';
import type {
  ClinicalPrivilege,
  EmployeeCredential,
  EmployeeMaster,
} from '@/types/hcm-advanced';

function isClinicalRole(roles:string[]):boolean{
  const clinical=new Set([
    'doctor','physician','surgeon','nurse','pharmacist','radiologist',
    'anesthesiologist','lab_tech','labtechnician'
  ]);
  return roles.some(role=>clinical.has(role.toLowerCase()));
}

function mapHcmPrivilegeToAuthorization(privilege:ClinicalPrivilege['privilegeType']):string[]{
  const map:Record<ClinicalPrivilege['privilegeType'],string[]>={
    CONSULT_OPD:['CONSULT_OPD'],
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
    SIGN_DEATH_CERTIFICATE:['SIGN_DEATH_CERTIFICATE','SIGN_CLINICAL_NOTES'],
    PERFORM_INVASIVE_PROCEDURES:['PERFORM_INVASIVE_PROCEDURES','PERFORM_PROCEDURES'],
    SIGN_SOAP_CLINICAL_NOTE:['SIGN_SOAP_CLINICAL_NOTE','SIGN_CLINICAL_NOTES'],
  };
  return map[privilege]||[privilege];
}

async function resolveCredentialGatedPrivileges(params:{
  tenantId:string;
  userId:string;
  email:string;
  roles:string[];
  facilityIds:string[];
  departmentIds:string[];
  declaredClinicalPrivileges:string[];
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

  if(!employee && params.email){
    const normalizedEmail=params.email.trim().toLowerCase();
    const byEmail=await tenantRef.collection('employees')
      .where('personalInfo.contactEmail','==',normalizedEmail).limit(2).get();
    if(byEmail.size===1){
      employee=byEmail.docs[0].data() as EmployeeMaster;
    }else if(byEmail.size>1){
      return [];
    }
  }

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

  const mandatory=credentials.filter(credential=>credential.isMandatoryForPractice);
  if(
    mandatory.length===0 ||
    mandatory.some(credential=>
      credential.verificationStatus!=='VERIFIED' ||
      !credential.expiryDate ||
      credential.expiryDate<today
    )
  ) return [];

  const facilityScope=new Set(params.facilityIds);
  const departmentScope=new Set(params.departmentIds);

  // These are role-baseline clinical capabilities, not specialty privileges.
  // They remain unavailable until the HCM employee has a valid mandatory
  // credential. Specialty/high-risk capabilities are added only from explicit
  // active HCM ClinicalPrivilege grants below.
  const credentialGatedRoleBaseline = new Set([
    'ADMIT_INPATIENT',
    'DISCHARGE_INPATIENT',
    'RECORD_VITALS',
    'TRIAGE_PATIENTS',
    'UPDATE_BED_OCCUPANCY',
    'EXECUTE_NURSING_CARE_PLAN',
  ]);
  const effective=new Set<string>(
    params.declaredClinicalPrivileges.filter((value)=>
      credentialGatedRoleBaseline.has(String(value).toUpperCase())
    )
  );
  for(const privilege of privileges){
    if(
      privilege.status!=='GRANTED' ||
      privilege.effectiveFrom>today ||
      privilege.effectiveUntil<today
    ) continue;
    if(facilityScope.size>0&&!facilityScope.has(privilege.facilityId)) continue;
    if(departmentScope.size>0&&!departmentScope.has(privilege.departmentId)) continue;
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
        declaredClinicalPrivileges:membership.clinicalPrivileges,
      })
    : membership.clinicalPrivileges;

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
