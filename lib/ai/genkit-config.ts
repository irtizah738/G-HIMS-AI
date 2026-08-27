import { GoogleGenAI } from '@google/genai';

/**
 * G-HIMS OS GenAI & Genkit Configuration
 * Centralized initialization of Gemini models, telemetry exporter,
 * safety settings, and typed flow execution runtime.
 */

export const DEFAULT_CLINICAL_MODEL = 'gemini-3.6-flash';
export const CLINICAL_PRO_MODEL = 'gemini-3.7-flash';
export const CLINICAL_FALLBACK_MODEL = 'gemini-3.6-flash';

let genAIClient: GoogleGenAI | null = null;

export function getGenAIClient(): GoogleGenAI | null {
  if (genAIClient) return genAIClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  genAIClient = new GoogleGenAI({ apiKey });
  return genAIClient;
}

export interface TelemetryLogEntry {
  flowName: string;
  timestamp: string;
  durationMs: number;
  tokensEstimated?: number;
  success: boolean;
  error?: string;
  tenantId?: string;
}

export const telemetryExporter = {
  logs: [] as TelemetryLogEntry[],
  record(entry: TelemetryLogEntry) {
    this.logs.push(entry);
    if (this.logs.length > 500) {
      this.logs.shift();
    }
  },
  getRecentLogs(limit = 20): TelemetryLogEntry[] {
    return this.logs.slice(-limit);
  },
};

export interface GenkitFlowContext {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
}

export interface GenkitFlow<TInput, TOutput> {
  name: string;
  description: string;
  run: (input: TInput, context?: GenkitFlowContext) => Promise<TOutput>;
}

/**
 * Helper to define a typed Genkit-compatible clinical intelligence flow
 * with automated latency timing, telemetry recording, and safe error boundary.
 */
export function defineClinicalFlow<TInput, TOutput>(config: {
  name: string;
  description: string;
  execute: (input: TInput, context?: GenkitFlowContext) => Promise<TOutput>;
}): GenkitFlow<TInput, TOutput> {
  return {
    name: config.name,
    description: config.description,
    run: async (input: TInput, context?: GenkitFlowContext): Promise<TOutput> => {
      const startTime = Date.now();
      try {
        const result = await config.execute(input, context);
        telemetryExporter.record({
          flowName: config.name,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          success: true,
          tenantId: context?.tenantId,
        });
        return result;
      } catch (err: any) {
        telemetryExporter.record({
          flowName: config.name,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          success: false,
          error: err?.message || String(err),
          tenantId: context?.tenantId,
        });
        throw err;
      }
    },
  };
}
