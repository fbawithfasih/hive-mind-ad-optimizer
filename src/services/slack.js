/**
 * Slack incoming-webhook delivery for campaign-alert fires.
 *
 * One webhook URL per Organization (Organization.slackWebhookUrl). When set,
 * the alert evaluation worker posts a Block Kit summary to that channel
 * alongside email delivery. Failures are logged but never throw — Slack
 * delivery is strictly best-effort, the same as email.
 */

import axios from 'axios';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('SLACK');

const VERB = { gt: 'above', gte: 'at or above', lt: 'below', lte: 'at or below' };

function fmtVal(metric, value) {
  if (value == null) return '—';
  if (metric === 'acos' || metric === 'ctr') return `${(value * 100).toFixed(2)}%`;
  if (metric === 'roas')                     return `${value.toFixed(2)}×`;
  if (metric === 'spend')                    return `$${value.toFixed(2)}`;
  return Number(value).toLocaleString('en-US');
}

/**
 * @param {string} webhookUrl
 * @param {object} opts
 * @param {string} opts.orgName
 * @param {Array<object>} opts.fires  alertName, campaignName, metric, condition, threshold, value
 * @param {string} [opts.dashboardUrl]
 */
export async function sendCampaignAlertSlack(webhookUrl, { orgName, fires, dashboardUrl }) {
  if (!webhookUrl)        return null;
  if (!fires?.length)     return null;

  const headerText = fires.length === 1
    ? `🔔 Alert "${fires[0].alertName}" fired on ${fires[0].campaignName}`
    : `🔔 ${fires.length} campaign alerts fired (${orgName})`;

  // Slack caps blocks at 50 per message; keep a safe ceiling.
  const visible = fires.slice(0, 20);
  const omitted = fires.length - visible.length;

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: headerText, emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `*${orgName}* · scheduled alert sweep` }] },
    { type: 'divider' },
    ...visible.map(f => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*${escapeMd(f.alertName)}* — ${escapeMd(f.campaignName)}\n` +
          `${f.metric.toUpperCase()} *${fmtVal(f.metric, f.value)}* (${VERB[f.condition] ?? f.condition} ${fmtVal(f.metric, f.threshold)})`,
      },
    })),
    ...(omitted > 0 ? [{
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `…and *${omitted}* more — see the dashboard.` }],
    }] : []),
    ...(dashboardUrl ? [{
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Open alerts dashboard', emoji: true },
        url:  dashboardUrl,
      }],
    }] : []),
  ];

  try {
    await axios.post(webhookUrl, { text: headerText, blocks }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    });
    logger.info(`Slack alert posted for ${orgName} (${fires.length} fires)`);
    return { ok: true };
  } catch (err) {
    const status = err.response?.status;
    const body   = err.response?.data;
    logger.error(`Slack post failed [${status}] for ${orgName}: ${typeof body === 'string' ? body : err.message}`);
    return { ok: false, error: err.message };
  }
}

// Slack mrkdwn isn't full Markdown — escape *, _, ~, ` and angle brackets.
function escapeMd(s) {
  return String(s ?? '').replace(/[*_~`<>]/g, (c) => '\\' + c);
}
