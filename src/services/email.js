/**
 * Email service — Resend HTTP API
 *
 * Why HTTP, not SMTP: some hosts (Railway, certain Render plans) block
 * outbound SMTP ports (465/587), causing connection timeouts. The HTTP
 * API uses port 443 and works everywhere.
 *
 * Required env vars:
 *   RESEND_API_KEY  — from https://resend.com/api-keys
 *   MAIL_FROM       — "From" address on a verified Resend domain,
 *                     e.g. "Hive Mind Nestor <info@hivemindnestor.com>"
 *                     (falls back to SMTP_FROM for backwards compat)
 */

import { Resend } from 'resend';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('EMAIL');

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY env var is required for sending email');
  }
  _client = new Resend(apiKey);
  logger.info('Email client configured (Resend HTTP API)');
  return _client;
}

const FROM = () => process.env.MAIL_FROM || process.env.SMTP_FROM || 'Hive Mind Nestor <noreply@hivemindnestor.com>';
const APP_NAME = 'Hive Mind Nestor';
const BRAND_TAGLINE = 'Amazon Advertising Intelligence';
const BRAND_URL     = 'https://www.hivemindnestor.com';
const FRONTEND_URL  = () => process.env.FRONTEND_URL || 'http://localhost:5173';
// Email clients fetch this absolute URL; the asset is served by the SPA.
// Override via EMAIL_LOGO_URL if hosting the logo elsewhere.
const LOGO_URL = () => process.env.EMAIL_LOGO_URL || 'https://optimizer.hivemindnestor.com/HMN-APP-ICON.png';
const CONFIDENTIAL_TXT =
  'CONFIDENTIAL — This message and any attachments contain proprietary ' +
  'advertising data intended solely for the addressed recipient. If you are ' +
  'not the intended recipient, please delete this email and notify the sender.';

// ─────────────────────────────────────────────────────────────────────────────
// Branded HTML envelope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a body HTML fragment in the Hive Mind Nestor envelope — logo header,
 * neutral content area, confidential footer, and brand sign-off.
 *
 * @param {string} bodyHtml         The email body's main content.
 * @param {object} [opts]
 * @param {string} [opts.preheader] Short hidden text shown in inbox previews.
 */
