import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      tenantId,
      purchaseOrders = [],
      suppliers = [],
      currentDate = new Date().toISOString(),
    } = body;

    const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
    if (!normalizedTenantId) {
      return NextResponse.json({ success: false, error: 'tenantId is required.' }, { status: 400 });
    }

    const { context } = await deriveAuthoritativeContext(req, normalizedTenantId);
    const allowedRoles = new Set([
      'SYSTEM_ADMIN',
      'SUPER_ADMIN',
      'ADMINISTRATOR',
      'HOSPITAL_ADMIN',
      'SUPPLY_CHAIN_MANAGER',
      'PROCUREMENT_MANAGER',
      'PHARMACY_MANAGER',
      'PHARMACIST',
      'FINANCE_MANAGER',
    ]);

    if (!context.roles.some((role) => allowedRoles.has(role))) {
      return NextResponse.json(
        { success: false, error: 'Supply-chain analytics role required.' },
        { status: 403 }
      );
    }

    // Determine heuristic summary if no API key or in case of fallback
    const heuristicAnalysis = generateHeuristicAnalysis(purchaseOrders, suppliers, currentDate);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        success: true,
        isAiGenerated: false,
        source: 'HEURISTIC_ALGORITHM',
        ...heuristicAnalysis,
      });
    }

    const candidateModels = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'];
    let aiResponse: any = null;

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

        const prompt = `You are the G-HIMS Hospital Chief Supply Chain Officer (CSCO) & AI Logistics Intelligence Copilot.
Analyze these Active Purchase Orders for the current week and evaluate upcoming critical delivery risks:

Current Date: ${currentDate}
Active Purchase Orders:
${JSON.stringify(
  purchaseOrders.map((po: any) => ({
    poNumber: po.poNumber,
    supplierName: po.supplierName,
    expectedDeliveryDate: po.expectedDeliveryDate,
    status: po.status,
    totalAmount: po.totalAmount,
    isEmergency: po.isEmergency,
    items: po.items?.map((it: any) => ({
      name: it.itemName || it.description || it.itemCode,
      qty: it.quantityOrdered,
      unitPrice: it.unitPrice,
    })),
  })),
  null,
  2
)}

Supplier Reliability Profiles:
${JSON.stringify(
  suppliers.map((s: any) => ({
    name: s.displayName || s.legalName,
    onTimeDeliveryRate: s.scorecard?.onTimeDeliveryRatePercent,
    fillRate: s.scorecard?.fillRatePercent,
    riskLevel: s.riskLevel,
  })),
  null,
  2
)}

Task:
Produce a comprehensive risk analysis for upcoming deliveries this week. Highlight items with cold-chain, surgical, or vital medication exposure.
Return ONLY a valid JSON object (no markdown, no backticks, no wrapping text) with EXACTLY this structure:
{
  "riskLevel": "CRITICAL" | "ELEVATED" | "NOMINAL",
  "headline": "Short punchy risk summary headline (under 8 words)",
  "executiveSummary": "2-3 sentences summarizing total commitments, on-time certainty, and imminent bottleneck areas.",
  "totalWeeklyOrders": number,
  "totalWeeklyValue": number,
  "highRiskOrdersCount": number,
  "criticalDeliveryRisks": [
    {
      "poNumber": "PO-XXXX",
      "supplierName": "Supplier Name",
      "expectedDate": "YYYY-MM-DD",
      "severity": "CRITICAL" | "HIGH" | "MEDIUM",
      "riskType": "DELAY_RISK" | "COLD_CHAIN_RISK" | "DISRUPTION" | "VENDOR_CAPACITY",
      "impactSummary": "Clinical impact description (e.g., ICU ventilator tubing or antibiotic stockout)",
      "recommendedMitigation": "Specific actionable countermeasure"
    }
  ],
  "keyTakeaways": [
    "High-impact takeaway point 1",
    "High-impact takeaway point 2",
    "High-impact takeaway point 3"
  ],
  "mitigationProtocols": [
    "Immediate protocol action 1",
    "Immediate protocol action 2"
  ]
}`;

        const res = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

        const rawText = res.text?.trim() || '';
        const cleanedText = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        aiResponse = JSON.parse(cleanedText);
        if (aiResponse && aiResponse.keyTakeaways) {
          break;
        }
      } catch (modelErr) {
        console.warn(`Model ${modelName} call failed, trying next candidate:`, modelErr);
      }
    }

    if (aiResponse) {
      return NextResponse.json({
        success: true,
        isAiGenerated: true,
        source: 'GEMINI_AI',
        ...aiResponse,
      });
    }

    // Fallback to heuristic
    return NextResponse.json({
      success: true,
      isAiGenerated: false,
      source: 'HEURISTIC_ALGORITHM',
      ...heuristicAnalysis,
    });
  } catch (err: any) {
    console.error('Error generating supply chain summary:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to generate AI supply chain summary',
      },
      { status: 500 }
    );
  }
}

