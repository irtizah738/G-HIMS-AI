import type { EdgeSnapshot } from '@/lib/offline/hydration';
import type {
  ComprehensiveOpdEncounter,
  OpdInvoice,
  PatientDemographics,
  QueueEntry,
} from '@/types/opd-domain';

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function ageFromDob(dob: string): number {
  const birth = new Date(`${dob}T00:00:00`);
  if (!dob || Number.isNaN(birth.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const month = now.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < birth.getDate())) age -= 1;
  return Math.max(0, age);
}

function normalizeGender(value: unknown): PatientDemographics['gender'] {
  const gender = String(value || '').trim().toLowerCase();
  if (gender === 'male') return 'Male';
  if (gender === 'female') return 'Female';
  if (gender === 'other') return 'Other';
  return 'Unknown';
}

function normalizeTariff(value: unknown): PatientDemographics['tariffPlan'] {
  const tariff = String(value || '').trim().toUpperCase();
  if (
    tariff === 'OUT_OF_POCKET' ||
    tariff === 'CORPORATE_PPO' ||
    tariff === 'SEHAT_CARD_UNIVERSAL' ||
    tariff === 'STATE_INSURANCE'
  ) {
    return tariff;
  }
  return 'UNASSIGNED';
}

function normalizeBloodGroup(value: unknown): PatientDemographics['bloodGroup'] {
  const candidate = String(value || '').trim();
  const valid = new Set(['A+','A-','B+','B-','AB+','AB-','O+','O-']);
  return valid.has(candidate)
    ? (candidate as PatientDemographics['bloodGroup'])
    : 'Unknown';
}

export function adaptAuthoritativeConsultationInvoice(
  rawInput: Record<string, any>
): OpdInvoice {
  const raw = asRecord(rawInput);
  const items = Array.isArray(raw.items) ? raw.items.map(asRecord) : [];
  return {
    id: String(raw.id || ''),
    tenantId: String(raw.tenantId || ''),
    encounterId: String(raw.encounterId || ''),
    patientId: String(raw.patientId || ''),
    invoiceNumber: String(raw.invoiceNumber || ''),
    payerTariffPlan: String(raw.tariffName || raw.planName || ''),
    billingPurpose: 'OPD_CONSULTATION',
    totalAmountMinorUnits: Math.round(Number(raw.totalGross || 0) * 100),
    payerCoverageAmountMinorUnits: Math.round(Number(raw.totalCoverage || 0) * 100),
    patientCopayAmountMinorUnits: Math.round(Number(raw.totalPatientDue || 0) * 100),
    balanceDueMinorUnits: Math.round(Number(raw.balanceDue || 0) * 100),
    settlementStatus:
      String(raw.paymentStatus || '').toLowerCase() === 'paid'
        ? 'SETTLED'
        : String(raw.paymentStatus || '').toLowerCase() === 'partially_paid'
          ? 'PARTIALLY_PAID'
          : 'PENDING',
    lineItems: items.map((item) => ({
      id: String(item.id || ''),
      serviceCode: String(item.code || ''),
      description: String(item.description || ''),
      category: 'CONSULTATION',
      quantity: Number(item.quantity || 1),
      unitPriceMinorUnits: Math.round(Number(item.unitPrice || 0) * 100),
      totalMinorUnits: Math.round(Number(item.netAmount || 0) * 100),
    })),
    payments: [],
    issuedAt: Date.parse(String(raw.createdAt || '')) || 0,
    issuedBy: 'SERVER_BILLING_AUTHORITY',
    ...(String(raw.paymentStatus || '').toLowerCase() === 'paid'
      ? { settledAt: Date.parse(String(raw.updatedAt || '')) || 0 }
      : {}),
  };
}