function wrap(bodyHtml, { preheader } = {}) {
  return `
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f7fb;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <tr><td style="padding:24px 28px;border-bottom:1px solid #f1f5f9;background:#ffffff">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="vertical-align:middle">
                <img src="${LOGO_URL()}" width="40" height="40" alt="${APP_NAME}" style="border-radius:8px;display:block">
              </td>
              <td style="vertical-align:middle;padding-left:12px">
                <div style="font-size:15px;font-weight:800;color:#0f172a;line-height:1.2">${APP_NAME}</div>
                <div style="font-size:11px;color:#64748b;line-height:1.2;margin-top:2px">${BRAND_TAGLINE}</div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:28px">${bodyHtml}</td></tr>
        <tr><td style="padding:14px 28px;background:#fef2f2;border-top:1px solid #fecaca">
          <div style="font-size:11px;color:#b91c1c;font-weight:600;line-height:1.5">${CONFIDENTIAL_TXT}</div>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #f1f5f9">
          <div style="font-size:11px;color:#94a3b8;line-height:1.5">
            Sent by ${APP_NAME} · <a href="${BRAND_URL}" style="color:#64748b;text-decoration:none">${BRAND_URL.replace('https://', '')}</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function textFooter() {
  return `\n\n— ${APP_NAME}\n${BRAND_URL}\n\n${CONFIDENTIAL_TXT}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Send helpers
// ─────────────────────────────────────────────────────────────────────────────

async function send({ to, subject, html, text }) {
  const result = await getClient().emails.send({
    from: FROM(),
    to,
    subject,
    html,
    text,
  });

  if (result.error) {
    const msg = result.error.message || JSON.stringify(result.error);
    throw new Error(`Resend rejected message: ${msg}`);
  }

  logger.info(`Email sent to ${Array.isArray(to) ? to.join(',') : to} — id: ${result.data?.id}`);
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transactional emails
// ─────────────────────────────────────────────────────────────────────────────

export async function sendVerificationEmail(to, token) {
  const url = `${FRONTEND_URL()}/verify-email?token=${token}`;
  return send({
    to,
    subject: `Verify your ${APP_NAME} email address`,
    text:
      `Click this link to verify your email (expires in 24 hours):\n\n${url}\n\n` +
      `If you didn't sign up for ${APP_NAME}, you can ignore this email.` +
      textFooter(),
    html: wrap(`
      <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800">Verify your email</h2>
      <p style="color:#475569;margin:0 0 24px;font-size:14px;line-height:1.6">Click the button below to confirm your ${APP_NAME} account. This link expires in 24 hours.</p>
      <a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Verify Email</a>
      <p style="color:#64748b;font-size:13px;margin:24px 0 0">Or copy this URL into your browser:<br><a href="${url}" style="color:#2563eb;word-break:break-all">${url}</a></p>
      <p style="color:#94a3b8;font-size:12px;margin:24px 0 0">If you didn't sign up for ${APP_NAME}, you can safely ignore this email.</p>
    `, { preheader: 'Confirm your email to finish setting up your Hive Mind Nestor account.' }),
  });
}

/**
 * Notify org admins that one or more campaign alert thresholds have fired.
 *
 * @param {string|string[]} to              recipient or list of recipients
 * @param {object}          opts
 * @param {string}          opts.orgName    org display name for the subject line
 * @param {Array<object>}   opts.fires      [{ alertName, metric, condition, threshold, campaignName, value }, ...]
 */
export async function sendCampaignAlertEmail(to, { orgName, fires }) {
  if (!fires?.length) return null;

  const url = `${FRONTEND_URL()}/alerts`;
  const verb = (cond) => ({ gt: 'above', gte: 'at or above', lt: 'below', lte: 'at or below' })[cond] ?? cond;
  const fmtVal = (m, v) => {
    if (v == null) return '—';
    if (m === 'acos' || m === 'ctr')               return `${(v * 100).toFixed(2)}%`;
    if (m === 'roas')                              return `${v.toFixed(2)}×`;
    if (m === 'spend')                             return `$${v.toFixed(2)}`;
    return Number(v).toLocaleString('en-US');
  };

  const subject = fires.length === 1
    ? `Alert: ${fires[0].alertName} fired on ${fires[0].campaignName}`
    : `${fires.length} campaign alerts fired (${orgName})`;

  const textRows = fires.map(f =>
    ` • [${f.alertName}] ${f.campaignName} — ${f.metric.toUpperCase()} ${fmtVal(f.metric, f.value)} (${verb(f.condition)} ${fmtVal(f.metric, f.threshold)})`
  ).join('\n');

  const htmlRows = fires.map(f => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #eee">
        <div style="font-weight:600;color:#1a1a1a">${escapeHtml(f.alertName)}</div>
        <div style="color:#777;font-size:13px;margin-top:2px">${escapeHtml(f.campaignName)}</div>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #eee;color:#555;font-size:13px">${f.metric.toUpperCase()}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #eee;font-weight:700;color:#dc2626">${fmtVal(f.metric, f.value)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #eee;color:#777;font-size:13px">${verb(f.condition)} ${fmtVal(f.metric, f.threshold)}</td>
    </tr>`).join('');

  return send({
    to,
    subject,
    text:
      `${fires.length} campaign alert${fires.length === 1 ? '' : 's'} fired for ${orgName}:\n\n${textRows}\n\nReview details: ${url}` +
      textFooter(),
    html: wrap(`
      <h2 style="margin:0 0 6px;color:#0f172a;font-size:20px;font-weight:800">${fires.length} campaign alert${fires.length === 1 ? '' : 's'} fired</h2>
      <p style="color:#475569;margin:0 0 20px;font-size:14px">Triggered on the latest Campaign Performance report for <strong>${escapeHtml(orgName)}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em">Alert / Campaign</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em">Metric</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em">Value</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em">Condition</th>
          </tr>
        </thead>
        <tbody>${htmlRows}</tbody>
      </table>
      <a href="${url}" style="display:inline-block;margin-top:20px;padding:11px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Open alerts dashboard</a>
      <p style="color:#94a3b8;font-size:12px;margin:28px 0 0">${APP_NAME} only emails alerts when a new threshold fires (4-hour dedup window). To stop these emails, deactivate the alert in the dashboard.</p>
    `, { preheader: `${fires.length} alert${fires.length === 1 ? '' : 's'} fired on your campaigns.` }),
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export async function sendPasswordResetEmail(to, token) {
  const url = `${FRONTEND_URL()}/reset-password?token=${token}`;
  return send({
    to,
    subject: `Reset your ${APP_NAME} password`,
    text:
      `You requested a password reset. Click this link (expires in 1 hour):\n\n${url}\n\n` +
      `If you didn't request this, ignore this email — your password won't change.` +
      textFooter(),
    html: wrap(`
      <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800">Reset your password</h2>
      <p style="color:#475569;margin:0 0 24px;font-size:14px;line-height:1.6">We received a request to reset your password. Click the button below — this link expires in 1 hour.</p>
      <a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Reset Password</a>
      <p style="color:#64748b;font-size:13px;margin:24px 0 0">Or copy this URL into your browser:<br><a href="${url}" style="color:#2563eb;word-break:break-all">${url}</a></p>
      <p style="color:#94a3b8;font-size:12px;margin:24px 0 0">If you didn't request a password reset, no action is needed — your password remains unchanged.</p>
    `, { preheader: `Reset your ${APP_NAME} password — this link expires in 1 hour.` }),
  });
}
