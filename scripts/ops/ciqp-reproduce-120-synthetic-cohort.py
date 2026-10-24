#!/usr/bin/env python3
"""Reproduce the EXACT previously supplied synthetic 120-case blinded dataset.

Not a clinical gold standard or real-patient cohort. This generator has no
network access and never reads G-HIMS patient sources.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import random
import json
import hashlib
import os

EXPECTED_SHA256 = "116596dd531f549873cf026cb0e61209f96554954ca622f53ef3b7fb3adcca9d"
EXPECTED_COUNT = 120
SEED = 1122401
STRATA = [
    'RATIO_CANDIDATE', 'ABSOLUTE_48H_CANDIDATE',
    'STABLE_BELOW_CANDIDATE', 'FALLING_RECOVERY',
    'DATA_INTEGRITY_EDGE', 'POPULATION_CONTEXT_CAVEAT',
]
FEATURES = [
    'NO_KNOWN_CKD', 'BASELINE_UNKNOWN', 'DIABETES_RECORDED',
    'RENAL_HISTORY_UNAVAILABLE', 'RECENT_DEHYDRATION_RECORDED',
    'UNKNOWN_URINE_OUTPUT',
]


def generate() -> bytes:
    rng = random.Random(SEED)
    base = datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc)
    cases = []
    for group in STRATA:
        for ix in range(20):
            num = len(cases) + 1
            old_id = f'SYN-REN-{num:03d}'
            first_day = base-timedelta(days=rng.randint(3, 7))
            context = {
                'care_setting': rng.choice(['OPD', 'IPD', 'EMERGENCY']),
                'creatinine_baseline_verification': 'NOT_VERIFIED',
                'urine_output': 'NOT_INCLUDED_IN_SOURCE',
                'history': rng.choice(FEATURES), 'population': 'ADULT'
            }
            first = round(rng.uniform(0.75, 1.65), 2)
            time2 = base - timedelta(days=rng.randint(0, 3))
            second = round(first * rng.uniform(0.97, 1.04), 2)
            last = first
            status1 = status2 = 'FINAL'
            unit1 = unit2 = 'mg/dL'
            code1 = code2 = '2160-0'
            fromdays = 5
            if group == 'RATIO_CANDIDATE':
                first = round(rng.uniform(0.65, 1.25), 2)
                last = round(first*rng.uniform(1.62, 2.72), 2)
                fromdays = rng.randint(2, 6)
            elif group == 'ABSOLUTE_48H_CANDIDATE':
                first = round(rng.uniform(1.4, 2.2), 2)
                last = round(first+rng.uniform(0.34, 0.51), 2)
                fromdays = 1
            elif group == 'STABLE_BELOW_CANDIDATE':
                first = round(rng.uniform(0.75, 2.1), 2)
                last = round(first+rng.uniform(-0.10, 0.15), 2)
                fromdays = rng.randint(2, 6)
            elif group == 'FALLING_RECOVERY':
                first = round(rng.uniform(1.4, 2.7), 2)
                last = round(first*rng.uniform(0.48, 0.87), 2)
                fromdays = rng.randint(2, 6)
            elif group == 'DATA_INTEGRITY_EDGE':
                first = round(rng.uniform(0.8, 1.8), 2)
                last = round(first*2.1, 2)
                fromdays = rng.randint(1, 6)
                mode = ix % 5
                if mode == 0:
                    unit2 = 'umol/L'
                if mode == 1:
                    code2 = '99999-9'
                if mode == 2:
                    status2 = 'PRELIMINARY'
                if mode == 3:
                    fromdays = 9
                if mode == 4:
                    context['data_integrity_flag'] = 'CONFLICTING_SAME_TIME_VALUES_RECORDED'
            else:
                first = round(rng.uniform(0.65, 2.15), 2)
                last = round(first*rng.choice([1.1, 1.65, 2.2]), 2)
                fromdays = rng.randint(1, 6)
                mode = ix % 5
                if mode == 0:
                    context.update(population='PREGNANT', pregnancy_trimester='THIRD')
                if mode == 1:
                    context.update(population='POSTPARTUM', postpartum_days=3)
                if mode == 2:
                    context.update(history='DOCUMENTED_CKD_STAGE_4')
                if mode == 3:
                    context.update(renal_replacement_therapy='CURRENT')
                if mode == 4:
                    context.update(
                        creatinine_baseline_verification='DISPUTED',
                        urine_output='REPORTED_LOW_NOT_QUANTIFIED'
                    )
            earlier = base - timedelta(days=fromdays)
            observations = [
                {
                    'source_id': f'{old_id}-E1', 'loinc': code1, 'analyte': 'Serum creatinine',
                    'value': first, 'unit': unit1, 'status': status1,
                    'effective_at': earlier.isoformat(),
                },
                {
                    'source_id': f'{old_id}-E2', 'loinc': code2, 'analyte': 'Serum creatinine',
                    'value': last, 'unit': unit2, 'status': status2,
                    'effective_at': base.isoformat(),
                },
            ]
            if group == 'DATA_INTEGRITY_EDGE' and ix % 5 == 4:
                observations.append({
                    'source_id': f'{old_id}-E3', 'loinc': '2160-0',
                    'analyte': 'Serum creatinine', 'value': round(last+0.4, 2),
                    'unit': 'mg/dL', 'status': 'FINAL', 'effective_at': base.isoformat(),
                })
            if group == 'STABLE_BELOW_CANDIDATE' and ix == 0:
                observations[0]['value'] = 1.0
                observations[1]['value'] = 1.299
                observations[0]['effective_at'] = (base-timedelta(days=1)).isoformat()
            if group == 'RATIO_CANDIDATE' and ix == 0:
                observations[0]['value'] = 0.9
                observations[1]['value'] = 2.1
                observations[0]['effective_at'] = (base-timedelta(days=5)).isoformat()
            case = {
                'case_id': old_id, 'synthetic_only': True,
                'snapshot_as_of': base.isoformat(),
                'clinical_context': context, 'observations': observations,
                'review_instructions': (
                    'Independently review source facts. Record whether clinically actionable '
                    'kidney deterioration is supported, absent, or indeterminate. Do not '
                    'assume prior observation is a true baseline. Provide evidence references. '
                    'Clinical decisions are reserved to licensed reviewers.'
                ),
            }
            cases.append((group, case))

    rng.shuffle(cases)
    for index, (stratum, case) in enumerate(cases):
        old_id = case['case_id']
        new_id = 'SYNREN-' + hashlib.sha256(
            f'{SEED}:{index}:blind'.encode()
        ).hexdigest()[:12].upper()
        case['case_id'] = new_id
        for obs in case['observations']:
            obs['source_id'] = obs['source_id'].replace(old_id, new_id)

    payload = ''.join(
        json.dumps(case, ensure_ascii=False, sort_keys=True)+'\n'
        for _, case in cases
    ).encode('utf-8')
    if len(cases) != EXPECTED_COUNT:
        raise RuntimeError('UNEXPECTED_CASE_COUNT')
    if hashlib.sha256(payload).hexdigest() != EXPECTED_SHA256:
        raise RuntimeError('EXACT_PREPARED_SYNTHETIC_COHORT_HASH_MISMATCH')
    return payload


if __name__ == '__main__':
    if (os.getenv('GHIMS_RUNTIME_MODE') != 'TEST' or
        os.getenv('FIREBASE_PROJECT_ID') != 'ghims-ciqp-synthetic' or
        os.getenv('FIRESTORE_EMULATOR_HOST') != '127.0.0.1:8080' or
        os.getenv('FIREBASE_AUTH_EMULATOR_HOST') != '127.0.0.1:9099'):
        raise SystemExit('EXACT_TEST_EMULATOR_ENVIRONMENT_REQUIRED')
    output = Path('tmp/ghims-ciqp/120-blinded-synthetic-cases.jsonl')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(generate())
    print('CIQP_COHORT_120_REPRODUCED_AND_SHA256_VERIFIED=PASS')
    print('SYNTHETIC_ONLY=YES')
    print('CASE_COUNT=120')
