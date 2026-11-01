/**
 * Minimal Node-native test compatibility for the existing Bun assertion style.
 * This intentionally stays in emulator-security and is never shipped to clients.
 * We preserve the original scenario assertions while executing the Admin SDK
 * against the emulator under the same Node.js runtime family as production.
 */
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';

type Assertion = {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toThrow(fragment?: string): void;
  rejects: { toThrow(fragment?: string): Promise<void> };
};

export function test(
  name: string,
  fn: () => Promise<void> | void,
  timeoutMs = 30000
): void {
  nodeTest(name, { timeout: timeoutMs }, fn);
}

function matchesMessage(error: unknown, fragment?: string): boolean {
  return error instanceof Error && (fragment === undefined || error.message.includes(fragment));
}

export function expect(actual: unknown): Assertion {
  return {
    toBe(expected) { assert.strictEqual(actual, expected); },
    toEqual(expected) { assert.deepStrictEqual(actual, expected); },
    toContain(expected) {
      assert.ok(
        (typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)) ||
        (Array.isArray(actual) && actual.includes(expected)),
        'Expected result to contain ' + String(expected)
      );
    },
    toThrow(fragment) {
      assert.equal(typeof actual, 'function');
      assert.throws(actual as () => unknown, (error: unknown) => matchesMessage(error, fragment));
    },
    rejects: {
      async toThrow(fragment) {
        assert.ok(actual instanceof Promise || (actual !== null && typeof (actual as { then?: unknown }).then === 'function'));
        await assert.rejects(actual as Promise<unknown>, (error: unknown) => matchesMessage(error, fragment));
      },
    },
  };
}
