/**
 * Read-only, post-merge GitHub evidence audit. The output is NEVER a
 * production authorization and cannot establish retrospective ruleset state
 * or professional qualifications of security/clinical reviewers.
 */
import { pathToFileURL } from 'node:url';

export const SCHEMA = 'helixis.g1g2.postmerge-governance.v1';
const sha = x => typeof x === 'string' && /^[0-9a-f]{40}$/i.test(x);
const iso = x => typeof x === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(x) &&
  Number.isFinite(Date.parse(x));
const reasons = x => [...new Set(x)].sort();

export function assessMergedPrGovernance(facts) {
  if (!facts || facts.schema !== SCHEMA || !Array.isArray(facts.pullRequests) ||
      !Array.isArray(facts.currentRules) || facts.pullRequests.length < 1 ||
      facts.pullRequests.length > 50) {
    throw new Error('POSTMERGE_AUDIT_INVALID_EVIDENCE');
  }
  const rr = facts.currentRules.find(x => x?.type === 'pull_request')?.parameters;
  const currentPolicyFindings = [];
  if (!rr || !Number.isSafeInteger(rr.required_approving_review_count) ||
      rr.required_approving_review_count < 2) currentPolicyFindings.push('CURRENT_RULESET_REQUIRES_FEWER_THAN_TWO_APPROVALS');
  if (rr?.dismiss_stale_reviews_on_push !== true)
    currentPolicyFindings.push('CURRENT_RULESET_ALLOWS_STALE_APPROVALS');
  if (rr?.require_last_push_approval !== true)
    currentPolicyFindings.push('CURRENT_RULESET_LAST_PUSH_APPROVAL_NOT_REQUIRED');
  if (rr?.require_code_owner_review !== true || facts.codeOwnersConfigured !== true)
    currentPolicyFindings.push('CURRENT_CODEOWNER_ENFORCEMENT_MISSING');

  const prs = [];
  const seen = new Set();
  for (const item of facts.pullRequests) {
    if (!item || !Number.isSafeInteger(item.number) || item.number < 1 ||
        !sha(item.headSha) || !iso(item.mergedAt) || !item.author ||
        typeof item.author !== 'string' || !Array.isArray(item.reviews) ||
        item.baseRef !== 'main' || item.merged !== true ||
        seen.has(item.number)) throw new Error('POSTMERGE_AUDIT_INVALID_PR_RECORD');
    seen.add(item.number);
    const issues = [];
    const effective = new Map();
    for (const review of item.reviews) {
      if (!review || typeof review.state !== 'string' ||
          !review.user || typeof review.user.login !== 'string' ||
          !iso(review.submittedAt) || !sha(review.commitSha)) {
        issues.push('UNVERIFIABLE_REVIEW_RECORD');
        continue;
      }
      // A review recorded AFTER merge is not pre-merge approval.
      if (Date.parse(review.submittedAt) > Date.parse(item.mergedAt)) continue;
      if (['COMMENTED','PENDING','DISMISSED'].includes(review.state)) continue;
      const key = review.user.login.toLowerCase();
      const older = effective.get(key);
      if (older && Date.parse(older.submittedAt) >= Date.parse(review.submittedAt)) continue;
      effective.set(key,review);
    }
    const approvals = [...effective.values()].filter(x =>
      x.state === 'APPROVED' && x.commitSha === item.headSha &&
      x.user.login.toLowerCase() !== item.author.toLowerCase() &&
      x.user.type === 'User',
    );
    if (approvals.length < 2) issues.push('FEWER_THAN_TWO_PREMERGE_EXACT_HEAD_HUMAN_APPROVALS');
    if (item.reviews.length === 0) issues.push('NO_RECORDED_REVIEWS');
    prs.push({
      number:item.number,
      headSha:item.headSha,
      mergedAt:item.mergedAt,
      preMergeDistinctHumanApprovals:approvals.length,
      findings:reasons(issues),
      // This intentionally does not assert that branch rules were enforced
      // when the merge happened; GitHub current rules are not historical.
      historicalRulesetAtMerge:'NOT_VERIFIABLE_FROM_CURRENT_RULES',
    });
  }
  const all = [...currentPolicyFindings,...prs.flatMap(x=>x.findings)];
  return {
    schema:SCHEMA,
    decision:all.length ? 'GOVERNANCE_EXCEPTIONS_REQUIRE_REVIEW' : 'EVIDENCE_SNAPSHOT_ONLY',
    currentPolicyFindings:reasons(currentPolicyFindings),
    pullRequests:prs,
    hostedQualification:'NO_GO',
    productionRelease:'NO_GO',
  };
}

