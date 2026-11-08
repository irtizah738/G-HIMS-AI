/**
 * Helixis G1/G2 read-only GitHub review evidence gate.
 *
 * Never performs GitHub or GCP mutations. It can report review evidence
 * readiness only; it NEVER grants production or hosted qualification.
 * --live requires a GitHub token with read-only pull-request, checks,
 * contents and repository-rules permissions. The token is never logged.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const REQUIRED_CI_CONTEXTS = Object.freeze([
  'CIQP-182 source guards and evidence validation',
  'CIQP-182 emulator crash/replay/race qualification',
  'Typecheck, lint, full unit regression and build',
  'Dependency, secret and SBOM gate',
  'G3-G8 offline contracts, security and typecheck',
  'G3-G8 atomicity and synthetic recovery emulator',
]);

export const RELEASE_EVIDENCE_SCHEMA = 'helixis.g1g2.git-review-evidence.v1';

function uniqueStrings(xs) {
  return [...new Set(xs)].sort();
}
function isBot(user) {
  return user.type === 'Bot' || /\[bot\]$/i.test(user.login);
}
function nonblank(v) {
  return typeof v === 'string' && v.length > 0;
}
function validSha(v) {
  return typeof v === 'string' && /^[0-9a-f]{40}$/i.test(v);
}

/**
 * Pure fail-closed evaluator. Input is a GitHub API evidence snapshot and
 * must NOT be treated as independently authenticated if supplied by clients.
 */
export function assessG1G2ReviewEvidence(facts) {
  const reasons = [];
  if (!facts || facts.schema !== RELEASE_EVIDENCE_SCHEMA) {
    throw new Error('G1G2_REVIEW_EVIDENCE_SCHEMA_INVALID');
  }
  const p = facts.pullRequest, rules = facts.effectiveRules;
  if (!p || !validSha(p.headSha) || !Number.isSafeInteger(p.number) ||
      p.number < 1 || !nonblank(p.author) ||
      !Array.isArray(facts.reviews) || !Array.isArray(facts.checkRuns) ||
      !Array.isArray(rules)) {
    throw new Error('G1G2_REVIEW_EVIDENCE_MALFORMED');
  }

  if (p.state !== 'open') reasons.push('PULL_REQUEST_NOT_OPEN');
  if (p.draft !== false) reasons.push('DRAFT_PULL_REQUEST');
  if (p.baseRef !== 'main') reasons.push('NOT_MAIN_TARGET');
  if (p.mergeable !== true) reasons.push('MERGEABILITY_UNVERIFIED');

  const reviewRule = rules.find(r => r?.type === 'pull_request')?.parameters;
  if (!reviewRule || !Number.isSafeInteger(reviewRule.required_approving_review_count) ||
      reviewRule.required_approving_review_count < 2) {
    reasons.push('BRANCH_REQUIRES_FEWER_THAN_TWO_REVIEWS');
  }
  if (!reviewRule?.dismiss_stale_reviews_on_push) {
    reasons.push('STALE_REVIEW_DISMISSAL_NOT_ENFORCED');
  }
  if (!reviewRule?.require_last_push_approval) {
    reasons.push('LAST_PUSH_APPROVAL_NOT_ENFORCED');
  }
  if (!reviewRule?.require_code_owner_review || facts.codeOwnersConfigured !== true) {
    reasons.push('CODEOWNER_REVIEW_NOT_ENFORCED');
  }
  if (facts.rulesEnforcement !== 'active') {
    reasons.push('RULESET_ENFORCEMENT_UNVERIFIED');
  }

  const statusRule = rules.find(r => r?.type === 'required_status_checks')?.parameters;
  const enforcedContexts = new Set(
    Array.isArray(statusRule?.required_status_checks)
      ? statusRule.required_status_checks.map(c => c?.context).filter(nonblank)
      : [],
  );
  if (statusRule?.strict_required_status_checks_policy !== true) {
    reasons.push('BASE_BRANCH_CHECKS_NOT_STRICT');
  }
  for (const name of REQUIRED_CI_CONTEXTS) {
    if (!enforcedContexts.has(name)) {
      reasons.push('CHECK_NOT_REQUIRED:' + name);
    }
    const matching = facts.checkRuns.filter(c =>
      c && c.name === name && c.headSha === p.headSha);
    if (!matching.length ||
        matching.some(c => c.status !== 'completed' || c.conclusion !== 'success')) {
      reasons.push('EXACT_HEAD_CHECK_NOT_PASSED:' + name);
    }
  }

  // Only the most recent decisive review per identity counts. A COMMENTED
  // review does not revoke an existing APPROVED/CHANGES_REQUESTED review.
  const effective = new Map();
  for (const review of facts.reviews) {
    if (!review || !review.user || !nonblank(review.user.login) ||
        !nonblank(review.submittedAt) || !Number.isFinite(Date.parse(review.submittedAt)) ||
        !nonblank(review.state)) {
      reasons.push('REVIEW_RECORD_INVALID');
      continue;
    }
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    const key = review.user.login.toLowerCase();
    const prior = effective.get(key);
    if (prior && Date.parse(prior.submittedAt) >= Date.parse(review.submittedAt)) continue;
    effective.set(key, review);
  }
  const approved = [...effective.values()].filter(review =>
    review.state === 'APPROVED' &&
    !isBot(review.user) &&
    review.user.login.toLowerCase() !== p.author.toLowerCase() &&
    validSha(review.commitSha) && review.commitSha === p.headSha,
  );
  if (approved.length < 2) reasons.push('INSUFFICIENT_FRESH_INDEPENDENT_APPROVALS');

  return Object.freeze({
    schema: RELEASE_EVIDENCE_SCHEMA,
    decision: reasons.length ? 'NO_GO' : 'REVIEW_EVIDENCE_READY_ONLY',
    productionRelease: 'NO_GO',
    hostedQualification: 'NO_GO',
    approvedIndependentReviewerCount: approved.length,
    headSha: p.headSha,
    reasons: uniqueStrings(reasons),
  });
}

