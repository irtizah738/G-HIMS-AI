import { z } from 'zod';

export const VitalSignsSchema = z.object({
  heartRate: z.number().min(30).max(250),
  bloodPressure: z.string().regex(/^\d{2,3}\/\d{2,3}$/, "Format must be systolic/diastolic (e.g. 120/80)"),
  temperature: z.number().min(30).max(45),
  respiratoryRate: z.number().min(5).max(60),
  oxygenSaturation: z.number().min(50).max(100),
});

export const ClinicalNoteParseInputSchema = z.object({
  rawNote: z.string().min(5, "Clinical note must have substantial text"),
  patientId: z.string().optional(),
  encounterId: z.string().optional(),
});

export const ClinicalNoteParsedOutputSchema = z.object({
  chiefComplaint: z.string(),
  historyOfPresentIllness: z.string().optional(),
  diagnoses: z.array(z.string()),
  medicationsPrescribed: z.array(
    z.object({
      name: z.string(),
      dosage: z.string(),
      frequency: z.string(),
      route: z.string(),
    })
  ),
  recommendedProcedures: z.array(z.string()),
  followUpDays: z.number().default(7),
  billingCodes: z.array(
    z.object({
      code: z.string(),
      description: z.string(),
      fee: z.number(),
      category: z.string(),
    })
  ),
  summary: z.string(),
});

export type ClinicalNoteParsedOutput = z.infer<typeof ClinicalNoteParsedOutputSchema>;
