'use client';

const LOCK_NAME = 'ghims-edge-sync-leader';

export async function withEdgeSyncLeadership<T>(
  task: () => Promise<T>,
  fallback: T
): Promise<T> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    return task();
  }

  const locks = (navigator as Navigator & {
    locks: {
      request: <R>(
        name: string,
        options: { ifAvailable: boolean },
        callback: (lock: unknown | null) => Promise<R>
      ) => Promise<R>;
    };
  }).locks;

  return locks.request(
    LOCK_NAME,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return fallback;
      return task();
    }
  );
}
