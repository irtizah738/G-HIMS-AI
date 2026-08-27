/**
 * G-HIMS Client Session Manager, Workstation Inactivity Lock & Device Fingerprint
 */

import { UserDeviceRecord } from './auth-types';

const DEVICE_ID_KEY = 'ghims_workstation_device_id';
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes hospital clinical terminal standard
const WARNING_BEFORE_TIMEOUT_MS = 60 * 1000; // 1 minute warning

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'server-env';
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function generateDeviceMetadata(): Partial<UserDeviceRecord> {
  if (typeof window === 'undefined') {
    return {
      deviceId: 'server-env',
      deviceType: 'DESKTOP',
      platform: 'Server',
      appVersion: '1.0.0',
    };
  }

  const userAgent = navigator.userAgent;
  let deviceType: 'DESKTOP' | 'TABLET' | 'MOBILE' = 'DESKTOP';
  if (/iPad|tablet/i.test(userAgent)) {
    deviceType = 'TABLET';
  } else if (/Mobi|Android|iPhone/i.test(userAgent)) {
    deviceType = 'MOBILE';
  }

  const platform = navigator.platform || 'Browser';
  const deviceId = getOrCreateDeviceId();

  return {
    deviceId,
    deviceType,
    platform,
    appVersion: '2026.1.0',
  };
}

export class InactivityMonitor {
  private timeoutId: NodeJS.Timeout | null = null;
  private warningTimeoutId: NodeJS.Timeout | null = null;
  private lastActivityTime: number = Date.now();
  private onTimeoutCallback: () => void;
  private onWarningCallback?: () => void;
  private isListening = false;

  constructor(onTimeout: () => void, onWarning?: () => void) {
    this.onTimeoutCallback = onTimeout;
    this.onWarningCallback = onWarning;
  }

  public start(customTimeoutMs?: number): void {
    if (typeof window === 'undefined') return;
    this.stop();
    this.isListening = true;

    const timeout = customTimeoutMs || INACTIVITY_TIMEOUT_MS;
    const warningTime = Math.max(10000, timeout - WARNING_BEFORE_TIMEOUT_MS);

    const activityHandler = () => {
      this.lastActivityTime = Date.now();
      this.resetTimers(timeout, warningTime);
    };

    window.addEventListener('mousemove', activityHandler, { passive: true });
    window.addEventListener('keydown', activityHandler, { passive: true });
    window.addEventListener('touchstart', activityHandler, { passive: true });
    window.addEventListener('click', activityHandler, { passive: true });

    this.resetTimers(timeout, warningTime);
  }

  private resetTimers(timeout: number, warningTime: number): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.warningTimeoutId) clearTimeout(this.warningTimeoutId);

    if (this.onWarningCallback) {
      this.warningTimeoutId = setTimeout(() => {
        this.onWarningCallback?.();
      }, warningTime);
    }

    this.timeoutId = setTimeout(() => {
      this.onTimeoutCallback();
    }, timeout);
  }

  public stop(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.warningTimeoutId) clearTimeout(this.warningTimeoutId);
    this.timeoutId = null;
    this.warningTimeoutId = null;
    this.isListening = false;
  }

  public getLastActivity(): number {
    return this.lastActivityTime;
  }
}
