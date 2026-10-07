import { parseHL7 } from './hl7-parser';

export const MLLP_START = 0x0b;
export const MLLP_END = 0x1c;
export const MLLP_CR = 0x0d;

export interface MllpSourceIdentity {
  sendingApplication: string;
  sendingFacility: string;
  messageControlId: string;
  messageType: string;
}

export function frameMllpMessage(message: string): Buffer {
  const normalized = String(message || '').replace(/^\x0B/, '').replace(/\x1C\x0D$/, '');
  return Buffer.concat([
    Buffer.from([MLLP_START]),
    Buffer.from(normalized, 'utf8'),
    Buffer.from([MLLP_END, MLLP_CR]),
  ]);
}

export function sourceIdentityFromHl7(message: string): MllpSourceIdentity {
  const parsed = parseHL7(message);
  return {
    sendingApplication: parsed.getFieldValue('MSH', 3, 0),
    sendingFacility: parsed.getFieldValue('MSH', 4, 0),
    messageControlId: parsed.getFieldValue('MSH', 10, 0),
    messageType: [
      parsed.getFieldValue('MSH', 9, 0),
      parsed.getFieldValue('MSH', 9, 1),
    ].filter(Boolean).join('^'),
  };
}

export class MllpFrameDecoder {
  private buffer = Buffer.alloc(0);

  constructor(private readonly maxFrameBytes = 2 * 1024 * 1024) {}

  public push(chunk: Buffer): string[] {
    if (!Buffer.isBuffer(chunk)) {
      throw new Error('MLLP_CHUNK_INVALID');
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxFrameBytes * 2) {
      this.buffer = Buffer.alloc(0);
      throw new Error('MLLP_BUFFER_LIMIT_EXCEEDED');
    }

    const messages: string[] = [];
    while (true) {
      const start = this.buffer.indexOf(MLLP_START);
      if (start < 0) {
        this.buffer = Buffer.alloc(0);
        break;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);

      const end = this.buffer.indexOf(Buffer.from([MLLP_END, MLLP_CR]), 1);
      if (end < 0) {
        if (this.buffer.length > this.maxFrameBytes) {
          this.buffer = Buffer.alloc(0);
          throw new Error('MLLP_FRAME_TOO_LARGE');
        }
        break;
      }

      const payload = this.buffer.subarray(1, end);
      if (payload.length === 0) {
        this.buffer = this.buffer.subarray(end + 2);
        continue;
      }
      if (payload.length > this.maxFrameBytes) {
        this.buffer = this.buffer.subarray(end + 2);
        throw new Error('MLLP_FRAME_TOO_LARGE');
      }

      messages.push(payload.toString('utf8'));
      this.buffer = this.buffer.subarray(end + 2);
    }
    return messages;
  }
}
