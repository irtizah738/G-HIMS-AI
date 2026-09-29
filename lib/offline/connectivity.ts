export interface ConnectivityProbeResult {
  isOnline: boolean;
  latencyMs: number | null;
}

/**
 * Verifies that the running G-HIMS application origin is actually reachable.
 *
 * Browser navigator.onLine is only a transport hint and is unreliable inside
 * sandboxed previews, captive portals, VPNs and some managed browsers. The
 * authoritative client connectivity signal is a no-store same-origin health
 * request to the application server.
 */
export async function probeApplicationConnectivity(
  timeoutMs = 4000
): Promise<ConnectivityProbeResult> {
  if (typeof window === 'undefined') {
    return { isOnline: true, latencyMs: null };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(`/api/health?connectivityProbe=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        'x-ghims-connectivity-probe': '1',
      },
    });

    return {
      isOnline: response.ok,
      latencyMs: response.ok ? Math.round(performance.now() - startedAt) : null,
    };
  } catch {
    return { isOnline: false, latencyMs: null };
  } finally {
    window.clearTimeout(timeout);
  }
}
