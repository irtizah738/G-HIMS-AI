/**
 * G-HIMS Hospital KPI Analytics & Reporting Engine
 * Computes executive and departmental hospital performance indicators:
 * - Patient Admission Rates & Inpatient Velocity
 * - 30-Day Readmission Rates by Department & Risk Factor
 * - Average Length of Stay (ALOS) vs National Benchmarks
 * - Department-Wise Revenue, Collections, and AR Aging
 * - Staff Productivity (Physician volume, nurse ratios, OR utilization, documentation turnaround)
 * - Bed Occupancy Trends by Ward & Time Horizon
 * 
 * Supports customizable filters and multi-format exports (PDF, CSV, JSON).
 */

export interface AnalyticsFilterState {
  timeHorizon: '24h' | '7d' | '30d' | '90d' | 'ytd';
  department: string;
  encounterType: 'all' | 'inpatient' | 'outpatient' | 'emergency' | 'surgical';
  customStartDate?: string;
  customEndDate?: string;
}

export interface KpiCardSummary {
  id: string;
  title: string;
  value: string | number;
  unit?: string;
  changePercent: number; // e.g. +3.4% or -1.8%
  trend: 'up' | 'down' | 'neutral';
  isPositive: boolean; // whether the direction is favorable in clinical/operational terms
  benchmark?: string;
  category: 'clinical' | 'operational' | 'financial' | 'quality';
  description: string;
}

export interface AdmissionTrendPoint {
  date: string;
  inpatient: number;
  emergency: number;
  outpatient: number;
  surgical: number;
  totalAdmissions: number;
  discharges: number;
}

export interface ReadmissionDeptData {
  department: string;
  admissions: number;
  readmissions30d: number;
  readmissionRate: number; // percentage
  targetBenchmark: number; // percentage
  riskLevel: 'LOW' | 'NORMAL' | 'ELEVATED' | 'CRITICAL';
  topCause: string;
}

export interface AlosDepartmentData {
  department: string;
  alos: number; // in days
  benchmark: number; // in days
  variance: number; // alos - benchmark
  patientCount: number;
  bedTurnaroundHours: number;
}

export interface DepartmentRevenueData {
  department: string;
  grossBilled: number;
  netCollected: number;
  collectionRate: number; // percentage
  operatingMargin: number; // percentage
  shareOfTotalRevenue: number; // percentage
  averageRevenuePerPatient: number;
}

export interface BedOccupancyTrendPoint {
  timestamp: string;
  icuOccupancy: number; // percentage
  ccuOccupancy: number;
  generalWardOccupancy: number;
  surgicalWardOccupancy: number;
  pediatricOccupancy: number;
  emergencyOccupancy: number;
  overallOccupancy: number;
  totalOccupiedBeds: number;
  totalAvailableBeds: number;
}

export interface StaffProductivityMetric {
  staffCategory: string;
  activeHeadcount: number;
  avgPatientThroughputPerDay: number;
  ratioComplianceRate: number; // e.g. 96.4%
  turnaroundTimeHours: number;
  overtimeHoursAvg: number;
  productivityScore: number; // 0-100 index
  benchmarkScore: number;
}

export interface HospitalKpiReport {
  generatedAt: string;
  filter: AnalyticsFilterState;
  hospitalName: string;
  facilityCode: string;
  summaryCards: KpiCardSummary[];
  admissionTrends: AdmissionTrendPoint[];
  readmissionsByDept: ReadmissionDeptData[];
  alosByDept: AlosDepartmentData[];
  revenueByDept: DepartmentRevenueData[];
  bedOccupancyTrends: BedOccupancyTrendPoint[];
  staffProductivity: StaffProductivityMetric[];
  overallStats: {
    totalPatientsTreated: number;
    totalGrossRevenue: number;
    totalNetCollections: number;
    overallAlos: number;
    overallReadmissionRate: number;
    overallBedOccupancy: number;
    physicianProductivityIndex: number;
  };
}

/**
 * Generates dynamic, realistic hospital reporting data based on active filters
 */
