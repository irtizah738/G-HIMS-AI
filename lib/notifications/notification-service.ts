import { db } from '@/lib/firebase/client';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import {
  AuditNotificationRule,
  AuditNotificationLog,
  TestNotificationPayload,
  NotificationDeliveryStatus,
} from './types';
import { AuditLogEntry, AuditSeverity } from '@/lib/audit/logger';

const NOTIFICATIONS_STORAGE_KEY_PREFIX = 'ghims_notification_rules_';
const NOTIFICATION_LOGS_STORAGE_KEY_PREFIX = 'ghims_notification_logs_';

// Default pre-seeded rules targeting high-risk actions like DELETE and OFFLINE_SYNC_OVERRIDE
export const DEFAULT_NOTIFICATION_RULES: AuditNotificationRule[] = [
  {
    id: 'rule_critical_deletions',
    tenantId: 'central-metro-hospital',
    name: 'Emergency & Clinical Deletion Alerts (Slack + Email)',
    enabled: true,
    triggerActions: ['DELETE', 'PATIENT_MERGE'],
    minSeverity: 'CRITICAL',
    channel: 'both',
    slackWebhookUrl: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
    slackChannel: '#hipaa-security-alerts',
    emailRecipients: ['ciso@centralmetro.health', 'compliance-audits@centralmetro.health'],
    emailSubjectTemplate: '[G-HIMS HIPAA ALERT] Critical Deletion Detected on {resource}',
    throttleMinutes: 0,
    triggerCount: 3,
    lastTriggeredAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-02-15T14:30:00.000Z',
  },
  {
    id: 'rule_offline_override',
    tenantId: 'central-metro-hospital',
    name: 'Offline Sync Override & Split-Brain Warning (Slack)',
    enabled: true,
    triggerActions: ['OFFLINE_SYNC_OVERRIDE', 'CONFLICT_DETECTED'],
    minSeverity: 'WARNING',
    channel: 'slack',
    slackWebhookUrl: 'https://hooks.slack.com/services/T00000000/B00000000/YYYYYYYYYYYYYYYYYYYYYYYY',
    slackChannel: '#clinical-ops-dispatches',
    emailRecipients: ['clinical-it-lead@centralmetro.health'],
    throttleMinutes: 5,
    triggerCount: 7,
    lastTriggeredAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    createdAt: '2026-01-15T09:30:00.000Z',
    updatedAt: '2026-02-20T11:00:00.000Z',
  },
  {
    id: 'rule_auth_security',
    tenantId: 'central-metro-hospital',
    name: 'Security Breach & Break-Glass Escalation (Email)',
    enabled: true,
    triggerActions: ['AUTH_LOGIN', 'MAR_ADMINISTRATION'],
    minSeverity: 'CRITICAL',
    channel: 'email',
    emailRecipients: ['chief-medical-officer@centralmetro.health', 'security-ops@centralmetro.health'],
    emailSubjectTemplate: '[URGENT ESCALATION] Security Action {action} on {resource}',
    throttleMinutes: 0,
    triggerCount: 1,
    lastTriggeredAt: new Date(Date.now() - 1000 * 60 * 600).toISOString(),
    createdAt: '2026-01-20T12:00:00.000Z',
    updatedAt: '2026-02-25T16:00:00.000Z',
  },
];

// Initial mock delivery logs
export const DEFAULT_NOTIFICATION_LOGS: AuditNotificationLog[] = [
  {
    id: 'log_notif_001',
    tenantId: 'central-metro-hospital',
    ruleId: 'rule_critical_deletions',
    ruleName: 'Emergency & Clinical Deletion Alerts (Slack + Email)',
    auditAction: 'DELETE',
    severity: 'CRITICAL',
    resource: 'encounters/enc_cardio_9841',
    channel: 'both',
    recipient: '#hipaa-security-alerts, ciso@centralmetro.health',
    status: 'DELIVERED',
    responseCode: 200,
    message: 'Slack payload posted successfully (200 OK); Email dispatched to 2 recipients via SMTP gateway.',
    timestamp: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
  },
  {
    id: 'log_notif_002',
    tenantId: 'central-metro-hospital',
    ruleId: 'rule_offline_override',
    ruleName: 'Offline Sync Override & Split-Brain Warning (Slack)',
    auditAction: 'OFFLINE_SYNC_OVERRIDE',
    severity: 'WARNING',
    resource: 'prescriptions/rx_99214',
    channel: 'slack',
    recipient: '#clinical-ops-dispatches',
    status: 'DELIVERED',
    responseCode: 200,
    message: 'Slack incoming webhook delivered with 3 context blocks and cryptographic checksum.',
    timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
  },
  {
    id: 'log_notif_003',
    tenantId: 'central-metro-hospital',
    ruleId: 'rule_critical_deletions',
    ruleName: 'Emergency & Clinical Deletion Alerts (Slack + Email)',
    auditAction: 'DELETE',
    severity: 'CRITICAL',
    resource: 'tariffs/tariff_custom_042',
    channel: 'slack',
    recipient: '#hipaa-security-alerts',
    status: 'DELIVERED',
    responseCode: 200,
    message: 'Alert sent: Tariff pricing item deleted by administrator.',
    timestamp: new Date(Date.now() - 1000 * 60 * 1440).toISOString(),
  },
];

