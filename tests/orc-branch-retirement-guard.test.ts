import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (p: string) => readFile(path.join(process.cwd(), p), 'utf8');

describe('ORC audited branch cleanup safety', () => {
  test('only 15 exact non-main historical refs are eligible', async () => {
    const inventory = JSON.parse(await source('docs/operations/orc-branch-retirement.json'));
    expect(inventory.schema).toBe('ghims.orc.branch-retirement.v1');
    expect(inventory.branches).toHaveLength(15);
    const names = inventory.branches.map((entry: { name: string }) => entry.name);
    expect(new Set(names).size).toBe(15);
    expect(names).not.toContain('main');
    for (const entry of inventory.branches) {
      expect(entry.sha).toMatch(/^[a-f0-9]{40}$/);
      expect(entry.name).toMatch(/^(fix|infra|integration)\/[a-z0-9-]+$/);
      expect(Number.isInteger(entry.pr)).toBe(true);
    }
  });
  test('deletion is SHA-guarded and requires closed PR and integrated release', async () => {
    const workflow = await source('.github/workflows/orc-retire-obsolete-branches.yml');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain("current.data.commit.sha !== entry.sha");
    expect(workflow).toContain("current.data.protected");
    expect(workflow).toContain("openHeads.has(entry.name)");
    expect(workflow).toContain("trackedPR.data.state !== 'closed'");
    expect(workflow).toContain("release.data.merged || !infrastructure.data.merged");
    expect(workflow).toContain("github.rest.git.deleteRef");
    expect(workflow).toContain("ref: 'heads/' + entry.name");
  });
});
