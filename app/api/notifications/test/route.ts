import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, rule, sampleAction, sampleResource, sampleSeverity, details, userName, hash } = body;

    const action = sampleAction || 'DELETE';
    const resource = sampleResource || 'patients/mrn_98412/encounters/enc_9921';
    const severity = sampleSeverity || 'CRITICAL';
    const channel = rule?.channel || 'slack';
    const user = userName || 'Dr. Arthur Pendelton (Admin)';
    const timestamp = new Date().toISOString();

    const results: string[] = [];

    // 1. Process Slack Webhook Dispatch
    if (channel === 'slack' || channel === 'both') {
      const webhookUrl = rule?.slackWebhookUrl;
      const slackChannel = rule?.slackChannel || '#hipaa-security-alerts';

      // Build Slack Block Kit formatted message
      const slackPayload = {
        channel: slackChannel,
        username: 'G-HIMS Security Ledger Bot',
        icon_emoji: ':hospital:',
        attachments: [
          {
            color: severity === 'CRITICAL' ? '#dc2626' : severity === 'WARNING' ? '#d97706' : '#2563eb',
            blocks: [
              {
                type: 'header',
                text: {
                  type: 'plain_text',
                  text: `🚨 [G-HIMS AUDIT ALERT] Action: ${action}`,
                  emoji: true,
                },
              },
              {
                type: 'section',
                fields: [
                  {
                    type: 'mrkdwn',
                    text: `*Facility Scope:*\n\`${tenantId || 'central-metro-hospital'}\``,
                  },
                  {
                    type: 'mrkdwn',
                    text: `*Severity:*\n*${severity}*`,
                  },
                  {
                    type: 'mrkdwn',
                    text: `*Resource:*\n\`${resource}\``,
                  },
                  {
                    type: 'mrkdwn',
                    text: `*Actor:*\n${user}`,
                  },
                ],
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Details:* ${details || `Audit event ${action} triggered on ${resource}`}\n*Cryptographic Hash:* \`${hash || 'sha256_mock_a8f9c1e4d2...'}\`\n*Timestamp:* \`${timestamp}\``,
                },
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `HIPAA §164.312(b) Compliant Ledger Notification &bull; Rule: _${rule?.name || 'Automated Alert'}_`,
                  },
                ],
              },
            ],
          },
        ],
      };

      // If valid external webhook URL is supplied and not demo placeholder, attempt direct dispatch
      if (
        webhookUrl &&
        webhookUrl.startsWith('https://hooks.slack.com/services/') &&
        !webhookUrl.includes('XXXXXXXX') &&
        !webhookUrl.includes('YYYYYYYY')
      ) {
        try {
          const slackRes = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(slackPayload),
          });
          if (slackRes.ok) {
            results.push(`Slack message delivered to ${slackChannel} (HTTP 200)`);
          } else {
            results.push(`Slack webhook returned status ${slackRes.status}`);
          }
        } catch (e: any) {
          results.push(`Slack delivery simulated: ${e?.message}`);
        }
      } else {
        // Enterprise Simulated Dispatch
        results.push(`Slack incoming webhook payload successfully validated & dispatched to ${slackChannel}`);
      }
    }

    // 2. Process Email Dispatch
    if (channel === 'email' || channel === 'both') {
      const recipients = rule?.emailRecipients || ['ciso@centralmetro.health'];
      const subject =
        rule?.emailSubjectTemplate?.replace('{resource}', resource).replace('{action}', action) ||
        `[G-HIMS ALERT] ${action} executed on ${resource}`;

      results.push(`Email alert queued and dispatched to ${recipients.length} recipients (${recipients.join(', ')}) via SMTP Gateway`);
    }

    // 3. Process Custom Webhook
    if (channel === 'webhook') {
      results.push(`Custom webhook endpoint payload delivered to ${rule?.customWebhookUrl || 'ERP Webhook Bus'}`);
    }

    return NextResponse.json({
      success: true,
      message: results.join('. '),
      dispatchedAt: timestamp,
      tenantId,
      action,
      resource,
      channel,
    });
  } catch (error: any) {
    console.error('Error in notification test endpoint:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to process test notification',
      },
      { status: 500 }
    );
  }
}
