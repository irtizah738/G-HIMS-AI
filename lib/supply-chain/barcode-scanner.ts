// ============================================================================
// G-HIMS Master SCM: Healthcare Barcode & QR Code Parser Engine
// Compliant with GS1-128, GS1 DataMatrix, and Hospital Internal Formats
// ============================================================================

export interface ParsedBarcodeResult {
  raw: string;
  format: 'GS1_COMPLEX' | 'INTERNAL_QR' | 'PLAIN_SKU' | 'UNKNOWN';
  gtin?: string;
  batchNumber?: string;
  expiryDate?: string; // ISO format YYYY-MM-DD
  serialNumber?: string;
  itemCode?: string;
  quantity?: number;
  udi?: string;
  isValid: boolean;
}

/**
 * Parses GS1 Application Identifier strings such as:
 * (01)00847291048291(17)261231(10)LOT-9921A(21)SN-48201
 * or 01008472910482911726123110LOT-9921A
 */
export function parseHealthcareBarcode(rawInput: string): ParsedBarcodeResult {
  const clean = rawInput.trim();
  if (!clean) {
    return { raw: rawInput, format: 'UNKNOWN', isValid: false };
  }

  // 1. Hospital internal structured barcode (itemCode:batch:expiry:qty)
  if (clean.includes(':')) {
    const parts = clean.split(':');
    return {
      raw: clean,
      format: 'INTERNAL_QR',
      itemCode: parts[0] || undefined,
      batchNumber: parts[1] || undefined,
      expiryDate: parts[2] || undefined,
      quantity: parts[3] ? parseInt(parts[3], 10) : 1,
      isValid: Boolean(parts[0]),
    };
  }

  // 2. Parenthesized GS1 format (01)...(17)...(10)...(21)...
  if (clean.includes('(01)') || clean.includes('(17)') || clean.includes('(10)')) {
    let gtin: string | undefined;
    let expiry: string | undefined;
    let batch: string | undefined;
    let serial: string | undefined;

    const gtinMatch = clean.match(/\(01\)(\d{14})/);
    if (gtinMatch) gtin = gtinMatch[1];

    const expMatch = clean.match(/\(17\)(\d{6})/);
    if (expMatch) {
      // YYMMDD -> YYYY-MM-DD
      const rawExp = expMatch[1];
      const yy = parseInt(rawExp.substring(0, 2), 10);
      const mm = rawExp.substring(2, 4);
      const dd = rawExp.substring(4, 6);
      const year = yy >= 50 ? 1900 + yy : 2000 + yy;
      expiry = `${year}-${mm}-${dd}`;
    }

    const batchMatch = clean.match(/\(10\)([A-Za-z0-9\-_]+)/);
    if (batchMatch) batch = batchMatch[1];

    const serialMatch = clean.match(/\(21\)([A-Za-z0-9\-_]+)/);
    if (serialMatch) serial = serialMatch[1];

    return {
      raw: clean,
      format: 'GS1_COMPLEX',
      gtin,
      batchNumber: batch,
      expiryDate: expiry,
      serialNumber: serial,
      udi: clean,
      isValid: Boolean(gtin || batch),
    };
  }

  // 3. Raw GS1 concatenated stream starting with 01
  if (clean.startsWith('01') && clean.length >= 16) {
    const gtin = clean.substring(2, 16);
    let rest = clean.substring(16);
    let expiry: string | undefined;
    let batch: string | undefined;

    if (rest.startsWith('17') && rest.length >= 8) {
      const rawExp = rest.substring(2, 8);
      const yy = parseInt(rawExp.substring(0, 2), 10);
      const mm = rawExp.substring(2, 4);
      const dd = rawExp.substring(4, 6);
      const year = yy >= 50 ? 1900 + yy : 2000 + yy;
      expiry = `${year}-${mm}-${dd}`;
      rest = rest.substring(8);
    }

    if (rest.startsWith('10')) {
      batch = rest.substring(2);
    }

    return {
      raw: clean,
      format: 'GS1_COMPLEX',
      gtin,
      expiryDate: expiry,
      batchNumber: batch,
      udi: clean,
      isValid: true,
    };
  }

  // 4. Fallback: standard SKU / Item Code / GTIN
  return {
    raw: clean,
    format: 'PLAIN_SKU',
    itemCode: clean,
    isValid: clean.length > 0,
  };
}
