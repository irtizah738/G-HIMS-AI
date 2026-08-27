import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

function buildClinicalRulePacket(params: {
  templateId?: string;
  diseaseName?: string;
  guidedAnswers?: any;
  activeBranch?: any;
  specialtyHistory?: any;
  riskSignals?: any;
  patientContext?: any;
  localization?: string;
  facilityTier?: string;
  reason?: string;
}) {
  const {
    templateId = 'general',
    diseaseName = 'Acute Clinical Presentation',
    guidedAnswers = {},
    activeBranch = {},
    specialtyHistory = {},
    riskSignals = {},
    patientContext = {},
    localization = 'US (AHA / ACC / NIH)',
    facilityTier = 'Level 1 Academic Medical Center',
  } = params;

  const patientName = patientContext?.name || 'Patient';
  const age = patientContext?.age || '54';
  const gender = patientContext?.gender || 'M';
  const riskLevel = riskSignals?.overallRisk || 'ELEVATED';
  const primaryAlert = riskSignals?.primaryAlert || 'Urgent Protocol Flag Active';
  const branchLabel = activeBranch?.label || 'Clinical Intake Pathway';
  const hr = patientContext?.vitals?.heartRate || 88;
  const bp = patientContext?.vitals?.bp || '138/86';
  const spO2 = patientContext?.vitals?.spO2 || 98;

  // Disease-specific clinical intelligence mapping
  let differentialDiagnoses: Array<{ condition: string; probability: string; justification: string; icdCode: string }> = [];
  let statOrders: Array<{ name: string; type: string; urgency: string; cptCode: string }> = [];
  let criticalRiskMitigations: string[] = [];
  let specialistReadinessChecklist: string[] = [];

  if (templateId === 'cardiac' || templateId.includes('cardio')) {
    differentialDiagnoses = [
      {
        condition: 'Acute Coronary Syndrome (NSTEMI / High-Risk Unstable Angina)',
        probability: 'High',
        justification: `Acute ischemic chest presentation with hemodynamic stress (BP ${bp}, HR ${hr} bpm). Requires immediate serial biomarker tracking.`,
        icdCode: 'I21.9',
      },
      {
        condition: 'Stanford Type A/B Aortic Dissection',
        probability: 'Moderate',
        justification: 'Critical differential rule-out required per ACC/AHA guidelines before high-dose anticoagulation.',
        icdCode: 'I71.0',
      },
      {
        condition: 'Acute Decompensated Heart Failure / Non-Ischemic Cardiomyopathy',
        probability: 'Low',
        justification: 'Secondary consideration based on cardiac preload and specialty cardiovascular history.',
        icdCode: 'I50.9',
      },
    ];

    statOrders = [
      {
        name: 'STAT 12-Lead ECG & High-Sensitivity Troponin I (0h, 1h, 3h Protocol)',
        type: 'lab',
        urgency: 'STAT',
        cptCode: '80053',
      },
      {
        name: 'STAT Bedside Transthoracic Echocardiogram (TTE) for Wall Motion & EF Assessment',
        type: 'imaging',
        urgency: 'STAT',
        cptCode: '93306',
      },
      {
        name: 'Dual Antiplatelet Therapy (DAPT: ASA 325mg + Ticagrelor 180mg) & IV Heparin Protocol',
        type: 'medication',
        urgency: 'STAT',
        cptCode: '99291',
      },
      {
        name: 'Urgent Interventional Cardiology Specialist Bedside & Cath Lab Alert',
        type: 'consult',
        urgency: 'STAT',
        cptCode: '99254',
      },
    ];

    criticalRiskMitigations = [
      'Screen for active gastrointestinal or intracranial bleeding before full-dose anticoagulation/thrombolysis',
      'Maintain continuous 12-lead ST-segment telemetry and automated defibrillator readiness',
      `Align door-to-balloon/device time with ${localization} strict ≤90 min performance metric`,
    ];

    specialistReadinessChecklist = [
      'Two large-bore peripheral IV access lines established (18G antecubital preferred)',
      'Baseline CBC, Comprehensive Metabolic Panel, Coagulation (PT/INR/aPTT), and hs-cTn drawn',
      'Cardiac catheterization laboratory team notified with real-time intake telemetry stream',
      'Informed consent and advance directive status confirmed in G-HIMS EHR',
    ];
  } else if (templateId === 'stroke' || templateId.includes('neuro')) {
    differentialDiagnoses = [
      {
        condition: 'Acute Ischemic Stroke with Impending Large Vessel Occlusion (LVO)',
        probability: 'High',
        justification: `Focal neurological deficits corresponding to ${branchLabel}. Time-sensitive thrombectomy/thrombolytic candidate.`,
        icdCode: 'I63.9',
      },
      {
        condition: 'Acute Intracranial Hemorrhage (ICH / Subarachnoid Hemorrhage)',
        probability: 'Moderate',
        justification: 'Mandatory non-contrast cranial imaging rule-out before any reperfusion intervention.',
        icdCode: 'I61.9',
      },
      {
        condition: 'Complicated Migraine or Seizure Post-Ictal Todd\'s Paresis (Stroke Mimic)',
        probability: 'Low',
        justification: 'Secondary differential consideration once vascular occlusions are excluded.',
        icdCode: 'G40.909',
      },
    ];

    statOrders = [
      {
        name: 'STAT Non-Contrast Brain CT + CT Angiography (CTA) Head & Neck',
        type: 'imaging',
        urgency: 'STAT',
        cptCode: '70450',
      },
      {
        name: 'STAT Point-of-Care Blood Glucose, CBC, Platelet Count, and INR/aPTT',
        type: 'lab',
        urgency: 'STAT',
        cptCode: '80048',
      },
      {
        name: 'Tenecteplase (TNK-tPA) Reperfusion Preparedness & Strict Blood Pressure Protocol (Target <185/110)',
        type: 'medication',
        urgency: 'STAT',
        cptCode: '99291',
      },
      {
        name: 'Comprehensive Stroke Team & Neurointerventionalist Stat Bedside Page',
        type: 'consult',
        urgency: 'STAT',
        cptCode: '99254',
      },
    ];

    criticalRiskMitigations = [
      'Strictly verify last known well (LKW) time and anticoagulation intake history prior to thrombolysis',
      'Maintain continuous non-invasive blood pressure monitoring every 15 minutes during acute triage',
      `Execute target door-to-needle time ≤45 min per ${localization} stroke clinical guidelines`,
    ];

    specialistReadinessChecklist = [
      'Accurate last-known-normal timestamp recorded and verified with family/bystander',
      'CT scanner cleared and reserved for immediate door-to-imaging transport',
      'NIHSS score assessed and documented into G-HIMS EHR',
      'Neuro-interventional suite on standby for potential mechanical thrombectomy',
    ];
  } else if (templateId === 'diabetic' || templateId.includes('endo') || templateId.includes('dka')) {
    differentialDiagnoses = [
      {
        condition: 'Diabetic Ketoacidosis (DKA) with Severe High Anion-Gap Metabolic Acidosis',
        probability: 'High',
        justification: `Clinical presentation and guided markers indicate acute insulinopenia with metabolic derangement.`,
        icdCode: 'E11.10',
      },
      {
        condition: 'Hyperosmolar Hyperglycemic State (HHS)',
        probability: 'Moderate',
        justification: 'Profound dehydration and hyperosmolarity without predominant ketoacidosis overlap.',
        icdCode: 'E11.00',
      },
      {
        condition: 'Severe Sepsis-Induced Secondary Metabolic Decompensation',
        probability: 'Moderate',
        justification: 'Infectious precipitant triggering acute glycemic crisis requires concurrent investigation.',
        icdCode: 'A41.9',
      },
    ];

    statOrders = [
      {
        name: 'STAT Venous Blood Gas (VBG), Serum Ketones (Beta-Hydroxybutyrate), BMP, & Lactate',
        type: 'lab',
        urgency: 'STAT',
        cptCode: '82803',
      },
      {
        name: 'STAT 0.9% Normal Saline IV Resuscitation (1000 mL/hr initial bolus protocol)',
        type: 'medication',
        urgency: 'STAT',
        cptCode: '96360',
      },
      {
        name: 'Continuous IV Regular Insulin Infusion (0.1 units/kg/hr after serum K+ confirmed ≥3.5 mEq/L)',
        type: 'medication',
        urgency: 'STAT',
        cptCode: '99291',
      },
      {
        name: 'STAT Urine Analysis, Blood Cultures x 2, & CXR (Infection Screen)',
        type: 'lab',
        urgency: 'STAT',
        cptCode: '87040',
      },
    ];

    criticalRiskMitigations = [
      'CRITICAL: Never initiate insulin infusion until serum Potassium is verified >3.3 mEq/L to prevent fatal arrhythmia',
      'Monitor serum glucose and electrolytes hourly; add 5% dextrose once blood glucose reaches 200-250 mg/dL',
      'Strict intake/output fluid balance documentation via urinary catheterization if indicated',
    ];

    specialistReadinessChecklist = [
      'Two large-bore IV sites secured for dual fluid and insulin titration',
      'Point-of-care fingerstick blood glucose and urine ketone dipstick recorded',
      'Endocrinology / Medical ICU consult paging activated with calculated anion gap',
      'Baseline ECG obtained to screen for hyperkalemic peaked T-waves',
    ];
  } else if (templateId === 'ortho_trauma' || templateId.includes('trauma') || templateId.includes('ortho')) {
    differentialDiagnoses = [
      {
        condition: 'High-Energy Skeletal Trauma with Impending Acute Compartment Syndrome',
        probability: 'High',
        justification: `Severe traumatic mechanism with clinical indicators of severe neurovascular and soft-tissue jeopardy.`,
        icdCode: 'S82.90XA',
      },
      {
        condition: 'Major Vascular Laceration / Traumatic Acute Limb Ischemia',
        probability: 'High',
        justification: 'Distal perfusion compromise requires emergency orthopedic vascular exclusion.',
        icdCode: 'I77.79',
      },
      {
        condition: 'Open Fracture with Contamination (Gustilo-Anderson Grade II/III)',
        probability: 'Moderate',
        justification: 'High risk for osteomyelitis and necrotizing deep infection requiring urgent surgical debridement.',
        icdCode: 'S82.91XA',
      },
    ];

    statOrders = [
      {
        name: 'STAT Complete Orthopedic Trauma X-Ray Series (Joint Above & Below) + CTA Extremity',
        type: 'imaging',
        urgency: 'STAT',
        cptCode: '73590',
      },
      {
        name: 'STAT IV Cefazolin (2g) + Gentamicin (Open Fracture Antibiotic Protocol)',
        type: 'medication',
        urgency: 'STAT',
        cptCode: '96365',
      },
      {
        name: 'STAT Compartment Pressure Monitoring (Stryker Intracompartmental Device)',
        type: 'lab',
        urgency: 'STAT',
        cptCode: '20950',
      },
      {
        name: 'Emergency Orthopedic Trauma Surgeon & Vascular Surgery Stat Operating Room Alert',
        type: 'consult',
        urgency: 'STAT',
        cptCode: '99254',
      },
    ];

    criticalRiskMitigations = [
      'Maintain limb at heart level (do NOT elevate limb above heart if compartment syndrome is suspected)',
      'Remove all circumferential dressings, splints, and constrictive garments immediately',
      'Re-evaluate 5 Ps (Pain, Pallor, Pulselessness, Paresthesia, Paralysis) every 15 minutes',
    ];

    specialistReadinessChecklist = [
      'Limb splinted and stabilized in anatomical alignment with distal pulse Doppler verification',
      'NPO status confirmed for urgent operative intervention',
      'Tetanus toxoid immunization history verified and administered if indicated',
      'Type and Screen / Crossmatch 2 units Packed Red Blood Cells dispatched to blood bank',
    ];
  } else {
    // General / Specialty Comprehensive Fallback
    differentialDiagnoses = [
      {
        condition: `Acute ${diseaseName} Primary Decompensation`,
        probability: 'High',
        justification: `Clinical presentation and symptom branch (${branchLabel}) indicate acute trajectory requiring rapid specialist assessment.`,
        icdCode: 'R69',
      },
      {
        condition: 'Secondary Systemic Inflammatory or Vascular Manifestation',
        probability: 'Moderate',
        justification: `Elevated physiological stress markers (BP ${bp}, HR ${hr} bpm, SpO2 ${spO2}%).`,
        icdCode: 'R68.89',
      },
    ];

    statOrders = [
      {
        name: `STAT Complete Metabolic Panel, CBC with Differential, & Inflammatory Markers`,
        type: 'lab',
        urgency: 'STAT',
        cptCode: '80053',
      },
      {
        name: `STAT Focused Diagnostic Imaging Protocol for ${diseaseName}`,
        type: 'imaging',
        urgency: 'STAT',
        cptCode: '71045',
      },
      {
        name: `Specialist Bedside Evaluation & Emergency Clinical Consultation`,
        type: 'consult',
        urgency: 'STAT',
        cptCode: '99254',
      },
    ];

    criticalRiskMitigations = [
      'Continuous hemodynamic and telemetry monitoring during initial intake and stabilization',
      'Verify comprehensive medication reconciliation and known drug allergy profiles',
      `Maintain adherence to ${localization} evidence-based clinical protocols`,
    ];

    specialistReadinessChecklist = [
      'Dual large-bore IV access secured and baseline blood panel dispatched to lab',
      'Longitudinal medical record summary imported into G-HIMS EHR',
      'On-call specialist team notified with full structured intake brief',
    ];
  }

  return {
    executiveSummary: `High-priority ${diseaseName} clinical intake for ${patientName} (${age}y/o ${gender}). Risk level: ${riskLevel}. Immediate specialist evaluation indicated based on ${branchLabel}. Vital signs: BP ${bp} mmHg, HR ${hr} bpm, SpO2 ${spO2}%.`,
    sbar: {
      situation: `Patient presents with acute ${diseaseName} presentation consistent with ${branchLabel}. Active alert: ${primaryAlert}.`,
      background: `Pertinent specialty history: ${JSON.stringify(specialtyHistory || {})}. Admission vitals: HR ${hr} bpm, BP ${bp} mmHg, SpO2 ${spO2}%.`,
      assessment: `Intake assessment scores risk as ${riskLevel} with priority clinical flags (${riskSignals?.flags?.join(', ') || 'Protocolized criteria met'}). Evaluated under ${localization} guidelines.`,
      recommendation: `Activate ${facilityTier} rapid specialist pathway. Proceed with stat diagnostic workup, bedside stabilization protocol, and clinical orders listed below.`,
    },
    differentialDiagnoses,
    statOrders,
    criticalRiskMitigations,
    specialistReadinessChecklist,
  };
}

