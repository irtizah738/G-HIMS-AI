/**
 * HL7 v2.x Message Parser & Encoder Engine
 * Zero-dependency parser for healthcare interoperability (LIS / RIS / EHR / PACS).
 * Supports standard HL7 delimiters:
 * Field (|), Component (^), Sub-Component (&), Repetition (~), Escape (\).
 */

export interface HL7Segment {
  name: string;
  fields: string[][][]; // segment[fieldIndex][repetitionIndex][componentIndex]
  raw: string;
}

export interface HL7Message {
  raw: string;
  delimiters: {
    field: string;
    component: string;
    repetition: string;
    escape: string;
    subcomponent: string;
  };
  segments: HL7Segment[];
  getSegments: (segmentName: string) => HL7Segment[];
  getSegment: (segmentName: string) => HL7Segment | undefined;
  getFieldValue: (segmentName: string, fieldIndex: number, componentIndex?: number) => string;
}

export interface ORU_R01_ObservationResult {
  testCode: string;
  testName: string;
  resultValue: string;
  units: string;
  referenceRange: string;
  abnormalFlags: string; // e.g. 'N' (Normal), 'H' (High), 'L' (Low), 'A' (Abnormal), 'C' (Critical)
  status: string; // e.g. 'F' (Final), 'P' (Preliminary), 'C' (Corrected)
  observationDateTime?: string;
  producerId?: string;
}

export interface ORU_R01_Data {
  messageControlId: string;
  sendingApplication: string;
  sendingFacility: string;
  messageDateTime: string;
  patientMrn: string;
  patientName: string;
  dateOfBirth?: string;
  gender?: string;
  visitNumber?: string;
  orderControl: string;
  placerOrderNumber?: string;
  fillerOrderNumber: string;
  diagnosticService?: string;
  observationDateTime: string;
  results: ORU_R01_ObservationResult[];
}

/**
 * Parses raw HL7 v2.x text into a queryable HL7Message structure.
 */
export function parseHL7(rawMessage: string): HL7Message {
  if (!rawMessage || typeof rawMessage !== 'string') {
    throw new Error('HL7 parser error: empty or invalid message string.');
  }

  // Normalize line endings (\r\n, \r, \n) to single newline split
  const cleanMessage = rawMessage.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleanMessage.split('\n').filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('HL7 parser error: no segments found.');
  }

  const mshLine = lines[0];
  if (!mshLine.startsWith('MSH')) {
    throw new Error('HL7 parser error: message must begin with MSH segment header.');
  }

  // Extract delimiters from MSH segment (e.g. MSH|^~\&|...)
  const fieldDelim = mshLine[3] || '|';
  const encodingChars = mshLine.substring(4, 8);
  const componentDelim = encodingChars[0] || '^';
  const repetitionDelim = encodingChars[1] || '~';
  const escapeChar = encodingChars[2] || '\\';
  const subcomponentDelim = encodingChars[3] || '&';

  const delimiters = {
    field: fieldDelim,
    component: componentDelim,
    repetition: repetitionDelim,
    escape: escapeChar,
    subcomponent: subcomponentDelim,
  };

  const parsedSegments: HL7Segment[] = lines.map((line) => {
    const rawSeg = line.trim();
    const segName = rawSeg.substring(0, 3).toUpperCase();

    let rawFields: string[];
    if (segName === 'MSH') {
      // For MSH, MSH-1 is the field separator itself, MSH-2 is encoding characters
      const remainder = rawSeg.substring(4);
      rawFields = ['MSH', fieldDelim, ...remainder.split(fieldDelim)];
    } else {
      rawFields = rawSeg.split(fieldDelim);
    }

    const fields: string[][][] = rawFields.map((fieldStr) => {
      // Split repetitions (~)
      const repetitions = fieldStr.split(repetitionDelim);
      return repetitions.map((rep) => {
        // Split components (^)
        return rep.split(componentDelim);
      });
    });

    return {
      name: segName,
      fields,
      raw: rawSeg,
    };
  });

  const getSegments = (segmentName: string) =>
    parsedSegments.filter((s) => s.name === segmentName.toUpperCase());

  const getSegment = (segmentName: string) =>
    parsedSegments.find((s) => s.name === segmentName.toUpperCase());

  const getFieldValue = (
    segmentName: string,
    fieldIndex: number,
    componentIndex: number = 0
  ): string => {
    const seg = getSegment(segmentName);
    if (!seg || !seg.fields[fieldIndex]) return '';
    const reps = seg.fields[fieldIndex];
    if (!reps || reps.length === 0) return '';
    const comps = reps[0];
    if (!comps || comps.length <= componentIndex) return '';
    return comps[componentIndex] || '';
  };

  return {
    raw: rawMessage,
    delimiters,
    segments: parsedSegments,
    getSegments,
    getSegment,
    getFieldValue,
  };
}

/**
 * Extracts structured Laboratory / Radiology observation result data
 * from parsed HL7 ORU^R01 message.
 */
