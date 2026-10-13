import { getAdminFirestore } from '../../server/firebase/admin';

async function seedHcmConsultants() {
  const db = getAdminFirestore();
  if (!db) {
    throw new Error('Firestore admin is unavailable');
  }

  const tenants = ['central-metro-hospital', 'tenant_02bb76e3'];
  const facilityId = 'CENT';
  const departmentId = 'General Medicine';
  const departmentName = 'General Medicine';
  const now = Date.now();
  const startTime = new Date(now - 12 * 3600 * 1000).toISOString();
  const endTime = new Date(now + 7 * 24 * 3600 * 1000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const usersToUpdate = [
    'SfalyM1qbtUrVMFqD8XjUycVUoD2', // Dr. Sarah Jenkins (doctor.ghims)
    'MLtYdIVJHVek0Lv0JULslrZPvWH3', // Dr. Sarah Jenkins (s.jenkins)
    'rDjRzEyxnVcp9xZfYeA3HWYb6U23', // Dr. Ufaq Waqas
    '1AYk3ce8K1fqvoo08ag1EQITfz92', // Hospital Administrator
    'UiIuXlFwE8f6No3JfmoTeYJ5blx2', // Irtiza Haider
    'FcM3gawdXOOsG3kOgEJc5f6ghQX2', // Hospital Administrator
  ];

  const consultants = [
    {
      employeeId: 'emp_doc_ufaq_waqas',
      employeeNumber: 'EMP-2026-0102',
      userId: 'rDjRzEyxnVcp9xZfYeA3HWYb6U23',
      displayName: 'Dr. Ufaq Waqas',
      preferredName: 'Dr. Ufaq',
      firstName: 'Ufaq',
      lastName: 'Waqas',
      email: 'u.waqas@centralmetro.health',
      positionTitle: 'Consultant Physician & Intensivist',
      specialty: 'Internal Medicine',
      subSpecialties: ['Critical Care', 'Gynecologist'],
      qualification: 'MBBS, FCPS, Internal Medicine & Critical Care, Gynecology',
      licenseNumber: 'MED-NY-2024-8842',
    },
    {
      employeeId: 'emp_doc_sarah_jenkins',
      employeeNumber: 'EMP-2026-0101',
      userId: 'SfalyM1qbtUrVMFqD8XjUycVUoD2',
      displayName: 'Dr. Sarah Jenkins',
      preferredName: 'Dr. Sarah',
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
      employeeId: 'emp_doc_irtiza_haider',
      employeeNumber: 'EMP-2026-0001',
      userId: 'UiIuXlFwE8f6No3JfmoTeYJ5blx2',
      displayName: 'Dr. Irtiza Haider',
      preferredName: 'Dr. Irtiza',
      firstName: 'Irtiza',
      lastName: 'Haider',
      email: 'Irtiza.Haider007@gmail.com',
      positionTitle: 'Chief Medical Officer & Attending Physician',
      specialty: 'General Medicine',
      subSpecialties: ['Internal Medicine', 'Emergency Medicine'],
      qualification: 'MD, FACP',
      licenseNumber: 'MED-NY-2024-0001',
    },
  ];

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
    'SIGN_CLINICAL_NOTES',
    'SIGN_SOAP_CLINICAL_NOTE',
    'ACKNOWLEDGE_CRITICAL_RESULT',
  ];

  for (const tenantId of tenants) {
    const tenantRef = db.collection('tenants').doc(tenantId);

    // 1. Update user memberships
    for (const uid of usersToUpdate) {
      const userDocRef = tenantRef.collection('users').doc(uid);
      const snap = await userDocRef.get();
      const existing = snap.exists ? snap.data() : {};
      await userDocRef.set(
        {
          ...existing,
          userId: uid,
          tenantId,
          facilityIds: [facilityId, tenantId],
          departmentIds: [departmentId, 'Hospital Administration', 'Emergency', 'Cardiology'],
          status: 'ACTIVE',
          credentialStatus: 'VERIFIED',
          roles: Array.isArray(existing?.roles) && existing.roles.length > 0 ? existing.roles : ['doctor', 'administrator'],
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      console.log(`[${tenantId}] Updated user membership for: ${uid}`);
    }

    // 2. Provision consultants
    for (const c of consultants) {
      // 2.1 Employee Master
      await tenantRef.collection('employees').doc(c.employeeId).set(
        {
          employeeId: c.employeeId,
          employeeNumber: c.employeeNumber,
          userId: c.userId,
          tenantId,
          facilityIds: [facilityId, tenantId],
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
            preferredName: c.preferredName,
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
      console.log(`[${tenantId}] Provisioned EmployeeMaster: ${c.employeeId}`);

      // 2.2 Mandatory Verified Clinical Credential
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
      console.log(`[${tenantId}] Provisioned EmployeeCredential: ${credId}`);

      // 2.3 Granted Clinical Privileges
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
      console.log(`[${tenantId}] Provisioned ClinicalPrivileges for: ${c.employeeId}`);

      // 2.4 Published On-Duty Roster Shift Entry
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
          durationHours: 168,
          status: 'PUBLISHED',
          isOvertime: false,
          publishedAt: new Date().toISOString(),
          publishedBy: 'Hospital Administrator',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      console.log(`[${tenantId}] Provisioned RosterShiftEntry: ${rosterId}`);
    }

    // 3. Ensure any existing encounters have facilityId set
    const encSnap = await tenantRef.collection('encounters').get();
    for (const doc of encSnap.docs) {
      const data = doc.data();
      if (!data.facilityId) {
        await doc.ref.set(
          {
            facilityId,
            departmentId: data.departmentId || departmentId,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        console.log(`[${tenantId}] Backfilled facilityId for encounter: ${doc.id}`);
      }
    }
  }

  console.log('HCM workforce consultant provisioning completed successfully.');
}

seedHcmConsultants()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to seed HCM consultants:', err);
    process.exit(1);
  });