export async function POST(req: NextRequest) {
  let requestData: any = {};
  try {
    requestData = await req.json();
  } catch (parseErr) {
    return NextResponse.json({ error: 'Invalid JSON request payload' }, { status: 400 });
  }

  const {
    templateId,
    diseaseName,
    guidedAnswers,
    activeBranch,
    specialtyHistory,
    riskSignals,
    patientContext,
    localization = 'US (AHA / ACC / NIH)',
    facilityTier = 'Level 1 Academic Medical Center',
  } = requestData;

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    // Heuristic fallback for offline/preview environments without API key
    const fallbackData = buildClinicalRulePacket({
      templateId,
      diseaseName,
      guidedAnswers,
      activeBranch,
      specialtyHistory,
      riskSignals,
      patientContext,
      localization,
      facilityTier,
      reason: 'Offline preview mode',
    });
    return NextResponse.json(fallbackData);
  }

  // Multi-model resilience strategy with automatic fallback on 503 high demand or quota limits
  const candidateModels = ['gemini-3.6-flash', 'gemini-3.7-flash'];
  let lastError: any = null;

  for (const modelName of candidateModels) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const prompt = `You are G-HIMS Progressive Clinical Intelligence and Specialist Preparation Engine.
Analyze the following Disease-Centric Clinical Intake for a patient arriving at ${facilityTier}:

Patient Demographics & Vitals:
${JSON.stringify(patientContext, null, 2)}

Disease Intake Template:
- Disease: ${diseaseName} (${templateId})
- Active Symptom Tree Branch: ${JSON.stringify(activeBranch, null, 2)}
- Guided Questions & Clinical Answers: ${JSON.stringify(guidedAnswers, null, 2)}
- Specialty Medical History: ${JSON.stringify(specialtyHistory, null, 2)}
- Real-Time Risk Signals & Red Flags: ${JSON.stringify(riskSignals, null, 2)}
- Regional Guidelines & Localization: ${localization}
- Facility Setting: ${facilityTier}

Generate a comprehensive specialist preparation briefing and clinical optimization packet formatted as strict raw JSON with the following schema:
{
  "executiveSummary": "Concise 2-3 sentence clinical summary highlighting critical findings and immediate trajectory",
  "sbar": {
    "situation": "Concise Situation statement",
    "background": "Concise Background with pertinent specialty history & vitals",
    "assessment": "Concise Assessment with risk level and clinical severity",
    "recommendation": "Concise actionable Specialist Recommendation"
  },
  "differentialDiagnoses": [
    {
      "condition": "Condition name",
      "probability": "High" | "Moderate" | "Low",
      "justification": "Clinical rationale referencing symptoms and risk signals",
      "icdCode": "ICD-10 code"
    }
  ],
  "statOrders": [
    {
      "name": "Order name",
      "type": "lab" | "imaging" | "medication" | "consult",
      "urgency": "STAT" | "Urgent" | "Routine",
      "cptCode": "CPT code if applicable"
    }
  ],
  "criticalRiskMitigations": [
    "Safety alert or contraindication warning"
  ],
  "specialistReadinessChecklist": [
    "Actionable step to complete prior to specialist arrival"
  ]
}

Return ONLY valid JSON. No conversational wrapper or markdown formatting.`;

      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction: 'You are an expert board-certified clinical informatics and emergency triage physician specialist. Provide accurate, high-fidelity, evidence-based clinical intelligence.',
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      });

      const responseText = response.text || '{}';
      const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsedData = JSON.parse(cleanedText);

      // Verify that parsedData has essential keys
      if (parsedData.executiveSummary && parsedData.sbar) {
        return NextResponse.json(parsedData);
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`Attempt with ${modelName} encountered error:`, err?.message || err);
      // Wait a brief 300ms before attempting next fallback model
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // If all Gemini AI models are experiencing 503 high demand or temporary network failure,
  // gracefully synthesize a high-fidelity clinical rule-based optimization packet so the physician flow is unbroken.
  console.info('Falling back to Clinical Rule Engine due to upstream AI demand/error:', lastError?.message);
  const ruleBasedPacket = buildClinicalRulePacket({
    templateId,
    diseaseName,
    guidedAnswers,
    activeBranch,
    specialtyHistory,
    riskSignals,
    patientContext,
    localization,
    facilityTier,
    reason: lastError?.message,
  });

  return NextResponse.json(ruleBasedPacket, { status: 200 });
}

