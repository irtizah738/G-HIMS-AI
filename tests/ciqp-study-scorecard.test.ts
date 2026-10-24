import { describe, expect, test } from 'bun:test';
import { calculateStudyConfusionMatrix } from '@/lib/clinical/validation/study-scorecard';

describe('CIQP study scorecard, offline-only after independently locked adjudication', () => {
  test('reports observed counts and denominators without conferring approval', () => {
    const result = calculateStudyConfusionMatrix([
      {id:'a',outcome:'YES',flag:'FLAG',referenceLocked:true,outputLocked:true},
      {id:'b',outcome:'YES',flag:'NO_FLAG',referenceLocked:true,outputLocked:true},
      {id:'c',outcome:'NO',flag:'FLAG',referenceLocked:true,outputLocked:true},
      {id:'d',outcome:'NO',flag:'NO_FLAG',referenceLocked:true,outputLocked:true},
      {id:'e',outcome:'INDETERMINATE',flag:'FLAG',referenceLocked:true,outputLocked:true},
      {id:'f',outcome:'YES',flag:'UNAVAILABLE',referenceLocked:true,outputLocked:true},
    ]);
    expect(result).toMatchObject({
      total: 6,truePositive:1,falseNegative:1,falsePositive:1,
      trueNegative:1,indeterminate:1,unavailable:1,
      sensitivity:0.5,specificity:0.5,missedFraction:0.5,
      falseAlertFraction:0.5,approval:'NOT_DETERMINED_BY_SCORECARD',
    });
  });
  test('does not invent rates without an eligible denominator', () => {
    const output = calculateStudyConfusionMatrix([]);
    expect(output.sensitivity).toBeNull();
    expect(output.specificity).toBeNull();
  });
  test('rejects duplicate or unlocked predictions/reference labels', () => {
    const row={id:'a',outcome:'YES' as const,flag:'FLAG' as const,
      referenceLocked:true as const,outputLocked:true as const};
    expect(() => calculateStudyConfusionMatrix([row,row])).toThrow('CIQP_STUDY_LOCK_REQUIRED');
    expect(() => calculateStudyConfusionMatrix([
      {...row,referenceLocked:false as never},
    ])).toThrow('CIQP_STUDY_LOCK_REQUIRED');
  });
});
