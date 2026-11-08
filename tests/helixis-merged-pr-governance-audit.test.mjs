import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA,assessMergedPrGovernance} from '../scripts/ops/helixis-merged-pr-governance-audit.mjs';

const A='a'.repeat(40),B='b'.repeat(40);
function valid() {
  return {
    schema:SCHEMA,codeOwnersConfigured:true,
    currentRules:[{type:'pull_request',parameters:{
      required_approving_review_count:2,
      dismiss_stale_reviews_on_push:true,
      require_last_push_approval:true,
      require_code_owner_review:true,
    }}],
    pullRequests:[{
      number:274,headSha:A,author:'author',
      mergedAt:'2026-11-09T01:00:00Z',merged:true,baseRef:'main',
      reviews:[
        {state:'APPROVED',commitSha:A,submittedAt:'2026-11-09T00:58:00Z',
          user:{login:'security-reviewer',type:'User'}},
        {state:'APPROVED',commitSha:A,submittedAt:'2026-11-09T00:59:00Z',
          user:{login:'clinical-reviewer',type:'User'}},
      ],
    }],
  };
}
function denied(f,reason){
  const result=assessMergedPrGovernance(f);
  assert.equal(result.decision,'GOVERNANCE_EXCEPTIONS_REQUIRE_REVIEW');
  assert.equal(result.hostedQualification,'NO_GO');
  assert.equal(result.productionRelease,'NO_GO');
  const got=[...result.currentPolicyFindings,...result.pullRequests.flatMap(x=>x.findings)];
  assert.ok(got.includes(reason),JSON.stringify(got));
}
test('valid historic review evidence never authorizes hosted or production release',()=>{
  const result=assessMergedPrGovernance(valid());
  assert.equal(result.decision,'EVIDENCE_SNAPSHOT_ONLY');
  assert.equal(result.productionRelease,'NO_GO');
  assert.equal(result.hostedQualification,'NO_GO');
  assert.equal(result.pullRequests[0].preMergeDistinctHumanApprovals,2);
  assert.equal(result.pullRequests[0].historicalRulesetAtMerge,'NOT_VERIFIABLE_FROM_CURRENT_RULES');
});
test('merged PR with zero review submissions is explicitly flagged',()=>{
  const f=valid();f.pullRequests[0].reviews=[];
  denied(f,'NO_RECORDED_REVIEWS');
  denied(f,'FEWER_THAN_TWO_PREMERGE_EXACT_HEAD_HUMAN_APPROVALS');
});
test('post-merge approval cannot retroactively authorize earlier merge',()=>{
  const f=valid();f.pullRequests[0].reviews[0].submittedAt='2026-11-09T01:01:00Z';
  denied(f,'FEWER_THAN_TWO_PREMERGE_EXACT_HEAD_HUMAN_APPROVALS');
});
test('review against stale commit is not exact-head evidence',()=>{
  const f=valid();f.pullRequests[0].reviews[0].commitSha=B;
  denied(f,'FEWER_THAN_TWO_PREMERGE_EXACT_HEAD_HUMAN_APPROVALS');
});
test('an author cannot approve own merge',()=>{
  const f=valid();f.pullRequests[0].reviews[0].user.login='author';
  denied(f,'FEWER_THAN_TWO_PREMERGE_EXACT_HEAD_HUMAN_APPROVALS');
});
test('bot cannot be independent human',()=>{
  const f=valid();f.pullRequests[0].reviews[0].user.type='Bot';
  denied(f,'FEWER_THAN_TWO_PREMERGE_EXACT_HEAD_HUMAN_APPROVALS');
});
test('duplicate reviewer cannot satisfy separation of duties',()=>{
  const f=valid();f.pullRequests[0].reviews[0].user.login='clinical-reviewer';
  denied(f,'FEWER_THAN_TWO_PREMERGE_EXACT_HEAD_HUMAN_APPROVALS');
});
test('later changes-requested review overrides earlier approval',()=>{
  const f=valid();f.pullRequests[0].reviews.push({
    state:'CHANGES_REQUESTED',commitSha:A,
    submittedAt:'2026-11-09T00:59:30Z',
    user:{login:'security-reviewer',type:'User'},
  });
  denied(f,'FEWER_THAN_TWO_PREMERGE_EXACT_HEAD_HUMAN_APPROVALS');
});
test('COMMENTED review does not replace decisive approval',()=>{
  const f=valid();f.pullRequests[0].reviews.push({
    state:'COMMENTED',commitSha:A,
    submittedAt:'2026-11-09T00:59:30Z',
    user:{login:'security-reviewer',type:'User'},
  });
  assert.equal(assessMergedPrGovernance(f).decision,'EVIDENCE_SNAPSHOT_ONLY');
});
test('current zero-approval ruleset explicitly reported, not mistaken for historic proof',()=>{
  const f=valid();f.currentRules[0].parameters.required_approving_review_count=0;
  denied(f,'CURRENT_RULESET_REQUIRES_FEWER_THAN_TWO_APPROVALS');
});
test('missing CODEOWNER, last-push or stale-review enforcement is visible',()=>{
  const f=valid();f.codeOwnersConfigured=false;
  f.currentRules[0].parameters.require_last_push_approval=false;
  f.currentRules[0].parameters.dismiss_stale_reviews_on_push=false;
  denied(f,'CURRENT_CODEOWNER_ENFORCEMENT_MISSING');
  denied(f,'CURRENT_RULESET_LAST_PUSH_APPROVAL_NOT_REQUIRED');
  denied(f,'CURRENT_RULESET_ALLOWS_STALE_APPROVALS');
});
test('malformed snapshots and duplicated PR numbers cannot be reported as qualified',()=>{
  const f=valid();
  for(const x of [null,{}, {...f,currentRules:null},
      {...f,pullRequests:[]}, {...f,pullRequests:[...f.pullRequests,...f.pullRequests]},
      {...f,pullRequests:[{...f.pullRequests[0],mergedAt:'bad-date'}]}]) {
    assert.throws(()=>assessMergedPrGovernance(x),/POSTMERGE_AUDIT_INVALID/);
  }
});
test('up to 50 well-scoped merged PRs are accepted as evidence, never release',()=>{
  const f=valid();
  f.pullRequests=Array.from({length:50},(_,i)=>({
    ...f.pullRequests[0],number:i+1,
  }));
  const result=assessMergedPrGovernance(f);
  assert.equal(result.pullRequests.length,50);
  assert.equal(result.productionRelease,'NO_GO');
});

test('dismissed approval never counts toward prior merge governance',()=>{
  const f=valid();
  f.pullRequests[0].reviews.push({
    state:'DISMISSED',commitSha:A,
    submittedAt:'2026-11-09T00:59:30Z',
    user:{login:'security-reviewer',type:'User'},
  });
  denied(f,'FEWER_THAN_TWO_PREMERGE_EXACT_HEAD_HUMAN_APPROVALS');
});
test('current ruleset with no pull request rule is never evidence ready',()=>{
  const f=valid();f.currentRules=[];
  denied(f,'CURRENT_RULESET_REQUIRES_FEWER_THAN_TWO_APPROVALS');
});
test('post-merge review records do not erase pre-merge decisions',()=>{
  const f=valid();f.pullRequests[0].reviews.push({
    state:'CHANGES_REQUESTED',commitSha:A,
    submittedAt:'2026-11-09T01:01:00Z',
    user:{login:'security-reviewer',type:'User'},
  });
  assert.equal(assessMergedPrGovernance(f).decision,'EVIDENCE_SNAPSHOT_ONLY');
});
