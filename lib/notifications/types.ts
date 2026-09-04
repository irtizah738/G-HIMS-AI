import { AuditAction, AuditSeverity } from '@/lib/audit/logger';

export type NotificationChannel = 'slack' | 'email' | 'webhook' | 'both';

export interface AuditNotificationRule {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  triggerActions: (AuditAction | string)[];
  minSeverity: AuditSeverity;
  channel: NotificationChannel;
  slackWebhookUrl?: string;
  slackChannel?: string;
  emailRecipients?: string[];
  emailSubjectTemplate?: string;
  customWebhookUrl?: string;
  throttleMinutes: number;
  lastTriggeredAt?: string;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
}

export type NotificationDeliveryStatus = 'DELIVERED' | 'FAILED' | 'THROTTLED' | 'SIMULATED';

export interface AuditNotificationLog {
  id: string;
  tenantId: string;
  ruleId: string;
  ruleName: string;
  auditLogId?: string;
  auditAction: string;
  severity: AuditSeverity;
  resource: string;
  channel: NotificationChannel;
  recipient: string;
  status: NotificationDeliveryStatus;
  responseCode?: number;
  message: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface TestNotificationPayload {
  tenantId: string;
  rule: Partial<AuditNotificationRule>;
  sampleAction?: AuditAction | string;
  sampleResource?: string;
  sampleSeverity?: AuditSeverity;
}