const API='https://api.github.com';
async function get(token,pathname) {
  const url = new URL(pathname, API);
  if (url.origin !== API) throw new Error('POSTMERGE_AUDIT_ORIGIN_DENIED');
  const res=await fetch(url,{
    method:'GET',redirect:'error',
    headers:{
      authorization:'Bearer '+token,
      accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',
    },
  });
  if (!res.ok) throw new Error('POSTMERGE_AUDIT_HTTP_'+res.status);
  return {body:await res.json(),next:(res.headers.get('link')||'').match(/<([^>]+)>;\s*rel="next"/)?.[1]||null};
}
async function getAll(token,path) {
  const rows=[];let next=path;
  for (let n=0;n<20;n++) {
    const value=await get(token,next);
    if(!Array.isArray(value.body))throw new Error('POSTMERGE_AUDIT_PAGINATION_SHAPE');
    rows.push(...value.body);
    if(!value.next)return rows;
    if(new URL(value.next).origin!==API)throw new Error('POSTMERGE_AUDIT_PAGINATION_ORIGIN');
    next=value.next;
  }
  throw new Error('POSTMERGE_AUDIT_PAGINATION_EXCEEDED');
}
export async function readGitHubMergedPrEvidence({token,repo,numbers}) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
      !Array.isArray(numbers) || numbers.length<1 || numbers.length>20 ||
      numbers.some(x=>!Number.isSafeInteger(x)||x<1)) {
    throw new Error('POSTMERGE_AUDIT_LIVE_INPUT_INVALID');
  }
  const prefix='/repos/'+repo;
  const currentRules=(await get(token,prefix+'/rules/branches/main')).body;
  if(!Array.isArray(currentRules))throw new Error('POSTMERGE_AUDIT_RULESET_SHAPE');
  const prs=[];
  for (const number of numbers) {
    const pr=(await get(token,prefix+'/pulls/'+number)).body;
    const reviews=await getAll(token,prefix+'/pulls/'+number+'/reviews?per_page=100');
    if(pr?.number!==number || pr.merged!==true)throw new Error('POSTMERGE_AUDIT_NOT_MERGED');
    prs.push({
      number,headSha:pr.head?.sha,author:pr.user?.login,
      mergedAt:pr.merged_at,merged:true,baseRef:pr.base?.ref,
      reviews:reviews.map(x=>({
        state:x.state,commitSha:x.commit_id,submittedAt:x.submitted_at,
        user:{login:x.user?.login,type:x.user?.type},
      })),
    });
  }
  // Check GitHub's three supported CODEOWNERS locations; a filename alone
  // does not prove that requested specialists have write/review permission.
  let codeOwnersConfigured=false;
  for (const path of ['.github/CODEOWNERS','CODEOWNERS','docs/CODEOWNERS']) {
    try {
      const record=(await get(token,prefix+'/contents/'+path+'?ref=main')).body;
      if(record?.encoding!=='base64'||typeof record.content!=='string')
        throw new Error('POSTMERGE_AUDIT_CODEOWNERS_SHAPE');
      const lines=Buffer.from(record.content.replace(/\s/g,''),'base64')
        .toString('utf8').split(/\r?\n/);
      codeOwnersConfigured=lines.some(line=>{
        const trimmed=line.trim();
        return trimmed.length>0&&!trimmed.startsWith('#')&&
          trimmed.split(/\s+/).length>=2;
      });
      break;
    } catch(e) {
      if(e.message!=='POSTMERGE_AUDIT_HTTP_404')throw e;
    }
  }
  return {schema:SCHEMA,currentRules,pullRequests:prs,codeOwnersConfigured};
}
async function main() {
  const args=process.argv.slice(2);
  if (args.length!==3 || args[0]!=='--live' ||
      !args[1].startsWith('--repo=') || !args[2].startsWith('--prs=')) {
    throw new Error('USAGE: --live --repo=owner/name --prs=274,277,278');
  }
  const numbers=args[2].slice(6).split(',').map(Number);
  const facts=await readGitHubMergedPrEvidence({
    repo:args[1].slice(7),numbers,token:process.env.GITHUB_TOKEN,
  });
  const result=assessMergedPrGovernance(facts);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  process.exitCode=result.decision==='EVIDENCE_SNAPSHOT_ONLY'?0:2;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(e=>{
    process.stderr.write('POSTMERGE_AUDIT_ERROR:'+String(e.message)+'\n');
    process.exitCode=2;
  });
}
