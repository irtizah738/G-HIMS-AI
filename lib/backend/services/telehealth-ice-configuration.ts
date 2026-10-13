import 'server-only';
import { createHmac } from 'node:crypto';

type IceServer = { urls: string[]; username?: string; credential?: string };

function urlsFromEnv(name: string, prefixes: readonly string[]): string[] {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return [];
  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch {
    throw new Error('TELEHEALTH_ICE_CONFIG_INVALID: ' + name + ' must be a JSON array.');
  }
  if (!Array.isArray(decoded) || decoded.length > 8 ||
      decoded.some(x => typeof x !== 'string' || x.length > 240 ||
        !prefixes.some(prefix => x.startsWith(prefix)))) {
    throw new Error('TELEHEALTH_ICE_CONFIG_INVALID: unsupported server URL in ' + name);
  }
  return [...new Set(decoded)] as string[];
}

export function buildTelehealthIceConfiguration(roomToken: string): {
  iceServers: IceServer[];
  relayConfigured: boolean;
  credentialExpiresAt: number | null;
} {
  const stun = urlsFromEnv('GHIMS_WEBRTC_STUN_URLS_JSON', ['stun:', 'stuns:']);
  const turn = urlsFromEnv('GHIMS_WEBRTC_TURN_URLS_JSON', ['turn:', 'turns:']);
  const servers: IceServer[] = stun.length ? [{ urls: stun }] : [];
  if (!turn.length) {
    return { iceServers: servers, relayConfigured: false, credentialExpiresAt: null };
  }
  // Coturn REST ephemeral credentials: never store shared secret in a
  // NEXT_PUBLIC_ variable, a patient URL, Firestore or a static JS bundle.
  const secret = String(process.env.GHIMS_WEBRTC_TURN_REST_SECRET || '');
  if (secret.length < 32) {
    throw new Error('TELEHEALTH_TURN_SECRET_NOT_CONFIGURED');
  }
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + 3600;
  const subject = createHmac('sha256', secret).update(roomToken).digest('hex').slice(0, 20);
  const username = `${expiresAtSeconds}:ghims-${subject}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  servers.push({ urls: turn, username, credential });
  return { iceServers: servers, relayConfigured: true,
    credentialExpiresAt: expiresAtSeconds * 1000 };
}