export function generateHospitalKpiReport(filter: AnalyticsFilterState): HospitalKpiReport {
  const runtime = String(
    process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE ||
      process.env.GHIMS_RUNTIME_MODE ||
      ''
  ).trim().toUpperCase();
  if (runtime !== 'DEMO' && runtime !== 'TEST') {
    throw new Error(
      'AUTHORITATIVE_ANALYTICS_PROJECTION_REQUIRED: synthetic KPI generation is disabled outside DEMO/TEST.'
    );
  }

  const isAllDepts = filter.department === 'all' || !filter.department;
  
  // Scaling factors based on time horizon
  let dayCount = 30;
  let multiplier = 1.0;
  if (filter.timeHorizon === '24h') {
    dayCount = 1;
    multiplier = 0.04;
  } else if (filter.timeHorizon === '7d') {
    dayCount = 7;
    multiplier = 0.25;
  } else if (filter.timeHorizon === '30d') {
    dayCount = 30;
    multiplier = 1.0;
  } else if (filter.timeHorizon === '90d') {
    dayCount = 90;
    multiplier = 2.9;
  } else if (filter.timeHorizon === 'ytd') {
    dayCount = 260;
    multiplier = 8.2;
  }

  // Base raw figures scaled
  const totalTreated = Math.round(4820 * multiplier);
  const grossRev = Math.round(11240000 * multiplier);
  const netColl = Math.round(9890000 * multiplier);

  const summaryCards: KpiCardSummary[] = [
    {
      id: 'kpi-admissions',
      title: 'Patient Admission Velocity',
      value: Math.round(1240 * multiplier).toLocaleString(),
      unit: 'admissions',
      changePercent: 4.8,
      trend: 'up',
      isPositive: true,
      benchmark: `${Math.round(1180 * multiplier)} projected`,
      category: 'operational',
      description: 'Total emergency, elective, and direct transfers admitted into inpatient services.',
    },
    {
      id: 'kpi-readmission-rate',
      title: '30-Day Readmission Rate',
      value: '7.8',
      unit: '%',
      changePercent: -1.2,
      trend: 'down',
      isPositive: true, // down is good for readmissions!
      benchmark: '9.5% National Benchmark',
      category: 'quality',
      description: 'Percentage of discharged patients readmitted within 30 days for related conditions.',
    },
    {
      id: 'kpi-alos',
      title: 'Average Length of Stay (ALOS)',
      value: '4.1',
      unit: 'days',
      changePercent: -0.3,
      trend: 'down',
      isPositive: true, // slight reduction in ALOS without readmission spike is positive
      benchmark: '4.6 days CMS Benchmark',
      category: 'clinical',
      description: 'Average duration in calendar days that an inpatient occupies a licensed hospital bed.',
    },
    {
      id: 'kpi-revenue',
      title: 'Total Net Collections',
      value: `$${(netColl / 1000000).toFixed(2)}M`,
      unit: 'USD',
      changePercent: 6.4,
      trend: 'up',
      isPositive: true,
      benchmark: `$${((netColl * 0.94) / 1000000).toFixed(2)}M Target`,
      category: 'financial',
      description: 'Net realized cash receipts after contractual payer allowances and discounts.',
    },
    {
      id: 'kpi-bed-occupancy',
      title: 'Hospital Bed Occupancy',
      value: '84.2',
      unit: '%',
      changePercent: 1.8,
      trend: 'up',
      isPositive: true, // within optimal 80-85% zone
      benchmark: '80.0% - 85.0% Optimal Zone',
      category: 'operational',
      description: 'Proportion of operational acute care and critical care beds currently utilized.',
    },
    {
      id: 'kpi-staff-productivity',
      title: 'Staff Productivity Index',
      value: '104.6',
      unit: 'points',
      changePercent: 3.2,
      trend: 'up',
      isPositive: true,
      benchmark: '100.0 Standard Baseline',
      category: 'operational',
      description: 'Composite operational score across consultation volume, nurse staffing ratios, and turnaround times.',
    },
  ];

  // Generate admission trends data points
  const admissionTrends: AdmissionTrendPoint[] = [];
  const pointsToGenerate = filter.timeHorizon === '24h' ? 12 : filter.timeHorizon === '7d' ? 7 : 14;
  
  for (let i = pointsToGenerate - 1; i >= 0; i--) {
    let dateLabel = '';
    if (filter.timeHorizon === '24h') {
      const hour = (24 - i * 2) % 24;
      dateLabel = `${hour.toString().padStart(2, '0')}:00`;
    } else {
      const d = new Date();
      d.setDate(d.getDate() - i * (filter.timeHorizon === '90d' || filter.timeHorizon === 'ytd' ? 7 : 1));
      dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    const baseAdmissions = filter.timeHorizon === '24h' ? 8 : 42;
    const dayVar = Math.sin(i * 0.8) * 8;
    const inpatient = Math.max(4, Math.round((baseAdmissions * 0.45) + dayVar));
    const emergency = Math.max(3, Math.round((baseAdmissions * 0.30) + (dayVar * 0.6)));
    const outpatient = Math.max(2, Math.round((baseAdmissions * 0.15) + (dayVar * 0.3)));
    const surgical = Math.max(1, Math.round((baseAdmissions * 0.10) + (dayVar * 0.2)));
    const total = inpatient + emergency + outpatient + surgical;
    const discharges = Math.max(2, Math.round(total * 0.92 + (Math.cos(i) * 3)));

    admissionTrends.push({
      date: dateLabel,
      inpatient,
      emergency,
      outpatient,
      surgical,
      totalAdmissions: total,
      discharges,
    });
  }

  // Departmental Readmissions Data
  const rawReadmissions: ReadmissionDeptData[] = [
    {
      department: 'Cardiology',
      admissions: Math.round(310 * multiplier),
      readmissions30d: Math.round(31 * multiplier),
      readmissionRate: 10.0,
      targetBenchmark: 11.5,
      riskLevel: 'NORMAL',
      topCause: 'Congestive heart failure exacerbation & fluid overload',
    },
    {
      department: 'General Surgery',
      admissions: Math.round(420 * multiplier),
      readmissions30d: Math.round(22 * multiplier),
      readmissionRate: 5.2,
      targetBenchmark: 6.8,
      riskLevel: 'LOW',
      topCause: 'Post-operative seroma / surgical site infection',
    },
    {
      department: 'Internal Medicine',
      admissions: Math.round(540 * multiplier),
      readmissions30d: Math.round(49 * multiplier),
      readmissionRate: 9.1,
      targetBenchmark: 10.2,
      riskLevel: 'NORMAL',
      topCause: 'Sepsis recovery & diabetic ketoacidosis recurrence',
    },
    {
      department: 'Oncology',
      admissions: Math.round(210 * multiplier),
      readmissions30d: Math.round(25 * multiplier),
      readmissionRate: 11.9,
      targetBenchmark: 13.0,
      riskLevel: 'NORMAL',
      topCause: 'Febrile neutropenia & chemotherapy toxicity',
    },
    {
      department: 'Orthopedics',
      admissions: Math.round(280 * multiplier),
      readmissions30d: Math.round(11 * multiplier),
      readmissionRate: 3.9,
      targetBenchmark: 5.0,
      riskLevel: 'LOW',
      topCause: 'Implant subluxation & deep vein thrombosis prophylaxis failure',
    },
    {
      department: 'Pulmonology',
      admissions: Math.round(260 * multiplier),
      readmissions30d: Math.round(27 * multiplier),
      readmissionRate: 10.4,
      targetBenchmark: 11.0,
      riskLevel: 'NORMAL',
      topCause: 'COPD acute exacerbation & aspiration pneumonia',
    },
    {
      department: 'Pediatrics',
      admissions: Math.round(340 * multiplier),
      readmissions30d: Math.round(12 * multiplier),
      readmissionRate: 3.5,
      targetBenchmark: 4.5,
      riskLevel: 'LOW',
      topCause: 'Reactive airway disease & acute viral gastroenteritis',
    },
  ];

  const readmissionsByDept = isAllDepts
    ? rawReadmissions
    : rawReadmissions.filter((r) => r.department.toLowerCase().includes(filter.department.toLowerCase()));

  // ALOS by Department
  const rawAlos: AlosDepartmentData[] = [
    { department: 'Critical Care (ICU)', alos: 5.2, benchmark: 5.8, variance: -0.6, patientCount: Math.round(180 * multiplier), bedTurnaroundHours: 3.8 },
    { department: 'Cardiology', alos: 4.1, benchmark: 4.5, variance: -0.4, patientCount: Math.round(310 * multiplier), bedTurnaroundHours: 4.2 },
    { department: 'General Surgery', alos: 3.7, benchmark: 4.2, variance: -0.5, patientCount: Math.round(420 * multiplier), bedTurnaroundHours: 3.5 },
    { department: 'Oncology', alos: 6.1, benchmark: 6.8, variance: -0.7, patientCount: Math.round(210 * multiplier), bedTurnaroundHours: 5.1 },
    { department: 'Orthopedics', alos: 3.1, benchmark: 3.6, variance: -0.5, patientCount: Math.round(280 * multiplier), bedTurnaroundHours: 3.2 },
    { department: 'Internal Medicine', alos: 4.4, benchmark: 4.8, variance: -0.4, patientCount: Math.round(540 * multiplier), bedTurnaroundHours: 4.0 },
    { department: 'Pediatrics', alos: 2.3, benchmark: 2.7, variance: -0.4, patientCount: Math.round(340 * multiplier), bedTurnaroundHours: 2.8 },
    { department: 'Obstetrics & Gynecology', alos: 2.1, benchmark: 2.4, variance: -0.3, patientCount: Math.round(290 * multiplier), bedTurnaroundHours: 2.5 },
  ];

  const alosByDept = isAllDepts
    ? rawAlos
    : rawAlos.filter((a) => a.department.toLowerCase().includes(filter.department.toLowerCase()));

  // Department Revenue Breakdown
  const rawRevenue: DepartmentRevenueData[] = [
    { department: 'General Surgery & OT', grossBilled: Math.round(2450000 * multiplier), netCollected: Math.round(2210000 * multiplier), collectionRate: 90.2, operatingMargin: 38.4, shareOfTotalRevenue: 22.3, averageRevenuePerPatient: 5260 },
    { department: 'Cardiology & Cath Lab', grossBilled: Math.round(1980000 * multiplier), netCollected: Math.round(1760000 * multiplier), collectionRate: 88.9, operatingMargin: 34.1, shareOfTotalRevenue: 17.8, averageRevenuePerPatient: 5670 },
    { department: 'Oncology & Infusion', grossBilled: Math.round(1850000 * multiplier), netCollected: Math.round(1680000 * multiplier), collectionRate: 90.8, operatingMargin: 29.5, shareOfTotalRevenue: 17.0, averageRevenuePerPatient: 8000 },
    { department: 'Orthopedics & Joint Care', grossBilled: Math.round(1450000 * multiplier), netCollected: Math.round(1330000 * multiplier), collectionRate: 91.7, operatingMargin: 36.8, shareOfTotalRevenue: 13.4, averageRevenuePerPatient: 4750 },
    { department: 'Radiology & Imaging', grossBilled: Math.round(1350000 * multiplier), netCollected: Math.round(1280000 * multiplier), collectionRate: 94.8, operatingMargin: 51.2, shareOfTotalRevenue: 12.9, averageRevenuePerPatient: 980 },
    { department: 'Emergency & Trauma', grossBilled: Math.round(1120000 * multiplier), netCollected: Math.round(890000 * multiplier), collectionRate: 79.5, operatingMargin: 21.8, shareOfTotalRevenue: 9.0, averageRevenuePerPatient: 1140 },
    { department: 'Pathology & Lab Diagnostics', grossBilled: Math.round(890000 * multiplier), netCollected: Math.round(840000 * multiplier), collectionRate: 94.4, operatingMargin: 48.6, shareOfTotalRevenue: 8.5, averageRevenuePerPatient: 320 },
    { department: 'Pediatrics & Neonatal', grossBilled: Math.round(680000 * multiplier), netCollected: Math.round(620000 * multiplier), collectionRate: 91.2, operatingMargin: 19.4, shareOfTotalRevenue: 6.3, averageRevenuePerPatient: 1820 },
  ];

  const revenueByDept = isAllDepts
    ? rawRevenue
    : rawRevenue.filter((r) => r.department.toLowerCase().includes(filter.department.toLowerCase()));

  // Bed Occupancy Trends
  const bedOccupancyTrends: BedOccupancyTrendPoint[] = [];
  const bedPoints = 14;
  for (let i = bedPoints - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * 2);
    const timeLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const shift = Math.sin(i * 0.5) * 4;

    const icu = Math.min(98, Math.max(78, Math.round(89 + shift + (i % 2 === 0 ? 2 : -1))));
    const ccu = Math.min(95, Math.max(72, Math.round(86 + shift * 0.8)));
    const general = Math.min(92, Math.max(74, Math.round(82 + shift * 0.6)));
    const surgical = Math.min(90, Math.max(70, Math.round(79 + shift * 0.7)));
    const pediatric = Math.min(85, Math.max(55, Math.round(65 + shift * 0.5)));
    const emergency = Math.min(96, Math.max(76, Math.round(88 + shift * 0.9)));
    const overall = Math.round((icu * 0.15) + (ccu * 0.10) + (general * 0.40) + (surgical * 0.20) + (pediatric * 0.15));

    const totalBeds = 480;
    const occupied = Math.round((totalBeds * overall) / 100);

    bedOccupancyTrends.push({
      timestamp: timeLabel,
      icuOccupancy: icu,
      ccuOccupancy: ccu,
      generalWardOccupancy: general,
      surgicalWardOccupancy: surgical,
      pediatricOccupancy: pediatric,
      emergencyOccupancy: emergency,
      overallOccupancy: overall,
      totalOccupiedBeds: occupied,
      totalAvailableBeds: totalBeds - occupied,
    });
  }

  // Staff Productivity Metrics
  const staffProductivity: StaffProductivityMetric[] = [
    {
      staffCategory: 'Attending Physicians (OPD & Ward)',
      activeHeadcount: 64,
      avgPatientThroughputPerDay: 19.2,
      ratioComplianceRate: 98.2,
      turnaroundTimeHours: 3.4,
      overtimeHoursAvg: 4.2,
      productivityScore: 106.4,
      benchmarkScore: 100.0,
    },
    {
      staffCategory: 'Operating Theater Surgeons',
      activeHeadcount: 28,
      avgPatientThroughputPerDay: 4.4,
      ratioComplianceRate: 96.5,
      turnaroundTimeHours: 1.8,
      overtimeHoursAvg: 6.8,
      productivityScore: 108.2,
      benchmarkScore: 100.0,
    },
    {
      staffCategory: 'Emergency Triage Physicians',
      activeHeadcount: 22,
      avgPatientThroughputPerDay: 28.6,
      ratioComplianceRate: 97.4,
      turnaroundTimeHours: 0.8,
      overtimeHoursAvg: 5.5,
      productivityScore: 103.8,
      benchmarkScore: 100.0,
    },
    {
      staffCategory: 'Inpatient Registered Nurses (RN)',
      activeHeadcount: 186,
      avgPatientThroughputPerDay: 4.8, // patient load per nurse
      ratioComplianceRate: 96.1,
      turnaroundTimeHours: 1.2,
      overtimeHoursAvg: 3.4,
      productivityScore: 102.5,
      benchmarkScore: 100.0,
    },
    {
      staffCategory: 'ICU / Critical Care Nurses',
      activeHeadcount: 54,
      avgPatientThroughputPerDay: 1.8, // 1:2 strict ICU nurse ratio
      ratioComplianceRate: 99.1,
      turnaroundTimeHours: 0.5,
      overtimeHoursAvg: 4.8,
      productivityScore: 105.0,
      benchmarkScore: 100.0,
    },
    {
      staffCategory: 'Diagnostic Imaging Radiologists',
      activeHeadcount: 14,
      avgPatientThroughputPerDay: 42.0, // imaging studies read per day
      ratioComplianceRate: 98.8,
      turnaroundTimeHours: 2.1,
      overtimeHoursAvg: 2.6,
      productivityScore: 104.9,
      benchmarkScore: 100.0,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    filter,
    hospitalName: 'Central Metropolitan Hospital & Health Sciences',
    facilityCode: 'CMH-MAIN-01',
    summaryCards,
    admissionTrends,
    readmissionsByDept,
    alosByDept,
    revenueByDept,
    bedOccupancyTrends,
    staffProductivity,
    overallStats: {
      totalPatientsTreated: totalTreated,
      totalGrossRevenue: grossRev,
      totalNetCollections: netColl,
      overallAlos: 4.1,
      overallReadmissionRate: 7.8,
      overallBedOccupancy: 84.2,
      physicianProductivityIndex: 104.6,
    },
  };
}

/**
 * Clean, safe client-side CSV Exporter
 */
export function exportReportToCsv(report: HospitalKpiReport, filename = 'hospital-kpi-report.csv') {
  const lines: string[] = [];

  // Header metadata
  lines.push(`"G-HIMS HOSPITAL PERFORMANCE & ANALYTICS EXECUTIVE REPORT"`);
  lines.push(`"Facility:","${report.hospitalName} (${report.facilityCode})"`);
  lines.push(`"Generated:","${new Date(report.generatedAt).toLocaleString()}"`);
  lines.push(`"Time Horizon:","${report.filter.timeHorizon.toUpperCase()}"`);
  lines.push(`"Department Filter:","${report.filter.department.toUpperCase()}"`);
  lines.push(`"Encounter Filter:","${report.filter.encounterType.toUpperCase()}"`);
  lines.push('');

  // 1. Executive KPIs Summary
  lines.push(`"--- SECTION 1: KEY PERFORMANCE INDICATORS (KPIs) ---"`);
  lines.push(`"Metric","Value","Unit","Variance vs Prev","Benchmark","Category","Description"`);
  report.summaryCards.forEach((k) => {
    lines.push(
      `"${k.title}","${k.value}","${k.unit || ''}","${k.changePercent > 0 ? '+' : ''}${k.changePercent}%","${k.benchmark || ''}","${k.category}","${k.description}"`
    );
  });
  lines.push('');

  // 2. Department Revenue Breakdown
  lines.push(`"--- SECTION 2: DEPARTMENT-WISE REVENUE & COLLECTIONS ---"`);
  lines.push(`"Department","Gross Billed (USD)","Net Collected (USD)","Collection Rate (%)","Operating Margin (%)","Revenue Share (%)","Avg Rev / Patient (USD)"`);
  report.revenueByDept.forEach((r) => {
    lines.push(
      `"${r.department}","${r.grossBilled}","${r.netCollected}","${r.collectionRate}%","${r.operatingMargin}%","${r.shareOfTotalRevenue}%","${r.averageRevenuePerPatient}"`
    );
  });
  lines.push('');

  // 3. 30-Day Readmission Rates by Department
  lines.push(`"--- SECTION 3: 30-DAY READMISSION RATES BY SPECIALTY ---"`);
  lines.push(`"Department","Admissions","30-Day Readmissions","Readmission Rate (%)","CMS Target Benchmark (%)","Risk Level","Top Clinical Readmission Cause"`);
  report.readmissionsByDept.forEach((r) => {
    lines.push(
      `"${r.department}","${r.admissions}","${r.readmissions30d}","${r.readmissionRate}%","${r.targetBenchmark}%","${r.riskLevel}","${r.topCause}"`
    );
  });
  lines.push('');

  // 4. Average Length of Stay (ALOS)
  lines.push(`"--- SECTION 4: AVERAGE LENGTH OF STAY (ALOS) BY SPECIALTY ---"`);
  lines.push(`"Department","ALOS (Days)","National Benchmark (Days)","Variance (Days)","Patient Volume","Bed Turnaround (Hours)"`);
  report.alosByDept.forEach((a) => {
    lines.push(
      `"${a.department}","${a.alos}","${a.benchmark}","${a.variance > 0 ? '+' : ''}${a.variance}","${a.patientCount}","${a.bedTurnaroundHours}"`
    );
  });
  lines.push('');

  // 5. Staff Productivity Metrics
  lines.push(`"--- SECTION 5: CLINICAL & NURSING STAFF PRODUCTIVITY ---"`);
  lines.push(`"Staff Category","Active Headcount","Avg Daily Patient Throughput","Staffing Ratio Compliance (%)","Documentation Turnaround (Hours)","Overtime Avg (Hours)","Productivity Score Index"`);
  report.staffProductivity.forEach((s) => {
    lines.push(
      `"${s.staffCategory}","${s.activeHeadcount}","${s.avgPatientThroughputPerDay}","${s.ratioComplianceRate}%","${s.turnaroundTimeHours}","${s.overtimeHoursAvg}","${s.productivityScore}"`
    );
  });
  lines.push('');

  // 6. Bed Occupancy Trend Samples
  lines.push(`"--- SECTION 6: WARD BED OCCUPANCY TIME-SERIES ---"`);
  lines.push(`"Timestamp","Overall Occupancy (%)","ICU (%)","CCU (%)","General Ward (%)","Surgical Ward (%)","Pediatric (%)","Emergency (%)","Occupied Beds","Available Beds"`);
  report.bedOccupancyTrends.forEach((b) => {
    lines.push(
      `"${b.timestamp}","${b.overallOccupancy}%","${b.icuOccupancy}%","${b.ccuOccupancy}%","${b.generalWardOccupancy}%","${b.surgicalWardOccupancy}%","${b.pediatricOccupancy}%","${b.emergencyOccupancy}%","${b.totalOccupiedBeds}","${b.totalAvailableBeds}"`
    );
  });

  const csvContent = lines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Clean, safe client-side JSON Exporter for Data Pipelines & EHR
 */
export function exportReportToJson(report: HospitalKpiReport, filename = 'hospital-kpi-report.json') {
  const jsonStr = JSON.stringify(report, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Professional PDF Exporter with Hospital Header, Executive KPI Table, and Department Summaries
 * Uses dynamic import of jspdf and jspdf-autotable to keep initial bundle lightweight
 */
export async function exportReportToPdf(report: HospitalKpiReport, filename = 'hospital-executive-kpi-report.pdf') {
  try {
    const { jsPDF } = await import('jspdf');
    const autoTableModule = await import('jspdf-autotable');
    const autoTable = autoTableModule.default || autoTableModule;

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    // 1. Header Banner
    doc.setFillColor(30, 58, 138); // Dark Navy Blue
    doc.rect(0, 0, 210, 26, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('G-HIMS HOSPITAL MANAGEMENT OPERATING SYSTEM', 14, 11);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('EXECUTIVE CLINICAL QUALITY, REVENUE & CAPACITY ANALYTICS REPORT', 14, 18);

    doc.setFontSize(8);
    doc.text(`DATE: ${new Date(report.generatedAt).toLocaleDateString()} | HORIZON: ${report.filter.timeHorizon.toUpperCase()}`, 135, 18);

    // 2. Hospital Details Block
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Facility: ${report.hospitalName} (${report.facilityCode})`, 14, 34);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Scope: Department [${report.filter.department.toUpperCase()}] | Encounter Type [${report.filter.encounterType.toUpperCase()}]`, 14, 39);
    doc.text(
      'Data provenance: supplied report projection. This export does not assert regulatory certification.',
      14,
      44
    );

    // 3. Executive KPI Summary Table
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('1. Executive Key Performance Indicators (KPIs)', 14, 52);

    const kpiRows = report.summaryCards.map((k) => [
      k.title,
      `${k.value} ${k.unit || ''}`,
      `${k.changePercent > 0 ? '+' : ''}${k.changePercent}%`,
      k.benchmark || 'N/A',
      k.category.toUpperCase(),
    ]);

    autoTable(doc, {
      startY: 55,
      head: [['Key Performance Indicator', 'Current Value', 'Variance', 'Target Benchmark', 'Domain']],
      body: kpiRows,
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      margin: { left: 14, right: 14 },
    });

    // 4. Department Revenue & Financial Collections
    const finalY1 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY || 100;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('2. Department-Wise Revenue & Fiscal Performance', 14, finalY1 + 10);

    const revRows = report.revenueByDept.map((r) => [
      r.department,
      `$${(r.grossBilled / 1000).toLocaleString()}k`,
      `$${(r.netCollected / 1000).toLocaleString()}k`,
      `${r.collectionRate}%`,
      `${r.operatingMargin}%`,
      `${r.shareOfTotalRevenue}%`,
    ]);

    autoTable(doc, {
      startY: finalY1 + 13,
      head: [['Department', 'Gross Billed', 'Net Collections', 'Collection Rate', 'Margin', 'Revenue Share']],
      body: revRows,
      theme: 'striped',
      headStyles: { fillColor: [5, 150, 105], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      margin: { left: 14, right: 14 },
    });

    // 5. Clinical Readmission Rates & Average Length of Stay
    const finalY2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY || 180;
    
    // Check if new page needed
    if (finalY2 > 210) {
      doc.addPage();
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('3. Clinical Quality: 30-Day Readmissions & Average Length of Stay (ALOS)', 14, 20);

      const qualityRows = report.readmissionsByDept.map((r) => {
        const matchingAlos = report.alosByDept.find((a) => a.department.toLowerCase().includes(r.department.toLowerCase()));
        return [
          r.department,
          `${r.readmissionRate}%`,
          `${r.targetBenchmark}%`,
          matchingAlos ? `${matchingAlos.alos} days` : '4.1 days',
          matchingAlos ? `${matchingAlos.benchmark} days` : '4.6 days',
          r.riskLevel,
        ];
      });

      autoTable(doc, {
        startY: 24,
        head: [['Department', '30-Day Readmit %', 'CMS Benchmark %', 'ALOS', 'Target ALOS', 'Risk Level']],
        body: qualityRows,
        theme: 'grid',
        headStyles: { fillColor: [147, 51, 234], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        margin: { left: 14, right: 14 },
      });
    } else {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('3. Clinical Quality: 30-Day Readmissions & Average Length of Stay (ALOS)', 14, finalY2 + 10);

      const qualityRows = report.readmissionsByDept.map((r) => {
        const matchingAlos = report.alosByDept.find((a) => a.department.toLowerCase().includes(r.department.toLowerCase()));
        return [
          r.department,
          `${r.readmissionRate}%`,
          `${r.targetBenchmark}%`,
          matchingAlos ? `${matchingAlos.alos} days` : '4.1 days',
          matchingAlos ? `${matchingAlos.benchmark} days` : '4.6 days',
          r.riskLevel,
        ];
      });

      autoTable(doc, {
        startY: finalY2 + 13,
        head: [['Department', '30-Day Readmit %', 'CMS Benchmark %', 'ALOS', 'Target ALOS', 'Risk Level']],
        body: qualityRows,
        theme: 'grid',
        headStyles: { fillColor: [147, 51, 234], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        margin: { left: 14, right: 14 },
      });
    }

    // Footer on all pages
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `G-HIMS OS Enterprise Analytics | Page ${i} of ${pageCount} | Strictly Confidential Healthcare Information`,
        14,
        290
      );
    }

    doc.save(filename);
  } catch (err) {
    console.error('Failed to generate PDF with jspdf-autotable, falling back to window.print', err);
    window.print();
  }
}
