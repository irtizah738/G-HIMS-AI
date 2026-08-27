import { VectorClock } from '@/types/offline';

/**
 * Returns a new Vector Clock with the specified node ID counter incremented by 1.
 */
export function incrementClock(clock: VectorClock | undefined, nodeId: string): VectorClock {
  const current = clock || {};
  const currentCount = current[nodeId] || 0;
  return {
    ...current,
    [nodeId]: currentCount + 1,
  };
}

/**
 * Merges two vector clocks by taking the pairwise maximum counter for every node.
 */
export function mergeClocks(a: VectorClock | undefined, b: VectorClock | undefined): VectorClock {
  const clockA = a || {};
  const clockB = b || {};
  const allKeys = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);
  const merged: VectorClock = {};

  for (const key of allKeys) {
    const valA = clockA[key] || 0;
    const valB = clockB[key] || 0;
    merged[key] = Math.max(valA, valB);
  }

  return merged;
}

/**
 * Compares two vector clocks to determine causality ordering.
 * Returns:
 * - 'EQUAL': identical vector state across all nodes
 * - 'GREATER': clock A strictly dominates clock B (A is causally newer)
 * - 'LESS': clock B strictly dominates clock A (B is causally newer)
 * - 'CONCURRENT': clocks have branched independently (conflict)
 */
export function compareClocks(
  a: VectorClock | undefined,
  b: VectorClock | undefined
): 'EQUAL' | 'GREATER' | 'LESS' | 'CONCURRENT' {
  const clockA = a || {};
  const clockB = b || {};

  const allKeys = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);

  let aHasGreater = false;
  let bHasGreater = false;

  for (const key of allKeys) {
    const valA = clockA[key] || 0;
    const valB = clockB[key] || 0;

    if (valA > valB) {
      aHasGreater = true;
    } else if (valB > valA) {
      bHasGreater = true;
    }
  }

  if (!aHasGreater && !bHasGreater) {
    return 'EQUAL';
  }
  if (aHasGreater && !bHasGreater) {
    return 'GREATER';
  }
  if (!aHasGreater && bHasGreater) {
    return 'LESS';
  }
  return 'CONCURRENT';
}

/**
 * Deterministically resolves vector clock conflicts between a client mutation and server state.
 * - If clocks are strictly ordered, choose the causal successor.
 * - If CONCURRENT, performs field-level merge for independent clinical fields,
 *   or applies Last-Write-Wins (LWW) with server authority timestamp while flagging isConflict.
 */
export function resolveVectorConflict<T extends Record<string, unknown>>(
  clientDoc: { data: T; clock: VectorClock; timestamp: number },
  serverDoc: { data: T; clock: VectorClock; timestamp: number }
): { resolvedData: T; resolvedClock: VectorClock; isConflict: boolean } {
  const comparison = compareClocks(clientDoc.clock, serverDoc.clock);

  // Case 1: Client causally dominates server (client was based on current server state)
  if (comparison === 'GREATER' || comparison === 'EQUAL') {
    return {
      resolvedData: clientDoc.data,
      resolvedClock: clientDoc.clock,
      isConflict: false,
    };
  }

  // Case 2: Server causally dominates client (server has newer causal edits)
  if (comparison === 'LESS') {
    return {
      resolvedData: serverDoc.data,
      resolvedClock: serverDoc.clock,
      isConflict: false,
    };
  }

  // Case 3: CONCURRENT branch (Concurrent edits on disconnected nodes)
  const mergedClock = mergeClocks(clientDoc.clock, serverDoc.clock);

  // Field-level intelligent merge:
  // Combine non-overlapping fields; for overlapping keys, use timestamp LWW
  const resolved: Record<string, unknown> = { ...serverDoc.data };

  for (const key of Object.keys(clientDoc.data)) {
    const clientVal = clientDoc.data[key];
    const serverVal = serverDoc.data[key];

    if (serverVal === undefined) {
      // New field introduced on client
      resolved[key] = clientVal;
    } else if (JSON.stringify(serverVal) !== JSON.stringify(clientVal)) {
      // Conflicting field: use timestamp-based LWW
      if (clientDoc.timestamp > serverDoc.timestamp) {
        resolved[key] = clientVal;
      } else {
        resolved[key] = serverVal;
      }
    }
  }

  // Add audit conflict resolution flag
  resolved._conflictResolved = true;
  resolved._resolvedAt = Date.now();
  resolved._conflictStrategy = 'CRDT_FIELD_MERGE_LWW';

  return {
    resolvedData: resolved as T,
    resolvedClock: mergedClock,
    isConflict: true,
  };
}
