import type { CodeableConcept, Coding } from '@/types/clinical-canonical';
import {
  CLINICAL_TERMINOLOGY_MAPPINGS,
  CLINICAL_TERMINOLOGY_REGISTRY,
  type TerminologyConcept,
  type TerminologyMapping,
} from './terminology-registry';

export interface TerminologyValidationResult {
  valid: boolean;
  active: boolean;
  concept?: TerminologyConcept;
  error?: 'UNKNOWN_SYSTEM' | 'UNKNOWN_CODE' | 'INACTIVE_CONCEPT';
}

export interface TerminologySearchResult {
  concept: TerminologyConcept;
  score: number;
}

function normalizeSystem(system: string): string {
  return String(system || '').trim().toUpperCase();
}

function normalizeCode(code: string): string {
  return String(code || '').trim();
}

function searchableText(concept: TerminologyConcept): string {
  return [
    concept.code,
    concept.display,
    ...(concept.synonyms || []),
  ].join(' ').toLowerCase();
}

export class TerminologyService {
  private static concepts = [...CLINICAL_TERMINOLOGY_REGISTRY];
  private static mappings = [...CLINICAL_TERMINOLOGY_MAPPINGS];

  public static lookup(system: string, code: string): TerminologyConcept | null {
    const normalizedSystem = normalizeSystem(system);
    const normalizedCode = normalizeCode(code);

    return (
      this.concepts.find(
        (concept) =>
          normalizeSystem(concept.system) === normalizedSystem &&
          concept.code === normalizedCode
      ) || null
    );
  }

  public static validate(system: string, code: string): TerminologyValidationResult {
    const normalizedSystem = normalizeSystem(system);
    const normalizedCode = normalizeCode(code);

    const systemExists = this.concepts.some(
      (concept) => normalizeSystem(concept.system) === normalizedSystem
    );
    if (!systemExists) {
      return { valid: false, active: false, error: 'UNKNOWN_SYSTEM' };
    }

    const concept = this.lookup(normalizedSystem, normalizedCode);
    if (!concept) {
      return { valid: false, active: false, error: 'UNKNOWN_CODE' };
    }

    if (concept.active === false) {
      return {
        valid: false,
        active: false,
        concept,
        error: 'INACTIVE_CONCEPT',
      };
    }

    return { valid: true, active: true, concept };
  }

  public static search(
    query: string,
    options?: { systems?: string[]; limit?: number }
  ): TerminologySearchResult[] {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];

    const allowedSystems = options?.systems?.map(normalizeSystem);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));

    return this.concepts
      .filter((concept) =>
        !allowedSystems ||
        allowedSystems.includes(normalizeSystem(concept.system))
      )
      .map((concept) => {
        const haystack = searchableText(concept);
        const exactCode = concept.code.toLowerCase() === q;
        const exactDisplay = concept.display.toLowerCase() === q;
        const synonymExact = (concept.synonyms || []).some(
          (item) => item.toLowerCase() === q
        );
        const contains = haystack.includes(q);

        const score = exactCode
          ? 100
          : exactDisplay
            ? 95
            : synonymExact
              ? 90
              : contains
                ? 60
                : 0;

        return { concept, score };
      })
      .filter((result) => result.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.concept.display.localeCompare(right.concept.display);
      })
      .slice(0, limit);
  }

  public static normalizeCoding(coding: Coding): Coding {
    const direct = this.lookup(coding.system, coding.code);
    if (direct) {
      return {
        ...coding,
        system: direct.system,
        code: direct.code,
        display: direct.display,
      };
    }

    const mapped = this.map(coding.system, coding.code);
    if (mapped) {
      const target = this.lookup(mapped.targetSystem, mapped.targetCode);
      if (target) {
        return {
          system: target.system,
          code: target.code,
          display: target.display,
          version: target.version,
          userSelected: coding.userSelected,
        };
      }
    }

    return {
      ...coding,
      system: normalizeSystem(coding.system),
      code: normalizeCode(coding.code),
      display: String(coding.display || '').trim(),
    };
  }

  public static normalizeConcept(concept: CodeableConcept): CodeableConcept {
    return {
      ...concept,
      codings: (concept.codings || []).map((coding) => this.normalizeCoding(coding)),
      text: concept.text?.trim(),
    };
  }

  public static map(
    sourceSystem: string,
    sourceCode: string,
    targetSystem?: string
  ): TerminologyMapping | null {
    const normalizedSourceSystem = normalizeSystem(sourceSystem);
    const normalizedCode = normalizeCode(sourceCode);
    const normalizedTarget = targetSystem ? normalizeSystem(targetSystem) : null;

    return (
      this.mappings.find(
        (mapping) =>
          normalizeSystem(mapping.sourceSystem) === normalizedSourceSystem &&
          mapping.sourceCode === normalizedCode &&
          (!normalizedTarget ||
            normalizeSystem(mapping.targetSystem) === normalizedTarget)
      ) || null
    );
  }

  public static expandValueSet(input: {
    systems?: string[];
    codes?: Array<{ system: string; code: string }>;
  }): TerminologyConcept[] {
    const requestedSystems = input.systems?.map(normalizeSystem);
    const explicit = input.codes || [];

    return this.concepts.filter((concept) => {
      if (
        requestedSystems &&
        requestedSystems.includes(normalizeSystem(concept.system))
      ) {
        return true;
      }

      return explicit.some(
        (item) =>
          normalizeSystem(item.system) === normalizeSystem(concept.system) &&
          normalizeCode(item.code) === concept.code
      );
    });
  }

  public static registerLocalConcept(concept: TerminologyConcept): void {
    if (normalizeSystem(concept.system) !== 'LOCAL') {
      throw new Error('ONLY_LOCAL_TERMINOLOGY_CAN_BE_REGISTERED_AT_RUNTIME');
    }

    const existing = this.lookup(concept.system, concept.code);
    if (existing) {
      throw new Error('TERMINOLOGY_CODE_ALREADY_EXISTS');
    }

    this.concepts.push({
      ...concept,
      system: 'LOCAL',
      code: normalizeCode(concept.code),
      display: concept.display.trim(),
      active: concept.active !== false,
    });
  }

  public static registerMapping(mapping: TerminologyMapping): void {
    const existing = this.map(
      mapping.sourceSystem,
      mapping.sourceCode,
      mapping.targetSystem
    );
    if (existing) {
      throw new Error('TERMINOLOGY_MAPPING_ALREADY_EXISTS');
    }

    this.mappings.push({
      ...mapping,
      sourceSystem: normalizeSystem(mapping.sourceSystem),
      sourceCode: normalizeCode(mapping.sourceCode),
      targetSystem: normalizeSystem(mapping.targetSystem),
      targetCode: normalizeCode(mapping.targetCode),
    });
  }
}
