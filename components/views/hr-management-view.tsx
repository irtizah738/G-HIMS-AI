'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  Building2,
  ShieldCheck,
  ShieldAlert,
  Award,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Search,
  Plus,
  Filter,
  DollarSign,
  Briefcase,
  Layers,
  FileCheck,
  Activity,
  AlertTriangle,
  UserCheck,
  FileSpreadsheet,
  Lock,
  ChevronRight,
  TrendingUp,
  UserPlus,
  RefreshCw,
  Sparkles,
  BookOpen,
  Sliders,
  CheckSquare,
  XCircle,
  HelpCircle,
  Eye,
  Edit,
  Share2,
  Tablet,
} from 'lucide-react';
import { TabletLeadDashboard } from '@/components/hcm/TabletLeadDashboard';
import { OvertimeBudgetVarianceChart } from '@/components/hcm/OvertimeBudgetVarianceChart';
import { StatutoryTaxComplianceReportModal } from '@/components/hcm/StatutoryTaxComplianceReportModal';
import { PayrollPeriod, Payslip } from '@/types/hcm';
import {
  EmployeeMaster,
  EmployeeCredential,
  ClinicalPrivilege,
  RosterShiftEntry,
  StaffingGapAnalysis,
  AttendanceRecord,
  LeaveRequest,
  EmployeeLeaveBalance,
  CompensationStructure,
  PerformanceReview,
  DisciplinaryRecord,
  EmployeeTrainingRecord,
  HospitalDepartment,
  PositionDefinition,
} from '@/types/hcm-advanced';
import { HrWorkforceDomainService } from '@/lib/backend/services/hr-workforce-domain-service';
import { useHospital } from '@/lib/context/hospital-context';
import { useRBAC } from '@/lib/auth/rbac-context';