export function extractORU_R01(parsed: HL7Message): ORU_R01_Data {
  // MSH Segments
  const msh = parsed.getSegment('MSH');
  const sendingApplication = parsed.getFieldValue('MSH', 3);
  const sendingFacility = parsed.getFieldValue('MSH', 4);
  const messageDateTime = parsed.getFieldValue('MSH', 7);
  const messageControlId = parsed.getFieldValue('MSH', 10) || `MSG_${Date.now()}`;

  // PID Segment (Patient Identification)
  // PID-3: Patient Identifier List (MRN)
  // PID-5: Patient Name (LastName^FirstName^MiddleName)
  // PID-7: Date/Time of Birth
  // PID-8: Administrative Sex
  let patientMrn = parsed.getFieldValue('PID', 3, 0);
  if (!patientMrn) {
    // Check if MRN is formatted in component 1
    const pid3Rep = msh ? parsed.getSegment('PID')?.fields[3] : undefined;
    if (pid3Rep && pid3Rep[0] && pid3Rep[0][0]) {
      patientMrn = pid3Rep[0][0];
    }
  }

  const lastName = parsed.getFieldValue('PID', 5, 0);
  const firstName = parsed.getFieldValue('PID', 5, 1);
  const patientName = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown Patient';
  const dateOfBirth = parsed.getFieldValue('PID', 7, 0);
  const gender = parsed.getFieldValue('PID', 8, 0);

  // PV1 Segment (Patient Visit)
  const visitNumber = parsed.getFieldValue('PV1', 19, 0);

  // OBR Segment (Observation Request)
  // OBR-4: Universal Service Identifier (Code^Name)
  // OBR-7: Observation Date/Time
  // OBR-2: Placer Order Number, OBR-3: Filler Order Number
  const orderControl = parsed.getFieldValue('ORC', 1, 0) || 'RE';
  const placerOrderNumber = parsed.getFieldValue('OBR', 2, 0);
  const fillerOrderNumber = parsed.getFieldValue('OBR', 3, 0) || `LIS-${Date.now()}`;
  const diagnosticService = parsed.getFieldValue('OBR', 4, 1) || parsed.getFieldValue('OBR', 4, 0) || 'Diagnostic Observation';
  const observationDateTime = parsed.getFieldValue('OBR', 7, 0) || messageDateTime || new Date().toISOString();

  // OBX Segments (Observation / Results)
  const obxSegments = parsed.getSegments('OBX');
  const results: ORU_R01_ObservationResult[] = obxSegments.map((obx) => {
    // OBX-3: Observation Identifier (Code^Name)
    // OBX-5: Observation Value
    // OBX-6: Units (e.g. mg/dL, mmol/L)
    // OBX-7: Reference Range (e.g. 70-99, 135-145)
    // OBX-8: Abnormal Flags (e.g. N, H, L, C, A)
    // OBX-11: Observation Result Status (F=Final, P=Preliminary)
    const testCode = obx.fields[3]?.[0]?.[0] || 'TEST';
    const testName = obx.fields[3]?.[0]?.[1] || testCode;
    const resultValue = obx.fields[5]?.[0]?.[0] || '';
    const units = obx.fields[6]?.[0]?.[0] || '';
    const referenceRange = obx.fields[7]?.[0]?.[0] || '';
    const abnormalFlags = obx.fields[8]?.[0]?.[0] || 'N';
    const status = obx.fields[11]?.[0]?.[0] || 'F';
    const obsTime = obx.fields[14]?.[0]?.[0] || observationDateTime;

    return {
      testCode,
      testName,
      resultValue,
      units,
      referenceRange,
      abnormalFlags,
      status,
      observationDateTime: obsTime,
    };
  });

  return {
    messageControlId,
    sendingApplication,
    sendingFacility,
    messageDateTime,
    patientMrn: patientMrn.trim(),
    patientName,
    dateOfBirth,
    gender,
    visitNumber,
    orderControl,
    placerOrderNumber,
    fillerOrderNumber,
    diagnosticService,
    observationDateTime,
    results,
  };
}

/**
 * Generates an HL7 v2.x standard Acknowledgement (ACK) message string
 * in response to an incoming message.
 */
export function generateACK(
  parsed: HL7Message,
  ackCode: 'AA' | 'AE' | 'AR' = 'AA',
  textMessage: string = 'Results Processed Successfully'
): string {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const sendingApp = parsed.getFieldValue('MSH', 3) || 'LIS';
  const sendingFacility = parsed.getFieldValue('MSH', 4) || 'LAB';
  const msgControlId = parsed.getFieldValue('MSH', 10) || `MSG_${Date.now()}`;
  const hl7Version = parsed.getFieldValue('MSH', 12) || '2.3.1';

  const msh = `MSH|^~\\&|GHIMS|HOSPITAL|${sendingApp}|${sendingFacility}|${timestamp}||ACK^R01|ACK_${msgControlId}|P|${hl7Version}`;
  const msa = `MSA|${ackCode}|${msgControlId}|${textMessage}`;

  return `${msh}\r${msa}\r`;
}
