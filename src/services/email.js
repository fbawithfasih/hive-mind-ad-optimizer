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

const FROM = () => process.env.MAIL_FROM || process.env.SMTP_FROM || 'AMAIOP <noreply@amaiop.com>';
const APP_NAME = 'AMAIOP';
const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:5173';

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
    text: `Click this link to verify your email (expires in 24 hours):\n\n${url}\n\nIf you didn't sign up for ${APP_NAME}, you can ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <h2 style="margin:0 0 8px;color:#1a1a1a">Verify your email</h2>
        <p style="color:#555;margin:0 0 24px">Click the button below to confirm your ${APP_NAME} account. This link expires in 24 hours.</p>
        <a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Verify Email</a>
        <p style="color:#888;font-size:13px;margin:24px 0 0">Or copy this URL into your browser:<br><a href="${url}" style="color:#2563eb;word-break:break-all">${url}</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:32px 0">
        <p style="color:#aaa;font-size:12px;margin:0">If you didn't sign up for ${APP_NAME}, you can safely ignore this email.</p>
      </div>`,
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
    text: `${fires.length} campaign alert${fires.length === 1 ? '' : 's'} fired for ${orgName}:\n\n${textRows}\n\nReview details: ${url}`,
    html: `
      <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:32px 24px">
        <h2 style="margin:0 0 6px;color:#1a1a1a">${fires.length} campaign alert${fires.length === 1 ? '' : 's'} fired</h2>
        <p style="color:#555;margin:0 0 20px;font-size:14px">Triggered on the latest Campaign Performance report for <strong>${escapeHtml(orgName)}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:#fafafa">
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.06em">Alert / Campaign</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.06em">Metric</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.06em">Value</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.06em">Condition</th>
            </tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
        <a href="${url}" style="display:inline-block;margin-top:20px;padding:11px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Open alerts dashboard</a>
        <p style="color:#aaa;font-size:12px;margin:28px 0 0">${APP_NAME} only emails alerts when a new threshold fires (4-hour dedup window). To stop these emails, deactivate the alert in the dashboard.</p>
      </div>`,
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
    text: `You requested a password reset. Click this link (expires in 1 hour):\n\n${url}\n\nIf you didn't request this, ignore this email — your password won't change.`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <h2 style="margin:0 0 8px;color:#1a1a1a">Reset your password</h2>
        <p style="color:#555;margin:0 0 24px">We received a request to reset your password. Click the button below — this link expires in 1 hour.</p>
        <a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Reset Password</a>
        <p style="color:#888;font-size:13px;margin:24px 0 0">Or copy this URL into your browser:<br><a href="${url}" style="color:#2563eb;word-break:break-all">${url}</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:32px 0">
        <p style="color:#aaa;font-size:12px;margin:0">If you didn't request a password reset, no action is needed — your password remains unchanged.</p>
      </div>`,
  });
}
