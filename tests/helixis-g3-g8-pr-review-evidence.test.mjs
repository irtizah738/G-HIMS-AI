import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessG1G2ReviewEvidence,REQUIRED_CI_CONTEXTS,RELEASE_EVIDENCE_SCHEMA,
} from '../scripts/ops/helixis-g3-g8-pr-review-evidence.mjs';

const SHA_A='a'.repeat(40),SHA_B='b'.repeat(40);
function evidence() {
  return {
    schema:RELEASE_EVIDENCE_SCHEMA,
    pullRequest:{
      number:274,headSha:SHA_A,author:'author',
      state:'open',draft:false,baseRef:'main',mergeable:true,
    },
    reviews:[
      {user:{login:'security-reviewer',type:'User'},state:'APPROVED',
        commitSha:SHA_A,submittedAt:'2026-11-09T08:00:00Z'},
      {user:{login:'clinical-reviewer',type:'User'},state:'APPROVED',
        commitSha:SHA_A,submittedAt:'2026-11-09T08:05:00Z'},
    ],
    checkRuns:REQUIRED_CI_CONTEXTS.map(name=>({
      name,status:'completed',conclusion:'success',headSha:SHA_A,
    })),
    effectiveRules:[
      {type:'pull_request',parameters:{
        required_approving_review_count:2,
        dismiss_stale_reviews_on_push:true,
        require_last_push_approval:true,
        require_code_owner_review:true,
      }},
      {type:'required_status_checks',parameters:{
        strict_required_status_checks_policy:true,
        required_status_checks:REQUIRED_CI_CONTEXTS.map(context=>({context})),
      }},
    ],
    rulesEnforcement:'active',
    codeOwnersConfigured:true,
  };
}
function checkNoGo(value,reason) {
  const result=assessG1G2ReviewEvidence(value);
  assert.equal(result.decision,'NO_GO');
  assert.equal(result.productionRelease,'NO_GO');
  assert.equal(result.hostedQualification,'NO_GO');
  assert.ok(result.reasons.includes(reason),result.reasons.join('; '));
}
test('review evidence cannot grant production authorization even with all controls',()=>{
  const result=assessG1G2ReviewEvidence(evidence());
  assert.equal(result.decision,'REVIEW_EVIDENCE_READY_ONLY');
  assert.equal(result.productionRelease,'NO_GO');
  assert.equal(result.hostedQualification,'NO_GO');
  assert.deepEqual(result.reasons,[]);
  assert.equal(result.approvedIndependentReviewerCount,2);
});
test('missing reviews never count as independent approval',()=>{
  const f=evidence();f.reviews=[];
  checkNoGo(f,'INSUFFICIENT_FRESH_INDEPENDENT_APPROVALS');
});
test('approvals on a prior commit are stale, even if all check runs are green',()=>{
  const f=evidence();f.reviews[0].commitSha=SHA_B;
  checkNoGo(f,'INSUFFICIENT_FRESH_INDEPENDENT_APPROVALS');
});
test('author, bot and duplicate reviewers cannot satisfy two approvals',()=>{
  for(const user of [
    {login:'author',type:'User'},
    {login:'ci-agent[bot]',type:'Bot'},
    {login:'clinical-reviewer',type:'User'},
  ]){
    const f=evidence();
    f.reviews[0].user=user;
    checkNoGo(f,'INSUFFICIENT_FRESH_INDEPENDENT_APPROVALS');
  }
});
test('newer CHANGES_REQUESTED negates earlier approval',()=>{
  const f=evidence();
  f.reviews.push({
    user:{login:'security-reviewer',type:'User'},
    state:'CHANGES_REQUESTED',commitSha:SHA_A,
    submittedAt:'2026-11-09T08:10:00Z',
  });
  checkNoGo(f,'INSUFFICIENT_FRESH_INDEPENDENT_APPROVALS');
});
test('newer COMMENTED does not alter the decisive review state',()=>{
  const f=evidence();f.reviews.push({
    user:{login:'security-reviewer',type:'User'},
    state:'COMMENTED',commitSha:SHA_A,submittedAt:'2026-11-09T08:10:00Z',
  });
  assert.equal(assessG1G2ReviewEvidence(f).decision,'REVIEW_EVIDENCE_READY_ONLY');
});
test('missing or failed exact-head required job blocks qualification',()=>{
  for(const altered of ['missing','failed','queued','wrong-head']){
    const f=evidence();
    if(altered==='missing')f.checkRuns.shift();
    if(altered==='failed')f.checkRuns[0].conclusion='failure';
    if(altered==='queued')f.checkRuns[0].status='queued';
    if(altered==='wrong-head')f.checkRuns[0].headSha=SHA_B;
    checkNoGo(f,'EXACT_HEAD_CHECK_NOT_PASSED:'+REQUIRED_CI_CONTEXTS[0]);
  }
});
test('extra passing status does not cure a failing check with same name',()=>{
  const f=evidence();
  f.checkRuns.push({...f.checkRuns[0],conclusion:'failure'});
  checkNoGo(f,'EXACT_HEAD_CHECK_NOT_PASSED:'+REQUIRED_CI_CONTEXTS[0]);
});
test('passing jobs do not replace enforced required status contexts',()=>{
  const f=evidence();
  f.effectiveRules[1].parameters.required_status_checks
    .splice(4);
  checkNoGo(f,'CHECK_NOT_REQUIRED:'+REQUIRED_CI_CONTEXTS[4]);
});
test('zero-review branch ruleset blocks even two apparent approvals',()=>{
  const f=evidence();f.effectiveRules[0].parameters.required_approving_review_count=0;
  checkNoGo(f,'BRANCH_REQUIRES_FEWER_THAN_TWO_REVIEWS');
});
test('missing stale dismissal or last-push approvals fails closed',()=>{
  const f=evidence();f.effectiveRules[0].parameters.dismiss_stale_reviews_on_push=false;
  checkNoGo(f,'STALE_REVIEW_DISMISSAL_NOT_ENFORCED');
  const g=evidence();g.effectiveRules[0].parameters.require_last_push_approval=false;
  checkNoGo(g,'LAST_PUSH_APPROVAL_NOT_ENFORCED');
});
test('codeowner controls need both a file and branch policy',()=>{
  const f=evidence();f.codeOwnersConfigured=false;
  checkNoGo(f,'CODEOWNER_REVIEW_NOT_ENFORCED');
  const g=evidence();g.effectiveRules[0].parameters.require_code_owner_review=false;
  checkNoGo(g,'CODEOWNER_REVIEW_NOT_ENFORCED');
});
test('strict required-check enforcement cannot be disabled',()=>{
  const f=evidence();f.effectiveRules[1].parameters.strict_required_status_checks_policy=false;
  checkNoGo(f,'BASE_BRANCH_CHECKS_NOT_STRICT');
});
test('draft, closed, unmergeable or stacked PR is never release evidence ready',()=>{
  const variants=[
    ['draft',true,'DRAFT_PULL_REQUEST'],
    ['state','closed','PULL_REQUEST_NOT_OPEN'],
    ['mergeable',null,'MERGEABILITY_UNVERIFIED'],
    ['baseRef','feature-parent','NOT_MAIN_TARGET'],
  ];
  for(const [field,value,reason] of variants){
    const f=evidence();f.pullRequest[field]=value;
    checkNoGo(f,reason);
  }
});
test('unverified ruleset enforcement fails, even if rules appear protective',()=>{
  const f=evidence();f.rulesEnforcement='unknown';
  checkNoGo(f,'RULESET_ENFORCEMENT_UNVERIFIED');
});
test('malformed evidence cannot become ready by omission',()=>{
  for(const v of [
    null,{}, {schema:'wrong'}, {...evidence(),reviews:null},
    {...evidence(),effectiveRules:null},
  ])assert.throws(()=>assessG1G2ReviewEvidence(v),/EVIDENCE_(SCHEMA_INVALID|MALFORMED)/);
});
test('invalid or synthetic reviewer records never count as human approvals',()=>{
  const f=evidence();f.reviews[0].submittedAt='not-a-date';
  checkNoGo(f,'REVIEW_RECORD_INVALID');
  checkNoGo(f,'INSUFFICIENT_FRESH_INDEPENDENT_APPROVALS');
});
