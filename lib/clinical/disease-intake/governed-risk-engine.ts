import type {
  DiseaseIntakeTemplate,
  RiskSeverity,
  SymptomTreeNode,
} from '@/lib/types/disease-intake';

type AnswerMap = Record<string, unknown>;

export interface GovernedDiseaseIntakeRisk {
  score: number;
  severity: RiskSeverity;
  signalIds: string[];
  signalTitles: string[];
}

function findNode(node: SymptomTreeNode, nodeId: string): SymptomTreeNode | undefined {
  if (node.id === nodeId) return node;
  for (const child of node.children || []) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return undefined;
}

export function allowedDiseaseIntakeTreeNodeIds(
  template: DiseaseIntakeTemplate
): Set<string> {
  const ids = new Set<string>();
  const visit = (node: SymptomTreeNode) => {
    ids.add(node.id);
    for (const child of node.children || []) visit(child);
  };
  visit(template.symptomTree);
  return ids;
}

export function allowedDiseaseIntakeQuestionIds(
  template: DiseaseIntakeTemplate
): Set<string> {
  return new Set(template.guidedQuestions.map((question) => question.id));
}

export function allowedDiseaseIntakeHistoryKeys(
  template: DiseaseIntakeTemplate
): Set<string> {
  return new Set(
    template.specialtyHistory.flatMap((group) =>
      group.fields.map((field) => field.key)
    )
  );
}

export function missingRequiredDiseaseIntakeQuestions(
  template: DiseaseIntakeTemplate,
  answers: AnswerMap
): string[] {
  return template.guidedQuestions
    .filter((question) => question.required)
    .filter((question) => {
      const value = answers[question.id];
      return (
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      );
    })
    .map((question) => question.id);
}

export function computeGovernedDiseaseIntakeRisk(
  template: DiseaseIntakeTemplate,
  answers: AnswerMap,
  specialtyHistory: AnswerMap,
  selectedTreeNodeIds: string[]
): GovernedDiseaseIntakeRisk {
  let score = 0;

  for (const nodeId of selectedTreeNodeIds) {
    if (nodeId === template.symptomTree.id) continue;
    const node = findNode(template.symptomTree, nodeId);
    if (node) score += Math.max(0, Number(node.riskWeight) || 0);
  }

  for (const question of template.guidedQuestions) {
    const value = answers[question.id];
    if (question.type === 'scale' || question.type === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        score += Math.min(value, 10);
      }
      continue;
    }
    if (!question.options || value === undefined || value === null) continue;

    const selected = Array.isArray(value) ? value : [value];
    for (const selectedValue of selected) {
      const option = question.options.find(
        (candidate) => candidate.value === String(selectedValue)
      );
      if (option) score += option.riskScore || 0;
    }
  }

  score = Math.round(score);

  const activeSignals = template.riskSignals.filter((signal) => {
    try {
      return signal.conditionChecker(
        answers as Record<string, any>,
        specialtyHistory as Record<string, any>,
        selectedTreeNodeIds
      );
    } catch {
      return false;
    }
  });

  let severity: RiskSeverity = 'LOW';
  if (activeSignals.some((signal) => signal.severity === 'CRITICAL') || score >= 25) {
    severity = 'CRITICAL';
  } else if (activeSignals.some((signal) => signal.severity === 'HIGH') || score >= 16) {
    severity = 'HIGH';
  } else if (
    activeSignals.some((signal) => signal.severity === 'MODERATE') ||
    score >= 8
  ) {
    severity = 'MODERATE';
  }

  return {
    score,
    severity,
    signalIds: activeSignals.map((signal) => signal.id),
    signalTitles: activeSignals.map((signal) => signal.title),
  };
}