/**
 * Loads all notification rules for a tenant (Firestore with LocalStorage fallback)
 */
export async function getNotificationRules(tenantId: string): Promise<AuditNotificationRule[]> {
  const cleanTenant = tenantId || 'central-metro-hospital';

  // 1. Try Firestore
  try {
    if (typeof window !== 'undefined' && navigator.onLine) {
      const colRef = collection(db, 'tenants', cleanTenant, 'notificationRules');
      const snap = await getDocs(colRef);
      if (!snap.empty) {
        const rules: AuditNotificationRule[] = [];
        snap.forEach((docSnap) => {
          rules.push(docSnap.data() as AuditNotificationRule);
        });
        if (rules.length > 0) {
          saveRulesToLocalStorage(cleanTenant, rules);
          return rules;
        }
      }
    }
  } catch (err) {
    console.warn('Could not fetch notification rules from Firestore, checking local storage:', err);
  }

  // 2. Try LocalStorage
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(`${NOTIFICATIONS_STORAGE_KEY_PREFIX}${cleanTenant}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore JSON parse error
    }
  }

  // 3. Fallback to default seed rules
  const seed = DEFAULT_NOTIFICATION_RULES.map((r) => ({ ...r, tenantId: cleanTenant }));
  saveRulesToLocalStorage(cleanTenant, seed);
  return seed;
}

/**
 * Saves a notification rule (Firestore + LocalStorage)
 */
export async function saveNotificationRule(
  tenantId: string,
  rule: AuditNotificationRule
): Promise<AuditNotificationRule> {
  const cleanTenant = tenantId || 'central-metro-hospital';
  const updatedRule: AuditNotificationRule = {
    ...rule,
    tenantId: cleanTenant,
    updatedAt: new Date().toISOString(),
  };

  // 1. Update LocalStorage
  const current = await getNotificationRules(cleanTenant);
  const existsIndex = current.findIndex((r) => r.id === updatedRule.id);
  let updatedList: AuditNotificationRule[];
  if (existsIndex >= 0) {
    updatedList = current.map((r) => (r.id === updatedRule.id ? updatedRule : r));
  } else {
    updatedList = [updatedRule, ...current];
  }
  saveRulesToLocalStorage(cleanTenant, updatedList);

  // 2. Persist to Firestore
  try {
    if (typeof window !== 'undefined' && navigator.onLine) {
      const docRef = doc(db, 'tenants', cleanTenant, 'notificationRules', updatedRule.id);
      await setDoc(docRef, updatedRule, { merge: true });
    }
  } catch (err) {
    console.warn('Notice: Failed to sync notification rule to Firestore:', err);
  }

  return updatedRule;
}

/**
 * Deletes a notification rule
 */
export async function deleteNotificationRule(tenantId: string, ruleId: string): Promise<boolean> {
  const cleanTenant = tenantId || 'central-metro-hospital';

  // 1. Update LocalStorage
  const current = await getNotificationRules(cleanTenant);
  const filtered = current.filter((r) => r.id !== ruleId);
  saveRulesToLocalStorage(cleanTenant, filtered);

  // 2. Delete from Firestore
  try {
    if (typeof window !== 'undefined' && navigator.onLine) {
      const docRef = doc(db, 'tenants', cleanTenant, 'notificationRules', ruleId);
      await deleteDoc(docRef);
    }
  } catch (err) {
    console.warn('Notice: Failed to delete rule from Firestore:', err);
  }

  return true;
}

/**
 * Sends a test notification to verify Slack or Email connectivity
 */
export async function sendTestNotification(
  payload: TestNotificationPayload
): Promise<{ success: boolean; message: string; responseCode: number; latencyMs: number }> {
  const startTime = Date.now();
  const cleanTenant = payload.tenantId || 'central-metro-hospital';

  try {
    const response = await fetch('/api/notifications/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    // Log the test in delivery history
    const logItem: AuditNotificationLog = {
      id: `log_test_${Date.now()}`,
      tenantId: cleanTenant,
      ruleId: payload.rule.id || 'rule_manual_test',
      ruleName: payload.rule.name || 'Manual Connectivity Test',
      auditAction: payload.sampleAction || 'DELETE',
      severity: payload.sampleSeverity || 'CRITICAL',
      resource: payload.sampleResource || 'test/sample_encounter_9918',
      channel: payload.rule.channel || 'slack',
      recipient: payload.rule.channel === 'slack' ? (payload.rule.slackChannel || 'Slack Webhook') : (payload.rule.emailRecipients?.join(', ') || 'Email Recipients'),
      status: response.ok ? 'DELIVERED' : 'FAILED',
      responseCode: response.status,
      message: data.message || (response.ok ? 'Test payload successfully transmitted' : 'Dispatch failed'),
      timestamp: new Date().toISOString(),
    };
    await recordNotificationLog(cleanTenant, logItem);

    return {
      success: response.ok,
      message: data.message || 'Notification test completed.',
      responseCode: response.status,
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      message: err?.message || 'Network error during notification test dispatch.',
      responseCode: 500,
      latencyMs,
    };
  }
}

/**
 * Records a notification delivery log
 */
export async function recordNotificationLog(
  tenantId: string,
  log: AuditNotificationLog
): Promise<void> {
  const cleanTenant = tenantId || 'central-metro-hospital';

  // 1. Update LocalStorage
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(`${NOTIFICATION_LOGS_STORAGE_KEY_PREFIX}${cleanTenant}`);
      const list: AuditNotificationLog[] = cached ? JSON.parse(cached) : [...DEFAULT_NOTIFICATION_LOGS];
      const updated = [log, ...list].slice(0, 50); // keep last 50
      localStorage.setItem(`${NOTIFICATION_LOGS_STORAGE_KEY_PREFIX}${cleanTenant}`, JSON.stringify(updated));
    } catch {
      // ignore
    }
  }

  // 2. Persist to Firestore
  try {
    if (typeof window !== 'undefined' && navigator.onLine) {
      const docRef = doc(db, 'tenants', cleanTenant, 'notificationLogs', log.id);
      await setDoc(docRef, log);
    }
  } catch (err) {
    console.warn('Notice: Could not persist notification log to Firestore:', err);
  }
}

/**
 * Retrieves delivery logs for a tenant
 */
export async function getNotificationDeliveryHistory(
  tenantId: string
): Promise<AuditNotificationLog[]> {
  const cleanTenant = tenantId || 'central-metro-hospital';

  // 1. Try Firestore
  try {
    if (typeof window !== 'undefined' && navigator.onLine) {
      const colRef = collection(db, 'tenants', cleanTenant, 'notificationLogs');
      const q = query(colRef, orderBy('timestamp', 'desc'), limit(30));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const logs: AuditNotificationLog[] = [];
        snap.forEach((docSnap) => {
          logs.push(docSnap.data() as AuditNotificationLog);
        });
        return logs;
      }
    }
  } catch {
    // fallback
  }

  // 2. Try LocalStorage
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(`${NOTIFICATION_LOGS_STORAGE_KEY_PREFIX}${cleanTenant}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
  }

  return DEFAULT_NOTIFICATION_LOGS.map((l) => ({ ...l, tenantId: cleanTenant }));
}

