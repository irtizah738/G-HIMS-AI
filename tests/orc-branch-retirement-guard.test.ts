import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('audited merged branch cleanup safety', () => {
  test('only 21 exact merged PR refs are eligible, never main', async () => {
    const inventory = JSON.parse(await source('docs/operations/orc-branch-retirement.json'));
    expect(inventory.schema).toBe('ghims.branch-retirement.v2');
    expect(inventory.branches).toHaveLength(21);
    const names = inventory.branches.map((entry: {name: string}) => entry.name);
    expect(new Set(names).size).toBe(21);
    expect(names).not.toContain('main');
    expect(names).not.toContain('release/ciqp-clinical-integrated-current-main');
    expect(names).not.toContain('fix/offline-hydration-identity-isolation-20261010');
    for (const entry of inventory.branches) {
      expect(entry.sha).toMatch(/^[a-f0-9]{40}$/);
      expect(entry.name).toMatch(/^(clinical|fix|hotfix|refactor)\/[a-z0-9-]+$/);
      expect(Number.isInteger(entry.pr)).toBe(true);
    }
  });

  test('one obsolete no-PR ancestor is deletable only after exact-SHA ancestry confirmation', async () => {
    const inventory = JSON.parse(await source('docs/operations/orc-branch-retirement.json'));
    expect(inventory.obsoleteAncestorBranches).toHaveLength(1);
    const entry = inventory.obsoleteAncestorBranches[0];
    expect(entry.name).toBe('fix/mock-retirement-clinical-pointer-diagnostics-20261009');
    expect(entry.sha).toMatch(/^[a-f0-9]{40}$/);
    const workflow = await source('.github/workflows/orc-retire-obsolete-branches.yml');
    expect(workflow).toContain('github.rest.repos.compareCommits');
    expect(workflow).toContain("comparison.data.behind_by !== 0");
    expect(workflow).toContain("comparison.data.ahead_by <= 0");
    expect(workflow).toContain("comparison.data.status !== 'ahead'");
    expect(workflow).toContain("current.data.object.sha !== entry.sha");
    expect(workflow).toContain("openHeads.has(entry.name)");
    expect(workflow).toContain("pr.head.ref === entry.name");
  });

  test('workflow requires exact PR merge, protected ref and concurrent-head guards', async () => {
    const workflow = await source('.github/workflows/orc-retire-obsolete-branches.yml');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain("github.rest.git.deleteRef");
    expect(workflow).toContain("ref: 'heads/' + entry.name");
    expect(workflow).toContain("pr.state !== 'closed'");
    expect(workflow).toContain("!pr.merged_at");
    expect(workflow).toContain("pr.head.sha !== entry.sha");
    expect(workflow).toContain("pr.base.ref !== 'main'");
    expect(workflow).toContain("openHeads.has(entry.name)");
    expect(workflow).toContain("current.protected");
    expect(workflow).toContain("current.commit.sha !== entry.sha");
    expect(workflow).toContain("current.data.object.sha !== entry.sha");
    expect(workflow).toContain("!openHeads.has(cleanupName)");
  });
});