function generateHeuristicAnalysis(purchaseOrders: any[], suppliers: any[], currentDateStr: string) {
  const now = new Date(currentDateStr).getTime();
  const activePOs = purchaseOrders.filter((po) =>
    ['SUBMITTED', 'SENT', 'SENT_TO_SUPPLIER', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED', 'PENDING_APPROVAL'].includes(
      po.status
    )
  );

  const totalValue = activePOs.reduce((sum, po) => sum + (po.totalAmount || 0), 0);
  const risks: any[] = [];

  activePOs.forEach((po) => {
    const expDate = new Date(po.expectedDeliveryDate).getTime();
    const daysUntil = Math.ceil((expDate - now) / 86400000);
    const supplier = suppliers.find((s) => s.supplierId === po.supplierId || s.displayName === po.supplierName);
    const onTimeRate = supplier?.scorecard?.onTimeDeliveryRatePercent ?? 85;

    if (daysUntil < 0) {
      risks.push({
        poNumber: po.poNumber,
        supplierName: po.supplierName,
        expectedDate: po.expectedDeliveryDate?.split('T')[0] || 'Overdue',
        severity: 'CRITICAL',
        riskType: 'DELAY_RISK',
        impactSummary: `Delivery is ${Math.abs(daysUntil)} day(s) overdue. Threatens immediate clinical ward fulfillment.`,
        recommendedMitigation: 'Trigger immediate vendor expediting call and authorize interim stock transfer from Central Store.',
      });
    } else if (daysUntil <= 3 && onTimeRate < 90) {
      risks.push({
        poNumber: po.poNumber,
        supplierName: po.supplierName,
        expectedDate: po.expectedDeliveryDate?.split('T')[0] || 'Upcoming',
        severity: 'HIGH',
        riskType: 'VENDOR_CAPACITY',
        impactSummary: `Delivery due in ${daysUntil} day(s) with supplier historical on-time rate of only ${onTimeRate}%.`,
        recommendedMitigation: 'Require courier dispatch tracking number or initiate secondary local vendor contingency release.',
      });
    } else if (po.isEmergency) {
      risks.push({
        poNumber: po.poNumber,
        supplierName: po.supplierName,
        expectedDate: po.expectedDeliveryDate?.split('T')[0] || 'Upcoming',
        severity: 'CRITICAL',
        riskType: 'DISRUPTION',
        impactSummary: `Emergency STAT procurement for critical care operations. Delivery window is time-sensitive.`,
        recommendedMitigation: 'Activate receiving bay priority inspection dock and pre-clear receiving inspector.',
      });
    }
  });

  const riskLevel = risks.some((r) => r.severity === 'CRITICAL')
    ? 'CRITICAL'
    : risks.length > 0
    ? 'ELEVATED'
    : 'NOMINAL';

  return {
    riskLevel,
    headline:
      riskLevel === 'CRITICAL'
        ? 'Imminent Delivery Risk on Critical Care Lines'
        : riskLevel === 'ELEVATED'
        ? 'Moderate Delivery Delays Detected in Supply Pipeline'
        : 'All Active Purchase Orders Tracking on Schedule',
    executiveSummary: `Tracking ${activePOs.length} active weekly Purchase Orders totaling $${totalValue.toLocaleString()}. ${
      risks.length > 0
        ? `${risks.length} purchase order(s) exhibit high-risk delay vectors requiring operational intervention.`
        : 'All shipments currently align with supplier historical SLAs and expected hospital dock arrival windows.'
    }`,
    totalWeeklyOrders: activePOs.length,
    totalWeeklyValue: totalValue,
    highRiskOrdersCount: risks.length,
    criticalDeliveryRisks: risks,
    keyTakeaways: [
      `${activePOs.length} active purchase orders valued at $${totalValue.toLocaleString()} monitored for this week.`,
      risks.length > 0
        ? `${risks.length} order(s) require proactive expediting due to low vendor on-time scores or tight dock windows.`
        : 'No high-risk order was identified from the supplied purchase-order and supplier data.',
      'Cold-chain and vital surgical supplies prioritized for automated GRN dock put-away within 30 minutes of receipt.',
    ],
    mitigationProtocols: [
      'Issue automated SMS and EDI ping to logistics carrier for shipments due within 48 hours.',
      'Pre-allocate quarantine and cold-chain staging space at Receiving Dock A.',
      'Place standing safety stock reserve holds at Central Store for high-velocity ICU infusions.',
    ],
  };
}