/**
 * Dispatches automated alerts for an audit event based on active tenant rules.
 * Non-blocking for high-throughput clinical workflows.
 */
export async function dispatchAuditAlerts(entry: AuditLogEntry): Promise<void> {
  const tenantId = entry.tenantId || 'central-metro-hospital';

  try {
    const rules = await getNotificationRules(tenantId);
    const matchingRules = rules.filter((rule) => {
      if (!rule.enabled) return false;
      const actionMatches =
        rule.triggerActions.includes(entry.action) ||
        rule.triggerActions.includes('*') ||
        (rule.triggerActions.includes('DELETE') && entry.action === 'DELETE') ||
        (rule.triggerActions.includes('OFFLINE_SYNC_OVERRIDE') && entry.action === 'OFFLINE_SYNC_OVERRIDE');

      if (!actionMatches) return false;

      // Severity check
      const entrySeverity = entry.severity || 'INFO';
      if (rule.minSeverity === 'CRITICAL' && entrySeverity !== 'CRITICAL') return false;
      if (rule.minSeverity === 'WARNING' && entrySeverity === 'INFO') return false;

      return true;
    });

    if (matchingRules.length === 0) return;

    for (const rule of matchingRules) {
      // Send dispatch asynchronously
      (async () => {
        try {
          const res = await fetch('/api/notifications/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              rule,
              sampleAction: entry.action,
              sampleResource: entry.resource,
              sampleSeverity: entry.severity,
              auditLogId: entry.id,
              details: entry.details,
              userName: entry.userName,
              hash: entry.hash,
            }),
          });

          const data = await res.json();
          const logItem: AuditNotificationLog = {
            id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            tenantId,
            ruleId: rule.id,
            ruleName: rule.name,
            auditLogId: entry.id,
            auditAction: entry.action,
            severity: entry.severity || 'INFO',
            resource: entry.resource,
            channel: rule.channel,
            recipient:
              rule.channel === 'slack'
                ? rule.slackChannel || 'Slack Webhook'
                : rule.emailRecipients?.join(', ') || 'Email List',
            status: res.ok ? 'DELIVERED' : 'FAILED',
            responseCode: res.status,
            message: data.message || (res.ok ? 'Automated alert delivered' : 'Delivery failure'),
            timestamp: new Date().toISOString(),
          };

          await recordNotificationLog(tenantId, logItem);
        } catch (dispatchErr) {
          console.warn(`Automated alert dispatch failed for rule ${rule.id}:`, dispatchErr);
        }
      })();
    }
  } catch (err) {
    console.warn('Failed to evaluate audit notification rules:', err);
  }
}

function saveRulesToLocalStorage(tenantId: string, rules: AuditNotificationRule[]) {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`${NOTIFICATIONS_STORAGE_KEY_PREFIX}${tenantId}`, JSON.stringify(rules));
    } catch {
      // ignore
    }
  }
}
