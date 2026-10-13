import { getAdminFirestore } from '../../server/firebase/admin';

async function seedHcmConsultants() {
  const db = getAdminFirestore();
  if (!db) {
    throw new Error('Firestore admin is unavailable');
  }

  const tenantId = 'central-metro-hospital';
  const facilityId = 'CENT';
  const departmentId = 'General Medicine';
  const departmentName = 'General Medicine';
  const now = Date.now();
  const startTime = new Date(now - 4 * 3600 * 1000).toISOString();
  const endTime = new Date(now + 24 * 3600 * 1000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const tenantRef = db.collection('tenants').doc(tenantId);

  // 1. Update user memberships to include facilityIds and departmentIds
  const usersToUpdate = [
    'SfalyM1qbtUrVMFqD8XjUycVUoD2', // Dr. Sarah Jenkins (doctor.ghims)
    'MLtYdIVJHVek0Lv0JULslrZPvWH3', // Dr. Sarah Jenkins (s.jenkins)
    'rDjRzEyxnVcp9xZfYeA3HWYb6U23', // Dr. Ufaq Waqas
    '1AYk3ce8K1fqvoo08ag1EQITfz92', // Hospital Administrator
    'UiIuXlFwE8f6No3JfmoTeYJ5blx2', // Irtiza Haider
    'FcM3gawdXOOsG3kOgEJc5f6ghQX2', // Hospital Administrator
  ];

  for (const uid of usersToUpdate) {
    const userDocRef = tenantRef.collection('users').doc(uid);
    const snap = await userDocRef.get();
    if (snap.exists) {
      await userDocRef.set(
        {
          facilityIds: [facilityId, tenantId],
          departmentIds: [departmentId, 'Hospital Administration', 'Emergency', 'Cardiology'],
          status: 'ACTIVE',
          credentialStatus: 'VERIFIED',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      console.log(`Updated user membership facility scope for: ${uid}`);
    }
  }

  // 2. Consultants to provision
  const consultants = [
    {
      employeeId: 'emp_doc_sarah_jenkins',
      employeeNumber: 'EMP-2026-0101',
      userId: 'SfalyM1qbtUrVMFqD8XjUycVUoD2',
      displayName: 'Dr. Sarah Jenkins, MD',
      firstName: 'Sarah',
      lastName: 'Jenkins',
      email: 'doctor.ghims@centralmetro.health',
      positionTitle: 'Consultant Interventional Cardiologist',
      specialty: 'Cardiology',
      subSpecialties: ['Interventional Cardiology', 'Acute Coronary Care'],
      qualification: 'MD (Johns Hopkins), Fellowship (Cleveland Clinic)',
      licenseNumber: 'MED-NY-2024-8841',
    },
    {
      employeeId: 'emp_doc_ufaq_waqas',
      employeeNumber: 'EMP-2026-0102',
      userId: 'rDjRzEyxnVcp9xZfYeA3HWYb6U23',
      displayName: 'Dr. Ufaq Waqas, MD',
      firstName: 'Ufaq',
      lastName: 'Waqas',
      email: 'u.waqas@centralmetro.health',
      positionTitle: 'Consultant Physician & Intensivist',
      specialty: 'Internal Medicine',
      subSpecialties: ['Critical Care', 'Pulmonology'],
      qualification: 'MBBS, FCPS, Internal Medicine & Critical Care',
      licenseNumber: 'MED-NY-2024-8842',
    },
  ];

  for (const c of consultants) {
    // 2.1 Create Employee Master
    await tenantRef.collection('employees').doc(c.employeeId).set(
      {
        employeeId: c.employeeId,
        employeeNumber: c.employeeNumber,
        userId: c.userId,
        tenantId,
        facilityIds: [facilityId],
        primaryFacilityId: facilityId,
        departmentIds: [departmentId],
        primaryDepartmentId: departmentId,
        primaryDepartmentName: departmentName,
        positionId: `POS-${c.employeeId}`,
        positionTitle: c.positionTitle,
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
        hireDate: '2024-01-01',
        personalInfo: {
          legalFirstName: c.firstName,
          legalLastName: c.lastName,
          preferredName: c.displayName,
          dateOfBirth: '1982-06-15',
          gender: 'FEMALE',
          contactEmail: c.email,
          contactPhone: '+1-555-0144',
          emergencyContact: {
            name: 'Emergency Contact',
            relationship: 'Family',
            phone: '+1-555-0145',
          },
          residentialAddress: {
            street: '100 Medical Plaza Suite 400',
            city: 'Central Metro',
            state: 'NY',
            postalCode: '10001',
            country: 'USA',
          },
        },
        specialty: c.specialty,
        subSpecialties: c.subSpecialties,
        credentialRevision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        schemaVersion: 1,
      },
      { merge: true }
    );
    console.log(`Provisioned EmployeeMaster: ${c.employeeId}`);

    // 2.2 Create Mandatory Verified Clinical Credential
    const credId = `cred_${c.employeeId}_license`;
    await tenantRef.collection('clinicalCredentials').doc(credId).set(
      {
        credentialId: credId,
        tenantId,
        employeeId: c.employeeId,
        employeeName: c.displayName,
        credentialType: 'MEDICAL_LICENSE',
        title: 'State Medical Practice License',
        issuingAuthority: 'State Board of Medicine',
        credentialNumber: c.licenseNumber,
        issueDate: '2024-01-01',
        expiryDate: '2032-12-31',
        verificationStatus: 'VERIFIED',
        verifiedByActorId: '1AYk3ce8K1fqvoo08ag1EQITfz92',
        verifiedByName: 'Hospital Administrator',
        verifiedAt: new Date().toISOString(),
        isMandatoryForPractice: true,
        documentReference: `DOC-${c.licenseNumber}.pdf`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    console.log(`Provisioned EmployeeCredential: ${credId}`);

    // 2.3 Create Granted Clinical Privileges (including CONSULT_OPD)
    const privilegesToGrant = [
      'CONSULT_OPD',
      'PRESCRIBE_MEDICATION',
      'RECORD_VITALS',
      'TRIAGE_PATIENTS',
      'ADMIT_INPATIENT',
      'DISCHARGE_INPATIENT',
      'ORDER_LAB',
      'ORDER_RADIOLOGY',
      'ORDER_PROCEDURE',
      'SIGN_CLINICAL_NOTE',
      'SIGN_SOAP_CLINICAL_NOTE',
      'ACKNOWLEDGE_CRITICAL_RESULT',
    ];

    for (const privType of privilegesToGrant) {
      const privId = `priv_${c.employeeId}_${privType.toLowerCase()}`;
      await tenantRef.collection('clinicalPrivileges').doc(privId).set(
        {
          privilegeId: privId,
          tenantId,
          employeeId: c.employeeId,
          employeeName: c.displayName,
          privilegeType: privType,
          specialty: c.specialty,
          facilityId,
          facilityName: 'Central Metro General Hospital',
          departmentId,
          departmentName,
          effectiveFrom: '2024-01-01',
          effectiveUntil: '2032-12-31',
          status: 'GRANTED',
          grantedByActorId: '1AYk3ce8K1fqvoo08ag1EQITfz92',
          grantedByName: 'Hospital Administrator',
          reviewedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
    console.log(`Provisioned ClinicalPrivileges for: ${c.employeeId}`);

    // 2.4 Create Published On-Duty Roster Shift Entry
    const rosterId = `roster_${c.employeeId}_${today}`;
    await tenantRef.collection('rosterAssignments').doc(rosterId).set(
      {
        rosterId,
        tenantId,
        facilityId,
        facilityName: 'Central Metro General Hospital',
        departmentId,
        departmentName,
        employeeId: c.employeeId,
        employeeName: c.displayName,
        positionTitle: c.positionTitle,
        date: today,
        shiftId: `SHIFT-${today}-DAY`,
        shiftName: 'General Medicine On-Duty Specialist Shift',
        startTime,
        endTime,
        durationHours: 24,
        status: 'PUBLISHED',
        isOvertime: false,
        publishedAt: new Date().toISOString(),
        publishedBy: 'Hospital Administrator',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    console.log(`Provisioned RosterShiftEntry: ${rosterId}`);
  }

  console.log('HCM workforce consultant provisioning completed successfully.');
}

seedHcmConsultants()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to seed HCM consultants:', err);
    process.exit(1);
  });
