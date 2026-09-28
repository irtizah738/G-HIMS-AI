import { AuditLogEntry, ChainVerificationResult } from '@/lib/audit/logger';

export interface GenerateAuditPdfOptions {
  logs: AuditLogEntry[];
  tenantId: string;
  verificationResult: ChainVerificationResult | null;
  logVerificationMap?: Record<string, 'VERIFIED' | 'MISMATCH' | 'UNVERIFIED'>;
  activeFilters?: {
    action?: string;
    status?: string;
    roles?: string[];
    searchQuery?: string;
  };
  filenameSuffix?: string;
}

export async function generateAuditPdfReport({
  logs,
  tenantId,
  verificationResult,
  logVerificationMap = {},
  activeFilters,
  filenameSuffix = '',
}: GenerateAuditPdfOptions) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = 297;
  const pageHeight = 210;
  const hashAttestationAvailable =
    logs.length > 0 &&
    logs.every((log) => Boolean(log.hash && log.previousHash && log.authoritative !== false));

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('GLOBAL HEALTH INFORMATION MANAGEMENT SYSTEM (G-HIMS)', 14, 9);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text('Server-Owned Audit Evidence Report — No Regulatory Certification Implied', 14, 15);

  const dateStr = new Date().toLocaleString();
  doc.setFontSize(7.5);
  doc.text(
    `Tenant: ${tenantId.toUpperCase()}   |   Generated: ${dateStr}   |   Records: ${logs.length}`,
    14,
    20
  );

  const boxY = 26;
  const boxHeight = 20;
  doc.setFillColor(hashAttestationAvailable ? 240 : 255, hashAttestationAvailable ? 253 : 251, hashAttestationAvailable ? 244 : 235);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, boxY, pageWidth - 28, boxHeight, 2, 2, 'FD');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(
    hashAttestationAvailable
      ? verificationResult?.isValid
        ? 'Hash verification passed for the loaded records'
        : 'Hash verification requires review'
      : 'Cryptographic chain attestation is not implemented for these durable audit records',
    18,
    boxY + 7
  );
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(
    'This export is repository evidence only. It does not certify HIPAA, ISO 27001, retention, SIEM delivery, or tamper-proof storage.',
    18,
    boxY + 14
  );

  const filterDesc = [
    activeFilters?.action && activeFilters.action !== 'ALL' ? `Action: ${activeFilters.action}` : null,
    activeFilters?.status && activeFilters.status !== 'ALL' ? `Status: ${activeFilters.status}` : null,
    activeFilters?.roles?.length ? `Roles: ${activeFilters.roles.join(', ')}` : null,
    activeFilters?.searchQuery ? `Search: "${activeFilters.searchQuery}"` : null,
  ].filter(Boolean).join(' • ') || 'All loaded tenant audit records';

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text(`Active Scope: ${filterDesc}`, 14, 51);

  const tableData = logs.map((log, index) => {
    const status = logVerificationMap[log.id] || 'UNVERIFIED';
    const timeFormatted = new Date(log.timestamp).toLocaleString();
    const hashDisplay = log.hash
      ? `${log.hash.substring(0, 10)}...${log.hash.substring(Math.max(0, log.hash.length - 6))}`
      : 'Not attested';

    return [
      String(index + 1),
      timeFormatted,
      `${log.userName}\n(${log.userId})`,
      log.userRole || 'Staff',
      log.action,
      log.resource,
      log.status,
      status,
      hashDisplay,
    ];
  });

  autoTable(doc, {
    startY: 54,
    head: [[
      '#',
      'Timestamp',
      'Actor / User ID',
      'Role / Dept',
      'Action',
      'Resource Target',
      'Status',
      'Hash Evidence',
      'Record Hash',
    ]],
    body: tableData,
    theme: 'grid',
    styles: {
      fontSize: 6.8,
      cellPadding: 1.6,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.2,
      halign: 'left',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 26 },
      2: { cellWidth: 32 },
      3: { cellWidth: 25 },
      4: { cellWidth: 28 },
      5: { cellWidth: 44 },
      6: { cellWidth: 24, halign: 'center' },
      7: { cellWidth: 25, halign: 'center' },
      8: { cellWidth: 57, font: 'courier' },
    },
    didDrawPage: (data) => {
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.setDrawColor(226, 232, 240);
      doc.line(14, pageHeight - 10, pageWidth - 14, pageHeight - 10);
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text(
        'CONFIDENTIAL AUDIT EVIDENCE • NO REGULATORY OR CRYPTOGRAPHIC-CHAIN CERTIFICATION IMPLIED',
        14,
        pageHeight - 6
      );
      doc.text(`Page ${data.pageNumber} of ${pageCount}`, pageWidth - 14, pageHeight - 6, { align: 'right' });
    },
  });

  const filename = `Audit_Evidence_Report_${tenantId}${filenameSuffix ? `_${filenameSuffix}` : ''}_${Date.now()}.pdf`;
  doc.save(filename);
}