function mapQueueStatus(value: unknown): QueueEntry['status'] {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'payment_pending') return 'PAYMENT_PENDING';
  if (status === 'called') return 'CALLED';
  if (status === 'in_consultation') return 'IN_SERVICE';
  if (status === 'completed') return 'COMPLETED';
  if (status === 'no_show') return 'SKIPPED';
  if (status === 'transferred') return 'TRANSFERRED';
  return 'WAITING';
}

export interface OpdWorkspaceReadModel {
  patients: PatientDemographics[];
  encounters: ComprehensiveOpdEncounter[];
  queue: QueueEntry[];
}

export function buildOpdWorkspaceReadModel(
  snapshot: EdgeSnapshot
): OpdWorkspaceReadModel {
  const rawPatients = snapshot.collections.patients || [];
  const rawEncounters = snapshot.collections.encounters || [];
  const rawQueue = snapshot.collections.opd_queue || [];
  const rawInvoices = snapshot.collections.invoices || [];
  const rawOrders = snapshot.collections.orders || [];
  const rawPrescriptions = snapshot.collections.prescriptions || [];

  const patients: PatientDemographics[] = rawPatients.map((row) => {
    const patient = asRecord(row);
    const identifiers = Array.isArray(patient.identifiers)
      ? patient.identifiers.map(asRecord)
      : [];
    const nationalId = identifiers.find(
      (identifier) => String(identifier.type || '').toUpperCase() === 'CNIC'
    );
    const emergency = asRecord(patient.emergencyContact);

    return {
      id: String(patient.id || patient.patientId || ''),
      mrn: String(patient.mrn || ''),
      fullName: String(patient.fullName || ''),
      gender: normalizeGender(patient.gender),
      dob: String(patient.dateOfBirth || ''),
      age: ageFromDob(String(patient.dateOfBirth || '')),
      nationalId: String(nationalId?.value || ''),
      maritalStatus: 'Unknown',
      nationality: '',
      primaryLanguage: '',
      phone: String(patient.contactPhone || ''),
      email: patient.email ? String(patient.email) : undefined,
      residentialAddress: String(patient.address || ''),
      emergencyContact:
        emergency.name && emergency.phone
          ? {
              name: String(emergency.name),
              relation: String(emergency.relationship || ''),
              phone: String(emergency.phone),
            }
          : undefined,
      tariffPlan: normalizeTariff(patient.tariffPlan),
      insuranceDetails: patient.insuranceDetails
        ? asRecord(patient.insuranceDetails)
        : undefined,
      bloodGroup: normalizeBloodGroup(patient.bloodGroup),
      knownAllergies: Array.isArray(patient.allergies)
        ? patient.allergies.map(String)
        : undefined,
      chronicConditions: Array.isArray(patient.chronicConditions)
        ? patient.chronicConditions.map(String)
        : undefined,
      createdAt: Number(patient.createdAt || 0),
    };
  });

  const patientById = new Map(patients.map((patient) => [patient.id, patient]));
  const consultationInvoiceByEncounter = new Map<string, OpdInvoice>();
  const finalInvoiceByEncounter = new Map<string, OpdInvoice>();

  for (const row of rawInvoices) {
    const invoice = asRecord(row);
    const encounterId = String(invoice.encounterId || '');
    if (!encounterId) continue;
    if (String(invoice.billingPurpose || '').toUpperCase() === 'OPD_CONSULTATION') {
      consultationInvoiceByEncounter.set(
        encounterId,
        adaptAuthoritativeConsultationInvoice(invoice)
      );
    }
  }

  const encounters: ComprehensiveOpdEncounter[] = rawEncounters
    .filter((row) => {
      const encounter = asRecord(row);
      return String(encounter.encounterType || encounter.type || '').toUpperCase() === 'OPD';
    })
    .map((row) => {
      const encounter = asRecord(row);
      const id = String(encounter.encounterId || encounter.id || '');
      const patientId = String(encounter.patientId || '');
      const patient = patientById.get(patientId);
      const consultationInvoice = consultationInvoiceByEncounter.get(id);
      const financialState = String(encounter.financialClearanceState || '').toUpperCase();

      return {
        id,
        tenantId: String(encounter.tenantId || snapshot.tenantId),
        patientId,
        mrn: patient?.mrn || '',
        patientName: patient?.fullName || '',
        gender: patient?.gender || 'Unknown',
        age: patient?.age || 0,
        tokenNumber: encounter.tokenNumber ? String(encounter.tokenNumber) : undefined,
        chiefComplaint: encounter.chiefComplaint
          ? String(encounter.chiefComplaint)
          : undefined,
        encounterType: 'OPD',
        currentStage: String(
          encounter.clinicalState ||
            encounter.currentStage ||
            encounter.currentStageId ||
            'REGISTERED'
        ),
        department: encounter.department
          ? String(encounter.department)
          : encounter.departmentId
            ? String(encounter.departmentId)
            : undefined,
        attendingDoctorId: encounter.assignedDoctorId
          ? String(encounter.assignedDoctorId)
          : undefined,
        attendingDoctorName: encounter.assignedDoctor
          ? String(encounter.assignedDoctor)
          : undefined,
        tariffPlan: patient?.tariffPlan || 'UNASSIGNED',
        insuranceDetails: patient?.insuranceDetails,
        knownAllergies: patient?.knownAllergies,
        financialClearance: {
          ingressFeePaid:
            financialState === 'CONSULTATION_CLEARED' ||
            financialState === 'NOT_REQUIRED',
          amountPaid: consultationInvoice
            ? Math.max(
                0,
                (consultationInvoice.patientCopayAmountMinorUnits -
                  consultationInvoice.balanceDueMinorUnits) /
                  100
              )
            : 0,
        },
        diagnosticOrders: rawOrders
          .filter((order) => String(asRecord(order).encounterId || '') === id)
          .map((order) => asRecord(order) as any),
        prescriptions: rawPrescriptions
          .filter((prescription) => String(asRecord(prescription).encounterId || '') === id)
          .map((prescription) => asRecord(prescription) as any),
        consultationInvoice,
        invoice: finalInvoiceByEncounter.get(id),
        startedAt: Number(encounter.startedAt || 0),
        status:
          String(encounter.status || '').toUpperCase() === 'COMPLETED'
            ? 'COMPLETED'
            : financialState === 'CONSULTATION_PAYMENT_PENDING'
              ? 'REGISTERED'
              : String(encounter.clinicalState || '').toUpperCase() === 'TRIAGE'
                ? 'IN_TRIAGE'
                : String(encounter.clinicalState || '').toUpperCase() === 'CONSULTATION'
                  ? 'IN_CONSULTATION'
                  : 'IN_QUEUE',
      };
    });

  const queue: QueueEntry[] = rawQueue.map((row) => {
    const token = asRecord(row);
    return {
      id: String(token.id || ''),
      tokenNumber: String(token.tokenNumber || ''),
      encounterId: String(token.encounterId || ''),
      patientId: token.patientId ? String(token.patientId) : undefined,
      patientName: String(token.patientName || ''),
      mrn: String(token.mrn || ''),
      department: String(token.department || ''),
      assignedDoctorName: token.assignedDoctorName
        ? String(token.assignedDoctorName)
        : undefined,
      assignedRoomOrBay: token.assignedRoomOrBay
        ? String(token.assignedRoomOrBay)
        : 'UNASSIGNED',
      triagePriority: String(token.priority || 'ROUTINE').toUpperCase(),
      status: mapQueueStatus(token.status),
      issuedAt: Date.parse(String(token.arrivalTime || '')) || Number(token.createdAt || 0),
      createdAt: Number(token.createdAt || 0),
      calledAt: Number(token.calledAt || 0) || undefined,
      serviceStartedAt: Number(token.serviceStartedAt || 0) || undefined,
      completedAt: Number(token.completedAt || 0) || undefined,
    };
  });

  return { patients, encounters, queue };
}
