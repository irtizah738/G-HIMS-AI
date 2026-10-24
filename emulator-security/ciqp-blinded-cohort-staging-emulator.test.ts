import { describe, test, expect } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import { readFile } from 'node:fs/promises';
import { parseLockedSyntheticCohort } from '@/scripts/ops/ciqp-stage-120-blinded-cohort';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const SHA='116596dd531f549873cf026cb0e61209f96554954ca622f53ef3b7fb3adcca9d';
const TENANT='ciqp-renal-browser';
const STUDY='renal-ciqp-synthetic-120-v0';

describe('CIQP exact 120-case synthetic cohort locked-stage contract', () => {
  test('reproduced 120-case source bytes are strictly verified', async () => {
    const bytes=await readFile('tmp/ghims-ciqp/120-blinded-synthetic-cases.jsonl');
    const cases=parseLockedSyntheticCohort(bytes);
    expect(cases).toHaveLength(120);
    expect(new Set(cases.map(c=>c.case_id)).size).toBe(120);
    expect(cases.every(c=>c.synthetic_only === true)).toBe(true);
    const mutated=Buffer.from(bytes);
    mutated[20]=mutated[20]===65?66:65;
    expect(()=>parseLockedSyntheticCohort(mutated)).toThrow('CIQP_COHORT_SOURCE_SHA256_MISMATCH');
  });
  test('study is staged with policy and predictions locked, not falsely certified', async () => {
    const db=getAdminFirestore();
    if(!db) throw Error('FIRESTORE_EMULATOR_MISSING');
    const root=db.collection('tenants').doc(TENANT);
    const study=(await root.collection('clinicalValidationStudies').doc(STUDY).get()).data()!;
    expect(study.exactSourceSha256).toBe(SHA);
    expect(study.cohortCount).toBe(120);
    expect(study.status).toBe('STAGED_LOCKED_POLICY_UNAPPROVED');
    expect(study.protocolApproved).toBe(false);
    expect(study.institutionalAuthorization).toBe(false);
    expect(study.algorithmPredictionsUnblinded).toBe(false);
    const cases=await root.collection('clinicalValidationCohortCases').get();
    expect(cases.size).toBe(120);
    expect(cases.docs.every(d=>d.data().status==='STAGED_LOCKED_POLICY_UNAPPROVED')).toBe(true);
    expect((await root.collection('clinicalValidationAssessments').get()).size).toBe(0);
  });
  test('direct client reads and writes to cohort and study are denied', async () => {
    const rules=await readFile('firestore.rules','utf8');
    const environment=await initializeTestEnvironment({
      projectId:'ghims-ciqp-synthetic',
      firestore:{host:'127.0.0.1',port:8080,rules},
    });
    try{
      const client=environment.authenticatedContext('synthetic-attacker',{tenantId:TENANT}).firestore();
      for(const [coll,id] of [
        ['clinicalValidationStudies',STUDY],
        ['clinicalValidationCohortCases','SYNREN-F13A99429B3D'],
      ]){
        const reference=doc(client,'tenants',TENANT,coll,id);
        await assertFails(getDoc(reference));
        await assertFails(setDoc(reference,{status:'POLICY_APPROVED',predictedFlag:true}));
      }
    }finally{await environment.cleanup();}
  });
});
