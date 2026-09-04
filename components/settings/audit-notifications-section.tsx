'use client';

import React, { useState, useEffect } from 'react';
import {
  AuditNotificationRule,
  AuditNotificationLog,
  NotificationChannel,
} from '@/lib/notifications/types';
import {
  getNotificationRules,
  saveNotificationRule,
  deleteNotificationRule,
  sendTestNotification,
  getNotificationDeliveryHistory,
} from '@/lib/notifications/notification-service';
import { AuditAction, AuditSeverity } from '@/lib/audit/logger';
import {
  Bell,
  Slack,
  Mail,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Send,
  Zap,
  ShieldAlert,
  History,
  Radio,
  ExternalLink,
  Info,
} from 'lucide-react';

interface AuditNotificationsSectionProps {
  tenantId: string;
}

const AVAILABLE_ACTIONS: { action: AuditAction; label: string; description: string; critical: boolean }[] = [
  { action: 'DELETE', label: 'DELETE (Record Deletion)', description: 'Patient records, encounters, orders, or tariffs deletion', critical: true },
  { action: 'OFFLINE_SYNC_OVERRIDE', label: 'OFFLINE_SYNC_OVERRIDE', description: 'Manual clinical override or split-brain resolution', critical: true },
  { action: 'CONFLICT_DETECTED', label: 'CONFLICT_DETECTED', description: 'Concurrent multi-station conflict during offline sync', critical: false },
  { action: 'PATIENT_MERGE', label: 'PATIENT_MERGE', description: 'Master Patient Index (MPI) deduplication & medical history fusion', critical: true },
  { action: 'AUTH_LOGIN', label: 'AUTH_LOGIN (Break-Glass)', description: 'Emergency break-glass access or unauthorized login attempts', critical: false },
  { action: 'MAR_ADMINISTRATION', label: 'MAR_ADMINISTRATION', description: 'Controlled narcotic or high-risk medication administration', critical: false },
  { action: 'SOAP_RECONCILE', label: 'SOAP_RECONCILE', description: 'Physician clinical diagnosis and progress note final sign-off', critical: false },
];

