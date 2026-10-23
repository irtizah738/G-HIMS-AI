/** Offline scorecard math for a separately authorized, fully adjudicated study.
 * No endpoint exposes predictions or calculates study results before signoff. */
export type Outcome = 'YES' | 'NO' | 'INDETERMINATE';
export type Flag = 'FLAG' | 'NO_FLAG' | 'UNAVAILABLE';
export interface ComparisonRow {
  id: string;
  outcome: Outcome;
  flag: Flag;
  referenceLocked: true;
  outputLocked: true;
}
export function calculateStudyConfusionMatrix(rows: ComparisonRow[]) {
  let tp=0,fp=0,tn=0,fn=0,indeterminate=0,unavailable=0;
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.id || ids.has(row.id) || row.referenceLocked !== true || row.outputLocked !== true) {
      throw new Error('CIQP_STUDY_LOCK_REQUIRED');
    }
    ids.add(row.id);
    if (row.outcome === 'INDETERMINATE') { indeterminate++; continue; }
    if (row.flag === 'UNAVAILABLE') { unavailable++; continue; }
    if (row.outcome === 'YES') {
      if (row.flag === 'FLAG') tp++; else fn++;
    } else {
      if (row.flag === 'FLAG') fp++; else tn++;
    }
  }
  const ratio = (a:number,b:number) => b === 0 ? null : a/b;
  return {
    total: rows.length, truePositive: tp, falsePositive: fp,
    trueNegative: tn, falseNegative: fn, indeterminate,
    unavailable, sensitivity: ratio(tp,tp+fn), specificity: ratio(tn,tn+fp),
    missedFraction: ratio(fn,tp+fn), falseAlertFraction: ratio(fp,tn+fp),
    approval: 'NOT_DETERMINED_BY_SCORECARD' as const,
  };
}