const GITHUB_API = 'https://api.github.com';
async function requestJson(token, apiPath, {allowMissing = false} = {}) {
  const url = new URL(apiPath, GITHUB_API);
  if (url.origin !== GITHUB_API) throw new Error('G1G2_REVIEW_API_ORIGIN_DENIED');
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 404 && allowMissing) return {missing: true, json: null, next: null};
  if (!res.ok) throw new Error('G1G2_REVIEW_READ_FAILED_HTTP_' + res.status);
  const link = res.headers.get('link') || '';
  const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
  if (next && new URL(next).origin !== GITHUB_API) {
    throw new Error('G1G2_REVIEW_PAGINATION_ORIGIN_DENIED');
  }
  return {missing: false, json: await res.json(), next};
}
async function pages(token, path, unwrap) {
  const items = [];
  let url = path;
  for (let page = 0; page < 20; page++) {
    const res = await requestJson(token, url);
    const rows = unwrap(res.json);
    if (!Array.isArray(rows)) throw new Error('G1G2_REVIEW_API_SHAPE_INVALID');
    items.push(...rows);
    if (!res.next) return items;
    url = res.next;
  }
  throw new Error('G1G2_REVIEW_PAGINATION_LIMIT');
}
function repoPath(repo, suffix) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('G1G2_REVIEW_REPO_INVALID');
  }
  return '/repos/' + repo + suffix;
}

export async function getLiveG1G2ReviewEvidence({token, repo, prNumber}) {
  if (!nonblank(token) || !Number.isSafeInteger(prNumber) || prNumber < 1) {
    throw new Error('G1G2_REVIEW_LIVE_ARGUMENTS_INVALID');
  }
  const pr = (await requestJson(token, repoPath(repo, '/pulls/' + prNumber))).json;
  if (!pr || pr.number !== prNumber || !validSha(pr.head?.sha)) {
    throw new Error('G1G2_REVIEW_PR_DATA_INVALID');
  }
  const base = pr.base?.ref;
  const [reviews, checks, rules, owners] = await Promise.all([
    pages(token, repoPath(repo, '/pulls/' + prNumber + '/reviews?per_page=100'), x => x),
    pages(token, repoPath(repo, '/commits/' + pr.head.sha +
      '/check-runs?per_page=100&filter=latest'), x => x.check_runs),
    requestJson(token, repoPath(repo, '/rules/branches/main')),
    requestJson(token, repoPath(repo, '/contents/.github/CODEOWNERS?ref=main'),
      {allowMissing:true}),
  ]);
  if (!Array.isArray(rules.json)) throw new Error('G1G2_REVIEW_RULESET_SHAPE_INVALID');
  const rulesActive = rules.json.some(x => x.type === 'pull_request') &&
    rules.json.some(x => x.type === 'required_status_checks');
  let codeOwnersConfigured = false;
  if (!owners.missing && owners.json?.encoding === 'base64' &&
      typeof owners.json.content === 'string') {
    const content = Buffer.from(owners.json.content.replace(/\s/g,''), 'base64').toString('utf8');
    codeOwnersConfigured = content.split(/\r?\n/).some(row =>
      row.trim() && !row.trim().startsWith('#') && row.trim().split(/\s+/).length >= 2);
  }
  return {
    schema: RELEASE_EVIDENCE_SCHEMA,
    pullRequest: {
      number:pr.number,headSha:pr.head.sha,baseRef:base,author:pr.user?.login,
      state:pr.state,draft:pr.draft,mergeable:pr.mergeable,
    },
    reviews:reviews.map(v => ({
      user:{login:v.user?.login,type:v.user?.type},
      state:v.state,commitSha:v.commit_id,submittedAt:v.submitted_at,
    })),
    checkRuns:checks.map(v => ({
      name:v.name,headSha:v.head_sha,status:v.status,conclusion:v.conclusion,
    })),
    effectiveRules:rules.json,
    rulesEnforcement:rulesActive ? 'active' : 'unknown',
    codeOwnersConfigured,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] !== '--live' || argv.length !== 4 ||
      argv[1] !== '--repo' || !argv[2].includes('/') ||
      !argv[3].startsWith('--pr=')) {
    throw new Error('USAGE: --live --repo owner/repo --pr=123');
  }
  const prNumber = Number(argv[3].slice(5));
  const token = process.env.GITHUB_TOKEN;
  const facts = await getLiveG1G2ReviewEvidence({
    token,repo:argv[2],prNumber,
  });
  const result = assessG1G2ReviewEvidence(facts);
  // Only derived decision codes; never print tokens, review bodies, or PHI.
  process.stdout.write(JSON.stringify(result,null,2) + '\n');
  process.exitCode = result.decision === 'REVIEW_EVIDENCE_READY_ONLY' ? 0 : 2;
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    process.stderr.write('G1G2_REVIEW_EVIDENCE_ERROR: ' +
      String(err?.message || 'UNKNOWN') + '\n');
    process.exitCode = 2;
  });
}