export function AuditNotificationsSection({ tenantId }: AuditNotificationsSectionProps) {
  const [rules, setRules] = useState<AuditNotificationRule[]>([]);
  const [logs, setLogs] = useState<AuditNotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [testingRuleId, setTestingRuleId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string; latencyMs: number } | null>(null);

  // Form State for New/Editing Rule
  const [editingRule, setEditingRule] = useState<Partial<AuditNotificationRule>>({
    name: '',
    enabled: true,
    triggerActions: ['DELETE', 'OFFLINE_SYNC_OVERRIDE'],
    minSeverity: 'WARNING',
    channel: 'both',
    slackWebhookUrl: '',
    slackChannel: '#hipaa-security-alerts',
    emailRecipients: ['ciso@centralmetro.health'],
    throttleMinutes: 0,
  });

  const [emailInput, setEmailInput] = useState('ciso@centralmetro.health');

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedRules, fetchedLogs] = await Promise.all([
        getNotificationRules(tenantId),
        getNotificationDeliveryHistory(tenantId),
      ]);
      setRules(fetchedRules);
      setLogs(fetchedLogs);
    } catch (err) {
      console.error('Failed to load notification settings:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleRule = async (rule: AuditNotificationRule) => {
    const updated = { ...rule, enabled: !rule.enabled };
    setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    await saveNotificationRule(tenantId, updated);
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (typeof window !== 'undefined' && window.confirm('Delete this automated notification rule?')) {
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      await deleteNotificationRule(tenantId, ruleId);
    }
  };

  const handleTestRule = async (rule: AuditNotificationRule) => {
    setTestingRuleId(rule.id);
    setTestResult(null);
    try {
      const res = await sendTestNotification({
        tenantId,
        rule,
        sampleAction: rule.triggerActions[0] || 'DELETE',
        sampleResource: 'encounters/enc_cardio_98412',
        sampleSeverity: rule.minSeverity || 'CRITICAL',
      });
      setTestResult({
        id: rule.id,
        success: res.success,
        message: res.message,
        latencyMs: res.latencyMs,
      });
      // refresh logs
      const updatedLogs = await getNotificationDeliveryHistory(tenantId);
      setLogs(updatedLogs);
    } catch (err: any) {
      setTestResult({
        id: rule.id,
        success: false,
        message: err?.message || 'Test dispatch failed',
        latencyMs: 0,
      });
    } finally {
      setTestingRuleId(null);
    }
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule.name) return;

    const recipients = emailInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const ruleToSave: AuditNotificationRule = {
      id: editingRule.id || `rule_${Date.now()}`,
      tenantId,
      name: editingRule.name || 'Automated Audit Alert',
      enabled: editingRule.enabled !== false,
      triggerActions: editingRule.triggerActions && editingRule.triggerActions.length > 0 ? editingRule.triggerActions : ['DELETE'],
      minSeverity: editingRule.minSeverity || 'WARNING',
      channel: editingRule.channel || 'both',
      slackWebhookUrl: editingRule.slackWebhookUrl || '',
      slackChannel: editingRule.slackChannel || '#hipaa-security-alerts',
      emailRecipients: recipients.length > 0 ? recipients : ['ciso@centralmetro.health'],
      throttleMinutes: Number(editingRule.throttleMinutes) || 0,
      triggerCount: editingRule.triggerCount || 0,
      createdAt: editingRule.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = await saveNotificationRule(tenantId, ruleToSave);
    setRules((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      if (idx >= 0) {
        return prev.map((r) => (r.id === saved.id ? saved : r));
      }
      return [saved, ...prev];
    });

    setShowRuleModal(false);
    setEditingRule({
      name: '',
      enabled: true,
      triggerActions: ['DELETE', 'OFFLINE_SYNC_OVERRIDE'],
      minSeverity: 'WARNING',
      channel: 'both',
      slackWebhookUrl: '',
      slackChannel: '#hipaa-security-alerts',
      emailRecipients: ['ciso@centralmetro.health'],
      throttleMinutes: 0,
    });
  };

  const toggleActionSelection = (action: AuditAction) => {
    const current = editingRule.triggerActions || [];
    if (current.includes(action)) {
      setEditingRule({
        ...editingRule,
        triggerActions: current.filter((a) => a !== action),
      });
    } else {
      setEditingRule({
        ...editingRule,
        triggerActions: [...current, action],
      });
    }
  };

  return (
    <div className="space-y-6 pt-4 border-t border-slate-100 dark:border-slate-800">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
              Automated Audit Alert & Webhook Triggers
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              HIPAA §164.312(b)
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Instantly dispatch Slack incoming webhooks or encrypted Email notices when critical actions such as <code className="font-mono text-red-500 font-bold">DELETE</code> or <code className="font-mono text-amber-500 font-bold">OFFLINE_SYNC_OVERRIDE</code> are committed to the immutable audit ledger.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingRule({
              name: '',
              enabled: true,
              triggerActions: ['DELETE', 'OFFLINE_SYNC_OVERRIDE'],
              minSeverity: 'WARNING',
              channel: 'both',
              slackWebhookUrl: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
              slackChannel: '#hipaa-security-alerts',
              emailRecipients: ['ciso@centralmetro.health'],
              throttleMinutes: 0,
            });
            setEmailInput('ciso@centralmetro.health, compliance@centralmetro.health');
            setShowRuleModal(true);
          }}
          className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Alert Rule</span>
        </button>
      </div>

      {/* Rules List */}
      <div className="space-y-3">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
            <span>Loading active audit notification triggers...</span>
          </div>
        ) : rules.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
            No automated audit triggers configured. Click &quot;New Alert Rule&quot; to configure automated Slack or Email alerts for deletions and offline sync overrides.
          </div>
        ) : (
          rules.map((rule) => {
            const isTesting = testingRuleId === rule.id;
            const activeTest = testResult?.id === rule.id ? testResult : null;

            return (
              <div
                key={rule.id}
                className={`p-4 rounded-xl border transition-all ${
                  rule.enabled
                    ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs'
                    : 'border-slate-200/60 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-900/40 opacity-75'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left: Info */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-bold text-xs text-slate-900 dark:text-white">
                        {rule.name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase ${
                          rule.minSeverity === 'CRITICAL'
                            ? 'bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                            : rule.minSeverity === 'WARNING'
                            ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                            : 'bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                        }`}
                      >
                        Min: {rule.minSeverity}
                      </span>

                      {/* Channel Badge */}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {rule.channel === 'slack' && <Slack className="w-3 h-3 text-emerald-500" />}
                        {rule.channel === 'email' && <Mail className="w-3 h-3 text-blue-500" />}
                        {rule.channel === 'both' && (
                          <>
                            <Slack className="w-3 h-3 text-emerald-500" />
                            <span>+</span>
                            <Mail className="w-3 h-3 text-blue-500" />
                          </>
                        )}
                        <span className="capitalize">{rule.channel}</span>
                      </span>
                    </div>

                    {/* Trigger Actions Chips */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[11px] text-slate-400 font-medium">Triggers on:</span>
                      {rule.triggerActions.map((action, idx) => (
                        <span
                          key={idx}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                            action === 'DELETE'
                              ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
                              : action === 'OFFLINE_SYNC_OVERRIDE'
                              ? 'bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {action}
                        </span>
                      ))}
                    </div>

                    {/* Routing Details */}
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1">
                      {(rule.channel === 'slack' || rule.channel === 'both') && (
                        <span>
                          Slack Target: <strong className="text-slate-700 dark:text-slate-200 font-mono">{rule.slackChannel || '#hipaa-security-alerts'}</strong>
                        </span>
                      )}
                      {(rule.channel === 'email' || rule.channel === 'both') && (
                        <span>
                          Recipients: <strong className="text-slate-700 dark:text-slate-200">{rule.emailRecipients?.join(', ') || 'ciso@centralmetro.health'}</strong>
                        </span>
                      )}
                      {rule.lastTriggeredAt && (
                        <span className="text-[10px] text-slate-400">
                          Last triggered: {new Date(rule.lastTriggeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({rule.triggerCount || 0} times)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleTestRule(rule)}
                      disabled={isTesting}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      title="Send a sample test notification payload"
                    >
                      {isTesting ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                      ) : (
                        <Send className="w-3.5 h-3.5 text-blue-500" />
                      )}
                      <span>{isTesting ? 'Testing...' : 'Test Dispatch'}</span>
                    </button>

                    <label className="relative inline-flex items-center cursor-pointer ml-1">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => handleToggleRule(rule)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>

                    <button
                      type="button"
                      onClick={() => handleDeleteRule(rule.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                      title="Delete Rule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Test Feedback banner */}
                {activeTest && (
                  <div
                    className={`mt-3 p-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 animate-in fade-in duration-150 ${
                      activeTest.success
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300'
                        : 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-800 dark:text-red-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {activeTest.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                      )}
                      <span>{activeTest.message}</span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">
                      {activeTest.latencyMs}ms
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Live Notification Delivery Stream */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" />
            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Recent Alert Dispatch Ledger
            </h4>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            Last {logs.length} transmissions
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Action Trigger</th>
                <th className="py-2.5 px-3">Channel & Target</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Delivery Response</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-[11px]">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-400 font-sans">
                    No alert dispatches recorded yet.
                  </td>
                </tr>
              ) : (
                logs.slice(0, 5).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                    <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          log.auditAction === 'DELETE'
                            ? 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300'
                            : log.auditAction === 'OFFLINE_SYNC_OVERRIDE'
                            ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                            : 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                        }`}
                      >
                        {log.auditAction}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 truncate max-w-xs font-sans">
                      {log.recipient}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-sans">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{log.status}</span>
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-500 dark:text-slate-400 truncate max-w-sm font-sans text-[11px]">
                      {log.message}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal for Creating New Rule */}
      {showRuleModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Configure Automated Audit Notification Rule
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRuleModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="space-y-4 text-xs">
              {/* Rule Name */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  Rule Name / Purpose
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Critical Deletion Alerts to CISO Slack"
                  value={editingRule.name || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Action Multiselect */}
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Trigger on Audit Actions:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-750">
                  {AVAILABLE_ACTIONS.map((item) => {
                    const isSelected = editingRule.triggerActions?.includes(item.action);
                    return (
                      <label
                        key={item.action}
                        className={`p-2 rounded-lg border flex items-start gap-2 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleActionSelection(item.action)}
                          className="mt-0.5 w-3.5 h-3.5 text-blue-600 rounded"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-bold text-[11px] text-slate-900 dark:text-white flex items-center justify-between">
                            <span>{item.action}</span>
                            {item.critical && (
                              <span className="text-[9px] px-1 py-0.2 bg-red-100 dark:bg-red-950 text-red-600 rounded">
                                High Risk
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                            {item.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Delivery Channel */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300">
                    Delivery Channel
                  </label>
                  <select
                    value={editingRule.channel}
                    onChange={(e) => setEditingRule({ ...editingRule, channel: e.target.value as NotificationChannel })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                  >
                    <option value="both">Both (Slack + Email)</option>
                    <option value="slack">Slack Webhook Only</option>
                    <option value="email">Email Gateway Only</option>
                    <option value="webhook">Custom Webhook Bus</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300">
                    Minimum Severity
                  </label>
                  <select
                    value={editingRule.minSeverity}
                    onChange={(e) => setEditingRule({ ...editingRule, minSeverity: e.target.value as AuditSeverity })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                  >
                    <option value="CRITICAL">CRITICAL (High-Risk Only)</option>
                    <option value="WARNING">WARNING & Above (Recommended)</option>
                    <option value="INFO">INFO (All Committed Events)</option>
                  </select>
                </div>
              </div>

              {/* Slack Inputs */}
              {(editingRule.channel === 'slack' || editingRule.channel === 'both') && (
                <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-750 space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                    <Slack className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Slack Incoming Webhook Details</span>
                  </div>
                  <div className="space-y-1">
                    <input
                      type="url"
                      placeholder="https://hooks.slack.com/services/T00/B00/XXXXX"
                      value={editingRule.slackWebhookUrl || ''}
                      onChange={(e) => setEditingRule({ ...editingRule, slackWebhookUrl: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500 font-medium">Channel:</span>
                    <input
                      type="text"
                      placeholder="#hipaa-security-alerts"
                      value={editingRule.slackChannel || ''}
                      onChange={(e) => setEditingRule({ ...editingRule, slackChannel: e.target.value })}
                      className="flex-1 px-3 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Email Inputs */}
              {(editingRule.channel === 'email' || editingRule.channel === 'both') && (
                <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-750 space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                    <Mail className="w-3.5 h-3.5 text-blue-500" />
                    <span>Email Alert Recipients</span>
                  </div>
                  <input
                    type="text"
                    placeholder="ciso@centralmetro.health, compliance@centralmetro.health"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                  />
                  <div className="text-[10px] text-slate-400">
                    Separate multiple staff email addresses with commas.
                  </div>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowRuleModal(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  Save Alert Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
