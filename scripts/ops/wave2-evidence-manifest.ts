import { mkdir, readFile, writeFile } from 'node:fs/promises';

type PlaywrightSpec = {
  title?: string;
  ok?: boolean;
  tests?: Array<{
    status?: string;
    results?: Array<{ status?: string }>;
  }>;
};

type PlaywrightSuite = {
  title?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
};

function collectSpecs(suites: PlaywrightSuite[]): PlaywrightSpec[] {
  return suites.flatMap((suite) => [
    ...(suite.specs || []),
    ...collectSpecs(suite.suites || []),
  ]);
}

function currentGitSha(): string {
  const envSha = String(
    process.env.GITHUB_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.CF_PAGES_COMMIT_SHA ||
      ''
  ).trim();
  if (envSha) return envSha;
  try {
    const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD']);
    if (result.exitCode === 0) return result.stdout.toString().trim();
  } catch {
    // Evidence generation remains fail-closed below if SHA cannot be proven.
  }
  return '';
}

const stagingUrl = String(process.env.GHIMS_STAGING_BASE_URL || '')
  .trim()
  .replace(/\/$/, '');
const tenantId = String(process.env.GHIMS_P7_TENANT_ID || '')
  .trim()
  .toLowerCase();
const confirmedTenant = String(
  process.env.GHIMS_WAVE2_CONFIRM_TENANT || ''
)
  .trim()
  .toLowerCase();

if (!stagingUrl.startsWith('https://')) {
  throw new Error(
    'WAVE2_EVIDENCE_STAGING_URL_REQUIRED: remote HTTPS staging URL is required.'
  );
}
if (!tenantId || confirmedTenant !== tenantId) {
  throw new Error(
    'WAVE2_EVIDENCE_TENANT_CONFIRMATION_REQUIRED: staging tenant confirmation does not match.'
  );
}

const sha = currentGitSha();
if (!sha) {
  throw new Error('WAVE2_EVIDENCE_GIT_SHA_REQUIRED: current source SHA could not be proven.');
}

const raw = await readFile(
  'test-results/wave2-staging/results.json',
  'utf8'
);
const report = JSON.parse(raw) as {
  suites?: PlaywrightSuite[];
  stats?: {
    expected?: number;
    unexpected?: number;
    skipped?: number;
    flaky?: number;
  };
};

const specs = collectSpecs(report.suites || []);
const requiredTitles = [
  'Doctor creates order-bound eMAR slot and nursing plan',
  'Nurse administers scheduled medication and closes intervention',
  'Doctor orders dialysis; nurse executes and completes session',
  'Doctor and nurse complete governed obstetric timeline',
  'Doctor completes oncology evidence → board → regimen → administration → toxicity chain',
  'Doctor completes rehabilitation plan through accepted handoff',
];

const evidence = requiredTitles.map((title) => {
  const spec = specs.find((candidate) => candidate.title === title);
  const statuses = (spec?.tests || []).flatMap((test) => [
    test.status,
    ...(test.results || []).map((result) => result.status),
  ]);
  const passed =
    Boolean(spec) &&
    (spec?.ok === true ||
      statuses.some((status) => status === 'expected' || status === 'passed')) &&
    !statuses.some((status) =>
      ['unexpected', 'failed', 'timedOut', 'interrupted'].includes(
        String(status)
      )
    );
  return { title, passed };
});

if (evidence.some((item) => !item.passed)) {
  throw new Error(
    `WAVE2_STAGING_QUALIFICATION_FAILED: ${evidence
      .filter((item) => !item.passed)
      .map((item) => item.title)
      .join('; ')}`
  );
}

const manifest = {
  program: 'G-HIMS Wave 2 Clinical Domain Completion',
  sourceSha: sha,
  stagingUrl,
  tenantId,
  generatedAt: new Date().toISOString(),
  qualification: 'DEPLOYED_CROSS_ROLE_STAGING',
  domains: {
    nursingEmar: 'PASS',
    renalDialysis: 'PASS',
    obstetricsPartogram: 'PASS',
    oncologyTumorBoard: 'PASS',
    rehabilitation: 'PASS',
  },
  evidence,
  playwrightStats: report.stats || null,
  safety: {
    syntheticFixtureRequired: true,
    productionDataPermitted: false,
    credentialsPersisted: false,
  },
};

await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/wave2-staging-evidence.json',
  JSON.stringify(manifest, null, 2),
  'utf8'
);

console.log(JSON.stringify(manifest, null, 2));
