import { describe, it, expect, beforeEach } from 'bun:test';
import { pacuAtomicEngine } from '../lib/clinical/pacu-atomic-engine';

describe('PACU Bed Atomic Allocation & Concurrency Verification', () => {
  beforeEach(() => {
    pacuAtomicEngine.resetLocks();
  });

  it('guarantees mutual exclusion when two simultaneous OR suites race to allocate the exact same PACU bed', async () => {
    const targetBedId = 'bed-pacu-01'; // Available PACU Bed 1

    // Simulate 2 OR suites finishing at the exact same millisecond and competing for Bay 1
    const promise1 = pacuAtomicEngine.reservePACUBedAtomic('or-suite-1-cabg', targetBedId);
    const promise2 = pacuAtomicEngine.reservePACUBedAtomic('or-suite-2-trauma', targetBedId);

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // Invariant: Exactly ONE must succeed and the other must be rejected with race condition error
    const successes = [result1, result2].filter((r) => r.success);
    const failures = [result1, result2].filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const winner = successes[0];
    const loser = failures[0];

    expect(winner.allocatedBedId).toBe(targetBedId);
    expect(winner.lockToken).toBeDefined();
    expect(loser.error).toContain('already atomically locked');
  });

  it('handles high-concurrency surge (5 simultaneous OR requests for available beds)', async () => {
    // 5 concurrent requests attempting auto-allocation
    const requests = Array.from({ length: 5 }).map((_, idx) =>
      pacuAtomicEngine.reservePACUBedAtomic(`or-case-surge-${idx + 1}`)
    );

    const results = await Promise.all(requests);

    const successfulAllocs = results.filter((r) => r.success);
    const allocatedBeds = successfulAllocs.map((r) => r.allocatedBedId);

    // Invariant: No two successful allocations may share the same bed ID
    const uniqueBedIds = new Set(allocatedBeds);
    expect(uniqueBedIds.size).toBe(allocatedBeds.length);
  });

  it('rejects allocation attempt on already occupied bed', async () => {
    // bed-pacu-02 is pre-occupied by Eleanor Vance
    const result = await pacuAtomicEngine.reservePACUBedAtomic('or-case-emergency', 'bed-pacu-02');

    expect(result.success).toBe(false);
    expect(result.error).toContain('currently occupied');
  });

  it('releases lock cleanly and allows subsequent reservation', async () => {
    const targetBedId = 'bed-pacu-03';
    const firstAttempt = await pacuAtomicEngine.reservePACUBedAtomic('or-case-1', targetBedId);
    expect(firstAttempt.success).toBe(true);

    // Release the bed
    pacuAtomicEngine.releasePACUBed(targetBedId);

    // Next case can now successfully claim the bed
    const secondAttempt = await pacuAtomicEngine.reservePACUBedAtomic('or-case-2', targetBedId);
    expect(secondAttempt.success).toBe(true);
    expect(secondAttempt.allocatedBedId).toBe(targetBedId);
  });
});