export function HrManagementView() {
  const { staff } = useHospital();
  const { currentRole } = useRBAC();
  const [activeTab, setActiveTab] = useState<
    | 'directory'
    | 'structure'
    | 'credentials'
    | 'skills'
    | 'rostering'
    | 'attendance'
    | 'leave'
    | 'payroll'
    | 'performance'
    | 'overtime_analytics'
    | 'lead_tablet'
  >('directory');
  const [showStatutoryTaxModal, setShowStatutoryTaxModal] = useState(false);

  // Filters & State
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeMaster | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Modal States
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const [showVerifyCredentialModal, setShowVerifyCredentialModal] = useState(false);
  const [selectedCredentialToVerify, setSelectedCredentialToVerify] = useState<EmployeeCredential | null>(null);
  const [showLeaveRequestModal, setShowLeaveRequestModal] = useState(false);
  const [showAttendanceCorrectionModal, setShowAttendanceCorrectionModal] = useState(false);
  const [selectedAttendanceRecord, setSelectedAttendanceRecord] = useState<AttendanceRecord | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctedClockIn, setCorrectedClockIn] = useState('');

  // Sample Mock Data Initialization for Rich Interactive Experience
  const [departments] = useState<HospitalDepartment[]>([
    {
      departmentId: 'dept_cardiology',
      code: 'CARD-01',
      name: 'Cardiology & Catheterization',
      type: 'CLINICAL',
      facilityId: 'fac_central',
      managerEmployeeId: 'emp_001',
      managerName: 'Dr. Sarah Jenkins, MD',
      costCenterId: 'CC-401-CARD',
      status: 'ACTIVE',
      operatingHours: { is24Hours: true },
      headcountBudget: 45,
      currentHeadcount: 38,
    },
    {
      departmentId: 'dept_emergency',
      code: 'ER-TRAUMA',
      name: 'Emergency & Trauma Center',
      type: 'EMERGENCY',
      facilityId: 'fac_central',
      managerEmployeeId: 'emp_002',
      managerName: 'Dr. Michael Chang, MD',
      costCenterId: 'CC-102-ER',
      status: 'ACTIVE',
      operatingHours: { is24Hours: true },
      headcountBudget: 60,
      currentHeadcount: 54,
    },
    {
      departmentId: 'dept_surgery',
      code: 'OT-SURG',
      name: 'Surgical Theaters & Perioperative',
      type: 'SURGERY',
      facilityId: 'fac_central',
      managerEmployeeId: 'emp_003',
      managerName: 'Dr. Elena Rostova, MD',
      costCenterId: 'CC-503-OT',
      status: 'ACTIVE',
      operatingHours: { is24Hours: true },
      headcountBudget: 50,
      currentHeadcount: 48,
    },
    {
      departmentId: 'dept_laboratory',
      code: 'LAB-PATH',
      name: 'Pathology & Diagnostic Laboratory',
      type: 'LABORATORY',
      facilityId: 'fac_central',
      managerEmployeeId: 'emp_004',
      managerName: 'Dr. Alan Bradley, PhD',
      costCenterId: 'CC-302-LAB',
      status: 'ACTIVE',
      operatingHours: { is24Hours: true },
      headcountBudget: 30,
      currentHeadcount: 27,
    },
  ]);

  const [positions] = useState<PositionDefinition[]>([
    {
      positionId: 'pos_attending_cardio',
      title: 'Attending Cardiologist',
      departmentId: 'dept_cardiology',
      departmentName: 'Cardiology',
      jobCode: 'PHY-CARD-01',
      gradeLevel: 'L8-Specialist',
      requiredSkills: ['Interventional Angioplasty', 'Echocardiography', 'Advanced Cardiac Life Support'],
      requiredCredentials: ['MEDICAL_LICENSE', 'SPECIALTY_BOARD', 'BLS_ACLS'],
      requiredPrivileges: ['CONSULT_OPD', 'PRESCRIBE_MEDICATION', 'PERFORM_INVASIVE_PROCEDURES'],
      minimumExperienceYears: 8,
      salaryRange: { min: 280000, max: 390000, currency: 'USD' },
      status: 'ACTIVE',
    },
    {
      positionId: 'pos_trauma_nurse',
      title: 'Trauma ICU Charge Nurse',
      departmentId: 'dept_emergency',
      departmentName: 'Emergency',
      jobCode: 'NUR-ICU-04',
      gradeLevel: 'N5-Charge',
      requiredSkills: ['Critical Care Monitoring', 'Vasoactive Infusion Titration', 'Triage Assessment'],
      requiredCredentials: ['NURSING_BOARD', 'BLS_ACLS'],
      requiredPrivileges: ['SIGN_SOAP_CLINICAL_NOTE'],
      minimumExperienceYears: 5,
      salaryRange: { min: 95000, max: 130000, currency: 'USD' },
      status: 'ACTIVE',
    },
  ]);

  const [employees, setEmployees] = useState<EmployeeMaster[]>([
    {
      employeeId: 'emp_001',
      employeeNumber: 'EMP-2026-1041',
      tenantId: 'metro-health',
      facilityIds: ['fac_central'],
      primaryFacilityId: 'fac_central',
      departmentIds: ['dept_cardiology'],
      primaryDepartmentId: 'dept_cardiology',
      primaryDepartmentName: 'Cardiology & Catheterization',
      positionId: 'pos_attending_cardio',
      positionTitle: 'Attending Cardiologist',
      employmentType: 'FULL_TIME',
      employmentStatus: 'ACTIVE',
      hireDate: '2021-03-15',
      managerId: 'emp_chief_medical',
      managerName: 'Dr. Robert Vance, MD',
      personalInfo: {
        legalFirstName: 'Sarah',
        legalLastName: 'Jenkins',
        preferredName: 'Dr. Sarah',
        dateOfBirth: '1982-06-14',
        gender: 'FEMALE',
        contactEmail: 'sarah.jenkins@metrohealth.org',
        contactPhone: '+1 (555) 234-5678',
        emergencyContact: {
          name: 'David Jenkins',
          relationship: 'Spouse',
          phone: '+1 (555) 234-5679',
        },
        residentialAddress: {
          street: '742 Evergreen Terrace',
          city: 'Metro City',
          state: 'NY',
          postalCode: '10001',
          country: 'USA',
        },
      },
      specialty: 'Interventional Cardiology',
      createdAt: '2021-03-15T08:00:00Z',
      updatedAt: '2026-02-15T10:00:00Z',
      schemaVersion: 1,
    },
    {
      employeeId: 'emp_002',
      employeeNumber: 'EMP-2026-1088',
      tenantId: 'metro-health',
      facilityIds: ['fac_central'],
      primaryFacilityId: 'fac_central',
      departmentIds: ['dept_emergency'],
      primaryDepartmentId: 'dept_emergency',
      primaryDepartmentName: 'Emergency & Trauma Center',
      positionId: 'pos_er_physician',
      positionTitle: 'Attending Emergency Physician',
      employmentType: 'FULL_TIME',
      employmentStatus: 'ACTIVE',
      hireDate: '2022-08-01',
      personalInfo: {
        legalFirstName: 'Michael',
        legalLastName: 'Chang',
        dateOfBirth: '1985-11-20',
        gender: 'MALE',
        contactEmail: 'michael.chang@metrohealth.org',
        contactPhone: '+1 (555) 456-7890',
        emergencyContact: {
          name: 'Linda Chang',
          relationship: 'Sister',
          phone: '+1 (555) 456-7899',
        },
        residentialAddress: {
          street: '124 Concord Way',
          city: 'Metro City',
          state: 'NY',
          postalCode: '10002',
          country: 'USA',
        },
      },
      specialty: 'Emergency Medicine & Toxicology',
      createdAt: '2022-08-01T08:00:00Z',
      updatedAt: '2026-01-10T12:00:00Z',
      schemaVersion: 1,
    },
    {
      employeeId: 'emp_003',
      employeeNumber: 'EMP-2026-2104',
      tenantId: 'metro-health',
      facilityIds: ['fac_central'],
      primaryFacilityId: 'fac_central',
      departmentIds: ['dept_surgery'],
      primaryDepartmentId: 'dept_surgery',
      primaryDepartmentName: 'Surgical Theaters & Perioperative',
      positionId: 'pos_surgeon',
      positionTitle: 'Chief of Cardiothoracic Surgery',
      employmentType: 'FULL_TIME',
      employmentStatus: 'ACTIVE',
      hireDate: '2019-01-10',
      personalInfo: {
        legalFirstName: 'Elena',
        legalLastName: 'Rostova',
        dateOfBirth: '1978-04-03',
        gender: 'FEMALE',
        contactEmail: 'elena.rostova@metrohealth.org',
        contactPhone: '+1 (555) 789-0123',
        emergencyContact: {
          name: 'Pavel Rostov',
          relationship: 'Brother',
          phone: '+1 (555) 789-0124',
        },
        residentialAddress: {
          street: '88 Lexington Blvd',
          city: 'Metro City',
          state: 'NY',
          postalCode: '10003',
          country: 'USA',
        },
      },
      specialty: 'Cardiothoracic Surgery',
      createdAt: '2019-01-10T08:00:00Z',
      updatedAt: '2026-03-01T09:00:00Z',
      schemaVersion: 1,
    },
    {
      employeeId: 'emp_004',
      employeeNumber: 'EMP-2026-3042',
      tenantId: 'metro-health',
      facilityIds: ['fac_central'],
      primaryFacilityId: 'fac_central',
      departmentIds: ['dept_cardiology'],
      primaryDepartmentId: 'dept_cardiology',
      primaryDepartmentName: 'Cardiology & Catheterization',
      positionId: 'pos_trauma_nurse',
      positionTitle: 'Cardiac Care Staff Nurse',
      employmentType: 'FULL_TIME',
      employmentStatus: 'ONBOARDING',
      hireDate: '2026-02-01',
      personalInfo: {
        legalFirstName: 'Marcus',
        legalLastName: 'Vance',
        dateOfBirth: '1992-09-15',
        gender: 'MALE',
        contactEmail: 'marcus.vance@metrohealth.org',
        contactPhone: '+1 (555) 345-6789',
        emergencyContact: {
          name: 'Emily Vance',
          relationship: 'Spouse',
          phone: '+1 (555) 345-6780',
        },
        residentialAddress: {
          street: '55 Pine Ridge Rd',
          city: 'Metro City',
          state: 'NY',
          postalCode: '10004',
          country: 'USA',
        },
      },
      specialty: 'Critical Care Nursing',
      onboardingStage: 'CREDENTIAL_VERIFICATION',
      createdAt: '2026-02-01T08:00:00Z',
      updatedAt: '2026-02-28T14:00:00Z',
      schemaVersion: 1,
    },
  ]);

  const [credentials, setCredentials] = useState<EmployeeCredential[]>([
    {
      credentialId: 'crd_001',
      employeeId: 'emp_001',
      employeeName: 'Dr. Sarah Jenkins, MD',
      credentialType: 'MEDICAL_LICENSE',
      title: 'State Medical Board License (MD)',
      issuingAuthority: 'New York State Board of Medicine',
      credentialNumber: 'NY-MD-849201',
      issueDate: '2015-05-20',
      expiryDate: '2027-05-20',
      verificationStatus: 'VERIFIED',
      verifiedByActorId: 'usr_med_director',
      verifiedByName: 'Medical Board Committee',
      verifiedAt: '2025-05-18T10:00:00Z',
      isMandatoryForPractice: true,
      createdAt: '2025-05-18T10:00:00Z',
      updatedAt: '2025-05-18T10:00:00Z',
    },
    {
      credentialId: 'crd_002',
      employeeId: 'emp_001',
      employeeName: 'Dr. Sarah Jenkins, MD',
      credentialType: 'SPECIALTY_BOARD',
      title: 'American Board of Internal Medicine (Cardiovascular Disease)',
      issuingAuthority: 'ABIM',
      credentialNumber: 'ABIM-CARD-4920',
      issueDate: '2017-09-10',
      expiryDate: '2027-09-10',
      verificationStatus: 'VERIFIED',
      isMandatoryForPractice: true,
      createdAt: '2025-09-01T08:00:00Z',
      updatedAt: '2025-09-01T08:00:00Z',
    },
    {
      credentialId: 'crd_003',
      employeeId: 'emp_002',
      employeeName: 'Dr. Michael Chang, MD',
      credentialType: 'BLS_ACLS',
      title: 'Advanced Cardiac Life Support (ACLS)',
      issuingAuthority: 'American Heart Association',
      credentialNumber: 'AHA-ACLS-9018',
      issueDate: '2024-04-10',
      expiryDate: '2026-04-10', // Expiring soon (< 60 days)
      verificationStatus: 'VERIFIED',
      isMandatoryForPractice: true,
      createdAt: '2024-04-10T08:00:00Z',
      updatedAt: '2024-04-10T08:00:00Z',
    },
    {
      credentialId: 'crd_004',
      employeeId: 'emp_004',
      employeeName: 'Marcus Vance, RN',
      credentialType: 'NURSING_BOARD',
      title: 'Registered Professional Nurse (RN)',
      issuingAuthority: 'State Board of Nursing',
      credentialNumber: 'RN-NY-58201',
      issueDate: '2023-01-15',
      expiryDate: '2027-01-15',
      verificationStatus: 'UNDER_REVIEW',
      isMandatoryForPractice: true,
      createdAt: '2026-02-05T08:00:00Z',
      updatedAt: '2026-02-05T08:00:00Z',
    },
  ]);

  const [privileges] = useState<ClinicalPrivilege[]>([
    {
      privilegeId: 'prv_001',
      employeeId: 'emp_001',
      employeeName: 'Dr. Sarah Jenkins, MD',
      privilegeType: 'CONSULT_OPD',
      specialty: 'Cardiology',
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      departmentId: 'dept_cardiology',
      departmentName: 'Cardiology',
      effectiveFrom: '2025-01-01',
      effectiveUntil: '2027-01-01',
      status: 'GRANTED',
      grantedByActorId: 'usr_med_director',
      grantedByName: 'Credentialing Board',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    {
      privilegeId: 'prv_002',
      employeeId: 'emp_001',
      employeeName: 'Dr. Sarah Jenkins, MD',
      privilegeType: 'PERFORM_INVASIVE_PROCEDURES',
      specialty: 'Cardiology',
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      departmentId: 'dept_cardiology',
      departmentName: 'Cardiology',
      effectiveFrom: '2025-01-01',
      effectiveUntil: '2027-01-01',
      status: 'GRANTED',
      grantedByActorId: 'usr_med_director',
      grantedByName: 'Credentialing Board',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    {
      privilegeId: 'prv_003',
      employeeId: 'emp_003',
      employeeName: 'Dr. Elena Rostova, MD',
      privilegeType: 'PERFORM_CARDIOTHORACIC_SURGERY',
      specialty: 'Cardiothoracic Surgery',
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      departmentId: 'dept_surgery',
      departmentName: 'Surgical Theaters',
      effectiveFrom: '2024-01-01',
      effectiveUntil: '2026-12-31',
      status: 'GRANTED',
      grantedByActorId: 'usr_med_director',
      grantedByName: 'Credentialing Board',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ]);

  const [shifts, setShifts] = useState<RosterShiftEntry[]>([
    {
      rosterId: 'rst_001',
      tenantId: 'metro-health',
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      departmentId: 'dept_cardiology',
      departmentName: 'Cardiology & Catheterization',
      employeeId: 'emp_001',
      employeeName: 'Dr. Sarah Jenkins, MD',
      positionTitle: 'Attending Cardiologist',
      date: new Date().toISOString().split('T')[0],
      shiftId: 'M-0715',
      shiftName: 'Morning Ward & Catheterization',
      startTime: `${new Date().toISOString().split('T')[0]}T07:00:00Z`,
      endTime: `${new Date().toISOString().split('T')[0]}T15:30:00Z`,
      durationHours: 8.5,
      status: 'IN_PROGRESS',
      isOvertime: false,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
    {
      rosterId: 'rst_002',
      tenantId: 'metro-health',
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      departmentId: 'dept_emergency',
      departmentName: 'Emergency & Trauma Center',
      employeeId: 'emp_002',
      employeeName: 'Dr. Michael Chang, MD',
      positionTitle: 'Attending ER Physician',
      date: new Date().toISOString().split('T')[0],
      shiftId: 'E-1523',
      shiftName: 'Evening Trauma Surge',
      startTime: `${new Date().toISOString().split('T')[0]}T15:00:00Z`,
      endTime: `${new Date().toISOString().split('T')[0]}T23:30:00Z`,
      durationHours: 8.5,
      status: 'PUBLISHED',
      isOvertime: false,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ]);

  const [attendances, setAttendances] = useState<AttendanceRecord[]>([
    {
      attendanceId: 'att_001',
      tenantId: 'metro-health',
      employeeId: 'emp_001',
      employeeName: 'Dr. Sarah Jenkins, MD',
      facilityId: 'fac_central',
      departmentId: 'dept_cardiology',
      date: new Date().toISOString().split('T')[0],
      clockInTime: `${new Date().toISOString().split('T')[0]}T06:55:00Z`,
      totalHoursWorked: 5.2,
      overtimeHours: 0,
      overtimeApproved: false,
      source: 'BIOMETRIC_SCANNER',
      deviceIdentifier: 'BIO-CARD-FL4-01',
      status: 'ON_TIME',
      isCorrected: false,
      createdAt: `${new Date().toISOString().split('T')[0]}T06:55:00Z`,
      updatedAt: `${new Date().toISOString().split('T')[0]}T06:55:00Z`,
    },
  ]);

  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([
    {
      leaveId: 'lve_001',
      tenantId: 'metro-health',
      employeeId: 'emp_002',
      employeeName: 'Dr. Michael Chang, MD',
      departmentId: 'dept_emergency',
      departmentName: 'Emergency & Trauma Center',
      leaveType: 'STUDY_CME',
      startDate: '2026-03-20',
      endDate: '2026-03-24',
      totalDays: 5,
      reason: 'Attending American College of Emergency Physicians (ACEP) Annual Symposium',
      status: 'SUBMITTED',
      coveringEmployeeId: 'emp_001',
      coveringEmployeeName: 'Dr. Sarah Jenkins, MD',
      createdAt: '2026-03-01T09:00:00Z',
      updatedAt: '2026-03-01T09:00:00Z',
    },
  ]);

  const [trainings] = useState<EmployeeTrainingRecord[]>([
    {
      trainingId: 'trn_001',
      employeeId: 'emp_001',
      employeeName: 'Dr. Sarah Jenkins, MD',
      courseId: 'crs_inf_01',
      courseTitle: 'Hospital Infection Control & Airborne Pathogen Safety',
      completionDate: '2025-06-10',
      expiryDate: '2026-06-10',
      scorePercentage: 98,
      trainerName: 'CDC Certified Training Team',
      complianceStatus: 'COMPLIANT',
      createdAt: '2025-06-10T00:00:00Z',
    },
    {
      trainingId: 'trn_002',
      employeeId: 'emp_002',
      employeeName: 'Dr. Michael Chang, MD',
      courseId: 'crs_hipaa_02',
      courseTitle: 'HIPAA & Protected Health Information (PHI) Security 2026',
      completionDate: '2025-02-14',
      expiryDate: '2026-02-14', // Expired!
      scorePercentage: 95,
      trainerName: 'Information Governance Board',
      complianceStatus: 'NON_COMPLIANT',
      createdAt: '2025-02-14T00:00:00Z',
    },
  ]);

  // Executive KPI Aggregations
  const totalEmployees = employees.length;
  const activeEmployees = employees.filter((e) => e.employmentStatus === 'ACTIVE').length;
  const onboardingCount = employees.filter((e) => e.employmentStatus === 'ONBOARDING').length;
  const pendingLeaves = leaveRequests.filter((l) => l.status === 'SUBMITTED').length;
  const unverifiedCreds = credentials.filter((c) => c.verificationStatus === 'UNDER_REVIEW').length;
  const expiringCreds = credentials.filter((c) => {
    const today = new Date();
    const expiry = new Date(c.expiryDate);
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 3600 * 24));
    return diffDays > 0 && diffDays <= 60;
  }).length;

  // Handlers for interactive workflows
  const handleVerifyCredential = async (approved: boolean) => {
    if (!selectedCredentialToVerify) return;

    try {
      const result = await HrWorkforceDomainService.verifyCredential(
        {
          actorId: 'usr_med_director',
          tenantId: 'metro-health',
          roles: ['MEDICAL_DIRECTOR'],
          permissions: ['VERIFY_CREDENTIALS'],
          correlationId: `cor_${Date.now()}`,
          requestId: `req_${Date.now()}`,
        },
        `cmd_${Date.now()}`,
        `idemp_${Date.now()}`,
        {
          credentialId: selectedCredentialToVerify.credentialId,
          status: approved ? 'VERIFIED' : 'REJECTED',
          notes: approved ? 'Verified via primary source check' : 'License document illegible or unverified',
        }
      );

      if (result.success) {
        setCredentials((prev) =>
          prev.map((c) =>
            c.credentialId === selectedCredentialToVerify.credentialId
              ? { ...c, verificationStatus: approved ? 'VERIFIED' : 'REJECTED' }
              : c
          )
        );
        setActionMessage({
          text: `Credential ${selectedCredentialToVerify.title} was ${approved ? 'VERIFIED' : 'REJECTED'} successfully!`,
          type: 'success',
        });
      } else {
        setActionMessage({ text: result.error?.message || 'Verification failed', type: 'error' });
      }
    } catch (e: any) {
      setActionMessage({ text: e.message || 'Operation failed', type: 'error' });
    } finally {
      setShowVerifyCredentialModal(false);
      setSelectedCredentialToVerify(null);
    }
  };

  const handleApproveLeave = async (leaveId: string, approved: boolean) => {
    try {
      const result = await HrWorkforceDomainService.approveLeaveRequest(
        {
          actorId: 'usr_hr_admin',
          tenantId: 'metro-health',
          roles: ['HR_ADMIN'],
          permissions: ['APPROVE_LEAVE'],
          correlationId: `cor_${Date.now()}`,
          requestId: `req_${Date.now()}`,
        },
        `cmd_${Date.now()}`,
        `idemp_${Date.now()}`,
        {
          leaveId,
          approved,
          rejectionReason: approved ? undefined : 'Department staffing coverage requirement cannot be met.',
        }
      );

      if (result.success) {
        setLeaveRequests((prev) =>
          prev.map((l) => (l.leaveId === leaveId ? { ...l, status: approved ? 'APPROVED' : 'REJECTED' } : l))
        );
        setActionMessage({
          text: `Leave request ${approved ? 'APPROVED' : 'REJECTED'} successfully!`,
          type: 'success',
        });
      } else {
        setActionMessage({ text: result.error?.message || 'Leave decision failed', type: 'error' });
      }
    } catch (e: any) {
      setActionMessage({ text: e.message || 'Operation failed', type: 'error' });
    }
  };

  const handleCorrectAttendance = async () => {
    if (!selectedAttendanceRecord || !correctedClockIn || !correctionReason) return;

    try {
      const result = await HrWorkforceDomainService.correctAttendanceTime(
        {
          actorId: 'usr_supervisor',
          tenantId: 'metro-health',
          roles: ['HR_ADMIN', 'SUPERVISOR'],
          permissions: ['CORRECT_TIME'],
          correlationId: `cor_${Date.now()}`,
          requestId: `req_${Date.now()}`,
        },
        `cmd_${Date.now()}`,
        `idemp_${Date.now()}`,
        {
          attendanceId: selectedAttendanceRecord.attendanceId,
          newClockInTime: correctedClockIn,
          reason: correctionReason,
        }
      );

      if (result.success) {
        setAttendances((prev) =>
          prev.map((a) =>
            a.attendanceId === selectedAttendanceRecord.attendanceId
              ? {
                  ...a,
                  clockInTime: correctedClockIn,
                  isCorrected: true,
                  status: 'CORRECTED',
                }
              : a
          )
        );
        setActionMessage({
          text: `Attendance record corrected with immutable audit trail.`,
          type: 'success',
        });
      } else {
        setActionMessage({ text: result.error?.message || 'Correction failed', type: 'error' });
      }
    } catch (e: any) {
      setActionMessage({ text: e.message || 'Operation failed', type: 'error' });
    } finally {
      setShowAttendanceCorrectionModal(false);
      setSelectedAttendanceRecord(null);
      setCorrectionReason('');
      setCorrectedClockIn('');
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner & Title */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
                Hospital Workforce & HR Operating System
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Credential-gated clinical privileges, fatigue-aware rostering, biometric attendance, and ERP payroll integration.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Tools */}
        <div className="flex items-center gap-2">
          <button
            id="btn-switch-tablet-lead-mode"
            onClick={() => setActiveTab('lead_tablet')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'lead_tablet'
                ? 'bg-indigo-600 text-white'
                : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900'
            }`}
          >
            <Tablet className="w-4 h-4" />
            <span>Lead Tablet Cockpit</span>
          </button>

          <button
            id="btn-add-employee-trigger"
            onClick={() => setShowAddEmployeeModal(true)}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Onboard Employee</span>
          </button>
        </div>
      </div>

      {/* Action Notification Alert */}
      {actionMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-medium ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-slate-400 hover:text-slate-700 text-sm font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* Real-time Workforce KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Total Headcount</span>
            <Users className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-slate-100">{totalEmployees}</div>
          <span className="text-[10px] text-emerald-600 font-medium">100% Verified Org</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Active On Duty</span>
            <Activity className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-xl font-black text-emerald-600">{activeEmployees}</div>
          <span className="text-[10px] text-slate-400 font-medium">Across 4 Departments</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Onboarding Queue</span>
            <Briefcase className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-xl font-black text-amber-600">{onboardingCount}</div>
          <span className="text-[10px] text-amber-700 font-medium">Awaiting Credentials</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Expiring Licenses</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
          </div>
          <div className="text-xl font-black text-rose-600">{expiringCreds}</div>
          <span className="text-[10px] text-rose-600 font-medium">&lt; 60 Days Notice</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Pending Leaves</span>
            <Calendar className="w-3.5 h-3.5 text-purple-500" />
          </div>
          <div className="text-xl font-black text-purple-600">{pendingLeaves}</div>
          <span className="text-[10px] text-purple-700 font-medium">Requires Approval</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Staffing Coverage</span>
            <TrendingUp className="w-3.5 h-3.5 text-teal-500" />
          </div>
          <div className="text-xl font-black text-teal-600">96.4%</div>
          <span className="text-[10px] text-teal-700 font-medium">Fatigue-Compliant</span>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto no-scrollbar">
        {[
          { id: 'lead_tablet', label: 'Lead Tablet Cockpit', icon: Tablet },
          { id: 'directory', label: 'Staff Directory', icon: Users },
          { id: 'structure', label: 'Org Hierarchy & Positions', icon: Building2 },
          { id: 'credentials', label: 'Credentials & Privileges', icon: ShieldCheck, badge: unverifiedCreds },
          { id: 'skills', label: 'Skills & Mandatory Training', icon: Award },
          { id: 'rostering', label: 'Rostering & Gap Engine', icon: Calendar },
          { id: 'attendance', label: 'Attendance & Time Clock', icon: Clock },
          { id: 'leave', label: 'Leave Management', icon: CheckSquare, badge: pendingLeaves },
          { id: 'payroll', label: 'Compensation & Payroll Bridge', icon: DollarSign },
          { id: 'overtime_analytics', label: 'Overtime & Budget Variances', icon: TrendingUp },
          { id: 'performance', label: 'Performance & Compliance', icon: FileCheck },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* MEDICAL DEPARTMENT LEAD TABLET COCKPIT */}
      {/* ========================================================================= */}
      {activeTab === 'lead_tablet' && (
        <TabletLeadDashboard
          departments={departments}
          employees={employees}
          credentials={credentials}
          onSelectEmployee={(emp) => setSelectedEmployee(emp)}
          onVerifyCredential={(cred) => {
            setSelectedCredentialToVerify(cred);
            setShowVerifyCredentialModal(true);
          }}
          onTriggerNotification={(msg) => setActionMessage({ text: msg, type: 'info' })}
        />
      )}

      {/* ========================================================================= */}
      {/* OVERTIME BUDGET VARIANCE & CLINICAL UNIT TRENDS */}
      {/* ========================================================================= */}
      {activeTab === 'overtime_analytics' && (
        <div className="space-y-6">
          <OvertimeBudgetVarianceChart
            onNotifyLead={(msg) => setActionMessage({ text: msg, type: 'info' })}
          />
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: STAFF DIRECTORY & EMPLOYEE MASTER */}
      {/* ========================================================================= */}
      {activeTab === 'directory' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative w-full">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name, role, employee ID, specialty..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                <option value="All">All Departments</option>
                {departments.map((d) => (
                  <option key={d.departmentId} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                <option value="All">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="ONBOARDING">Onboarding</option>
                <option value="ON_LEAVE">On Leave</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>
          </div>

          {/* Employee Directory Table */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Department & Position</th>
                    <th className="px-4 py-3">Employment</th>
                    <th className="px-4 py-3">Clinical License</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {employees
                    .filter((emp) => {
                      const matchesSearch =
                        emp.personalInfo.legalFirstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        emp.personalInfo.legalLastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        emp.employeeNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        emp.positionTitle.toLowerCase().includes(searchQuery.toLowerCase());
                      const matchesDept =
                        departmentFilter === 'All' || emp.primaryDepartmentName.includes(departmentFilter);
                      const matchesStatus = statusFilter === 'All' || emp.employmentStatus === statusFilter;
                      return matchesSearch && matchesDept && matchesStatus;
                    })
                    .map((emp) => {
                      const empCreds = credentials.filter((c) => c.employeeId === emp.employeeId);
                      const allVerified = empCreds.length > 0 && empCreds.every((c) => c.verificationStatus === 'VERIFIED');

                      return (
                        <tr key={emp.employeeId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-bold flex items-center justify-center text-xs">
                                {emp.personalInfo.legalFirstName[0]}
                                {emp.personalInfo.legalLastName[0]}
                              </div>
                              <div>
                                <span className="font-bold text-slate-900 dark:text-slate-100 block">
                                  {emp.personalInfo.legalFirstName} {emp.personalInfo.legalLastName}
                                </span>
                                <span className="font-mono text-[10px] text-slate-400">{emp.employeeNumber}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium text-slate-800 dark:text-slate-200 block">{emp.positionTitle}</span>
                            <span className="text-[11px] text-slate-500">{emp.primaryDepartmentName}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              {emp.employmentType.replace('_', ' ')}
                            </span>
                            <span className="text-[10px] text-slate-400 block mt-0.5">Hired {emp.hireDate}</span>
                          </td>
                          <td className="px-4 py-3">
                            {allVerified ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <ShieldCheck className="w-3 h-3" /> VERIFIED
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                <ShieldAlert className="w-3 h-3" /> PENDING REVIEW
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                emp.employmentStatus === 'ACTIVE'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : emp.employmentStatus === 'ONBOARDING'
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {emp.employmentStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => setSelectedEmployee(emp)}
                              className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                            >
                              View Dossier
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: ORGANIZATIONAL STRUCTURE & POSITIONS */}
      {/* ========================================================================= */}
      {activeTab === 'structure' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Departments Directory */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-600" /> Hospital Departments & Cost Centers
              </h2>
              <span className="text-xs text-slate-500">{departments.length} Units Configured</span>
            </div>

            <div className="space-y-3">
              {departments.map((dept) => (
                <div key={dept.departmentId} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{dept.name}</span>
                      <span className="font-mono text-[10px] text-blue-600 block">{dept.code} • {dept.costCenterId}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {dept.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-500">
                    <div>
                      <span className="block text-[10px] text-slate-400">Head of Dept</span>
                      <strong className="text-slate-800 dark:text-slate-200">{dept.managerName}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Headcount</span>
                      <strong className="text-slate-800 dark:text-slate-200">{dept.currentHeadcount} / {dept.headcountBudget}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Hours</span>
                      <strong className="text-slate-800 dark:text-slate-200">{dept.operatingHours.is24Hours ? '24/7 Continuous' : '08:00 - 20:00'}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Job Positions & Required Privileges */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-purple-600" /> Position Specifications & Prerequisite Privileges
              </h2>
              <span className="text-xs text-slate-500">{positions.length} Job Profiles</span>
            </div>

            <div className="space-y-3">
              {positions.map((pos) => (
                <div key={pos.positionId} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{pos.title}</span>
                      <span className="text-[11px] text-purple-600 font-medium block">{pos.gradeLevel} • {pos.jobCode}</span>
                    </div>
                    <span className="text-xs font-black text-slate-900 dark:text-slate-100">
                      ${(pos.salaryRange.min / 1000).toFixed(0)}k - ${(pos.salaryRange.max / 1000).toFixed(0)}k
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                      Required Clinical Privileges
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {pos.requiredPrivileges.map((prv) => (
                        <span key={prv} className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-50 text-purple-700 border border-purple-200">
                          {prv}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                      Required Medical Licenses
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {pos.requiredCredentials.map((crd) => (
                        <span key={crd} className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-200">
                          {crd}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: CREDENTIALS & CLINICAL PRIVILEGES (With Lockout Engine) */}
      {/* ========================================================================= */}
      {activeTab === 'credentials' && (
        <div className="space-y-5">
          {/* Practice Lockout Security Guard Banner */}
          <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex items-start gap-3 text-amber-800 dark:text-amber-300 text-xs">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold block text-sm">Automated Clinical Practice Lockout Active</strong>
              <span>
                Under G-HIMS Master Safety Protocol §95, practitioners with expired, revoked, or unverified medical licenses are automatically blocked from signing SOAP encounter notes, prescribing controlled drugs, or performing surgical operations.
              </span>
            </div>
          </div>

          {/* Credentials Master Table */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600" /> Active Medical Licenses & Credential Verification Registry
              </h2>
              <span className="text-xs text-slate-500">{credentials.length} Licenses Tracked</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Practitioner</th>
                    <th className="px-4 py-3">Credential Title & Number</th>
                    <th className="px-4 py-3">Issuing Authority</th>
                    <th className="px-4 py-3">Expiration Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {credentials.map((cred) => {
                    const isExpiring = new Date(cred.expiryDate).getTime() - Date.now() < 60 * 24 * 3600 * 1000;
                    return (
                      <tr key={cred.credentialId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-bold text-slate-900 dark:text-slate-100">
                          {cred.employeeName}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-800 dark:text-slate-200 block">{cred.title}</span>
                          <span className="font-mono text-[10px] text-blue-600">{cred.credentialNumber}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{cred.issuingAuthority}</td>
                        <td className="px-4 py-3">
                          <span className={`font-medium ${isExpiring ? 'text-rose-600 font-bold' : 'text-slate-700'}`}>
                            {cred.expiryDate}
                          </span>
                          {isExpiring && <span className="block text-[9px] text-rose-500">Expiring soon!</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              cred.verificationStatus === 'VERIFIED'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : cred.verificationStatus === 'UNDER_REVIEW'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {cred.verificationStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {cred.verificationStatus === 'UNDER_REVIEW' ? (
                            <button
                              onClick={() => {
                                setSelectedCredentialToVerify(cred);
                                setShowVerifyCredentialModal(true);
                              }}
                              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              Verify License
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400">Verified by Medical Board</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: SKILLS & MANDATORY TRAINING COMPLIANCE */}
      {/* ========================================================================= */}
      {activeTab === 'skills' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
            <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3">
              <Award className="w-4 h-4 text-emerald-600" /> Mandatory Clinical Training & OSHA/HIPAA Compliance Tracker
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {trainings.map((t) => (
                <div key={t.trainingId} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">{t.courseTitle}</h3>
                      <span className="text-[11px] text-slate-500 font-medium block">Staff: {t.employeeName}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        t.complianceStatus === 'COMPLIANT'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {t.complianceStatus}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-500">
                    <div>
                      <span className="block text-[10px] text-slate-400">Score</span>
                      <strong className="text-slate-800 dark:text-slate-200">{t.scorePercentage}%</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Completed</span>
                      <strong className="text-slate-800 dark:text-slate-200">{t.completionDate}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Expiry</span>
                      <strong className={t.complianceStatus === 'NON_COMPLIANT' ? 'text-rose-600 font-bold' : 'text-slate-800 dark:text-slate-200'}>
                        {t.expiryDate}
                      </strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: ROSTERING & GAP DETECTION ENGINE */}
      {/* ========================================================================= */}
      {activeTab === 'rostering' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" /> Active Shift Roster & Fatigue Compliance Validator
              </h2>
              <span className="text-xs text-slate-500">Enforcing 10h Mandatory Rest Period</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-2.5">Staff Member</th>
                    <th className="px-4 py-2.5">Department</th>
                    <th className="px-4 py-2.5">Shift Name</th>
                    <th className="px-4 py-2.5">Hours</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {shifts.map((s) => (
                    <tr key={s.rosterId}>
                      <td className="px-4 py-3 font-bold text-slate-900 dark:text-slate-100">{s.employeeName}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{s.departmentName}</td>
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{s.shiftName}</td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-[11px]">
                        {s.startTime.split('T')[1].substring(0, 5)} - {s.endTime.split('T')[1].substring(0, 5)} ({s.durationHours}h)
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: ATTENDANCE & TIME CLOCK (Immutable + Corrections) */}
      {/* ========================================================================= */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" /> Biometric & Kiosk Live Attendance Stream
              </h2>
              <span className="text-xs text-slate-500">Immutable Audit Logs Enabled</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-2.5">Staff Member</th>
                    <th className="px-4 py-2.5">Department</th>
                    <th className="px-4 py-2.5">Clock In</th>
                    <th className="px-4 py-2.5">Source Device</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Supervisor Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {attendances.map((att) => (
                    <tr key={att.attendanceId}>
                      <td className="px-4 py-3 font-bold text-slate-900 dark:text-slate-100">{att.employeeName}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{att.departmentId}</td>
                      <td className="px-4 py-3 font-mono text-slate-800 dark:text-slate-200">
                        {att.clockInTime.split('T')[1].substring(0, 8)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-slate-500">{att.source}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            att.isCorrected
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {att.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            setSelectedAttendanceRecord(att);
                            setCorrectedClockIn(att.clockInTime);
                            setShowAttendanceCorrectionModal(true);
                          }}
                          className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                        >
                          Audit / Correct
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 7: LEAVE MANAGEMENT & BALANCES */}
      {/* ========================================================================= */}
      {activeTab === 'leave' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-purple-600" /> Pending Leave Requests & Coverage Approvals
              </h2>
              <button
                onClick={() => setShowLeaveRequestModal(true)}
                className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold cursor-pointer"
              >
                + Request Leave
              </button>
            </div>

            <div className="space-y-3">
              {leaveRequests.map((l) => (
                <div key={l.leaveId} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">{l.employeeName}</h3>
                      <span className="text-[11px] text-purple-600 font-medium">{l.leaveType} Leave ({l.totalDays} Days)</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        l.status === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : l.status === 'REJECTED'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {l.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300">{l.reason}</p>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                    <span>
                      Duration: <strong className="text-slate-800 dark:text-slate-200">{l.startDate} to {l.endDate}</strong>
                    </span>
                    {l.status === 'SUBMITTED' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApproveLeave(l.leaveId, true)}
                          className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleApproveLeave(l.leaveId, false)}
                          className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 8: COMPENSATION & ERP PAYROLL BRIDGE */}
      {/* ========================================================================= */}
      {activeTab === 'payroll' && (
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-600" /> ERP General Ledger & Payroll Bridge
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Exports verified attendance hours, approved on-call allowances, and tax withholdings directly into General Ledger journal lines.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="btn-open-statutory-tax-compliance"
                onClick={() => setShowStatutoryTaxModal(true)}
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Statutory Tax & 941 Report</span>
              </button>

              <button
                onClick={() => {
                  setActionMessage({
                    text: 'Exported 4 verified employee payroll lines to SAP/ERP General Ledger (Account: 5100-SALARY-EXPENSE).',
                    type: 'success',
                  });
                }}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Post to ERP Ledger</span>
              </button>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
              Bi-Weekly Period Summary (March 01 - March 15, 2026)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-slate-400 text-[10px] block">Gross Salary Total</span>
                <strong className="text-slate-900 dark:text-slate-100 font-mono text-sm">$48,450.00</strong>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">Overtime Pay</span>
                <strong className="text-emerald-600 font-mono text-sm">$3,120.00</strong>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">Statutory Withholdings</span>
                <strong className="text-rose-600 font-mono text-sm">-$12,890.00</strong>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">Net Payroll Disbursement</span>
                <strong className="text-blue-600 font-mono text-sm">$38,680.00</strong>
              </div>
            </div>
          </div>

          {/* Overtime Pay Trends & Clinical Unit Variances embedded in Payroll */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <OvertimeBudgetVarianceChart
              onNotifyLead={(msg) => setActionMessage({ text: msg, type: 'info' })}
            />
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 9: PERFORMANCE & COMPLIANCE */}
      {/* ========================================================================= */}
      {activeTab === 'performance' && (
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-blue-600" /> Annual Clinical Competency Reviews & Disciplinary Records
            </h2>
            <span className="text-xs text-slate-500">Restricted RBAC Access</span>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Dr. Sarah Jenkins, MD (Cardiology)</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                SCORE: 4.9 / 5.0 (EXCEEDS EXPECTATIONS)
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Outstanding catheterization survival rate (99.8%), superior bedside manner evaluations, zero protocol deviations.
            </p>
          </div>
        </div>
      )}

      {/* Modal: Verify Credential */}
      {showVerifyCredentialModal && selectedCredentialToVerify && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" /> Medical Credential Primary Source Verification
            </h3>
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
              <p>
                <strong>Practitioner:</strong> {selectedCredentialToVerify.employeeName}
              </p>
              <p>
                <strong>License Title:</strong> {selectedCredentialToVerify.title}
              </p>
              <p>
                <strong>Authority:</strong> {selectedCredentialToVerify.issuingAuthority}
              </p>
              <p>
                <strong>License Number:</strong> {selectedCredentialToVerify.credentialNumber}
              </p>
              <p>
                <strong>Expiration Date:</strong> {selectedCredentialToVerify.expiryDate}
              </p>
            </div>

            <p className="text-[11px] text-slate-500">
              By confirming verification, you attest as Medical Director that primary source state licensing databases have validated this credential.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setShowVerifyCredentialModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => handleVerifyCredential(false)}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                Reject License
              </button>
              <button
                onClick={() => handleVerifyCredential(true)}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs"
              >
                Verify & Grant Authority
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Attendance Correction */}
      {showAttendanceCorrectionModal && selectedAttendanceRecord && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Clock className="w-5 h-5 text-purple-600" /> Immutable Attendance Record Correction
            </h3>

            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
              <p>
                <strong>Employee:</strong> {selectedAttendanceRecord.employeeName}
              </p>
              <p>
                <strong>Recorded Clock-In:</strong> {selectedAttendanceRecord.clockInTime}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                Corrected Clock-In Time (ISO or HH:MM)
              </label>
              <input
                type="text"
                value={correctedClockIn}
                onChange={(e) => setCorrectedClockIn(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                Mandatory Correction Reason
              </label>
              <textarea
                rows={2}
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="e.g. Biometric scanner offline during emergency trauma intake"
                className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setShowAttendanceCorrectionModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleCorrectAttendance}
                disabled={!correctionReason || !correctedClockIn}
                className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold"
              >
                Commit Correction & Audit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Employee Onboarding */}
      {showAddEmployeeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-blue-600" /> Onboard Hospital Employee
            </h3>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-semibold text-slate-600 block mb-1">Legal First Name</label>
                <input
                  id="input-new-first-name"
                  type="text"
                  placeholder="e.g. David"
                  className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-600 block mb-1">Legal Last Name</label>
                <input
                  id="input-new-last-name"
                  type="text"
                  placeholder="e.g. Miller"
                  className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="font-semibold text-slate-600 block mb-1">Primary Department</label>
              <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                {departments.map((d) => (
                  <option key={d.departmentId} value={d.departmentId}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-xs">
              <label className="font-semibold text-slate-600 block mb-1">Position Title</label>
              <input
                id="input-new-position"
                type="text"
                placeholder="e.g. Staff Nurse / Attending Physician"
                className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setShowAddEmployeeModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setActionMessage({
                    text: 'New employee created and placed in ONBOARDING workflow with credential checklist.',
                    type: 'success',
                  });
                  setShowAddEmployeeModal(false);
                }}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
              >
                Save & Initialize Onboarding
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Statutory Tax & Deduction Compliance Report Modal */}
      <StatutoryTaxComplianceReportModal
        isOpen={showStatutoryTaxModal}
        onClose={() => setShowStatutoryTaxModal(false)}
        periods={[
          {
            id: 'period_2026_03_A',
            tenantId: 'metro-health',
            periodName: 'March 2026 - First Half (Bi-Weekly)',
            startDate: '2026-03-01',
            endDate: '2026-03-15',
            paymentDate: '2026-03-20',
            status: 'FINALIZED',
            totalGrossPay: 148450,
            totalNetPay: 104280,
            totalGross: 148450,
            totalNet: 104280,
            createdAt: new Date().toISOString(),
          } as unknown as PayrollPeriod,
          {
            id: 'period_2026_02_B',
            tenantId: 'metro-health',
            periodName: 'February 2026 - Second Half (Bi-Weekly)',
            startDate: '2026-02-16',
            endDate: '2026-02-28',
            paymentDate: '2026-03-05',
            status: 'FINALIZED',
            totalGrossPay: 139200,
            totalNetPay: 98150,
            totalGross: 139200,
            totalNet: 98150,
            createdAt: new Date().toISOString(),
          } as unknown as PayrollPeriod,
        ]}
        payslips={employees.map((emp, idx) => {
          const base = emp.compensation?.baseSalary ? Math.round(emp.compensation.baseSalary / 26) : 3800 + idx * 420;
          const ot = idx % 2 === 0 ? 580 : 0;
          const gross = base + ot;
          const taxW = Math.round(gross * 0.148 * 100) / 100;
          const ss = Math.round(gross * 0.062 * 100) / 100;
          const med = Math.round(gross * 0.0145 * 100) / 100;
          const health = 135;
          const totDed = taxW + ss + med + health;
          const net = gross - totDed;

          return {
            id: `ps_${emp.employeeId}`,
            tenantId: 'metro-health',
            payrollPeriodId: 'period_2026_03_A',
            periodId: 'period_2026_03_A',
            employeeId: emp.employeeId,
            staffId: emp.employeeId,
            staffName: `${emp.personalInfo.legalFirstName} ${emp.personalInfo.legalLastName}`,
            department:
              emp.primaryDepartmentId === 'dept_cardiology'
                ? 'Cardiology'
                : emp.primaryDepartmentId === 'dept_emergency'
                ? 'Emergency'
                : 'Surgical Theaters',
            departmentName:
              emp.primaryDepartmentId === 'dept_cardiology'
                ? 'Cardiology'
                : emp.primaryDepartmentId === 'dept_emergency'
                ? 'Emergency'
                : 'Surgical Theaters',
            payslipNumber: `PAY-2026-${1000 + idx}`,
            regularPay: base,
            overtimePay: ot,
            grossPay: gross,
            taxDeduction: taxW,
            totalDeductions: totDed,
            netPay: net,
            statutoryDeductions: {
              taxWithholding: taxW,
              socialSecurity: ss,
              medicare: med,
              healthInsurance: health,
              totalDeductions: totDed,
            },
          } as unknown as Payslip;
        })}
        tenantId="metro-health"
      />
    </div>
  );
}
