/**
 * Email service — nodemailer with SMTP
 *
 * Environment variables:
 *   SMTP_HOST     — e.g. smtp.resend.com | smtp.sendgrid.net | smtp.gmail.com
 *   SMTP_PORT     — 587 (STARTTLS) or 465 (SSL)
 *   SMTP_USER     — SMTP username / API key
 *   SMTP_PASS     — SMTP password / API secret
 *   SMTP_FROM     — "From" address, e.g. "AMAIOP <noreply@amaiop.com>"
 *
 * When SMTP_HOST is not set the transporter falls back to nodemailer's
 * ethereal.email test account and logs the preview URL — useful for
 * local development without a real SMTP provider.
 */

import nodemailer from 'nodemailer';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('EMAIL');

let _transporter = null;

async function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.SMTP_HOST) {
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    logger.info(`Email transporter configured (${process.env.SMTP_HOST})`);
  } else {
    // Dev fallback — captures emails at ethereal.email without sending anything real
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    logger.warn('SMTP_HOST not set — using Ethereal test account (emails are NOT delivered)');
  }

  return _transporter;
}

const FROM = process.env.SMTP_FROM || 'AMAIOP <noreply@amaiop.com>';
const APP_NAME = 'AMAIOP';
const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:5173';

// ─────────────────────────────────────────────────────────────────────────────
// Send helpers
// ─────────────────────────────────────────────────────────────────────────────

async function send({ to, subject, html, text }) {
  const transport = await getTransporter();
  const info = await transport.sendMail({ from: FROM, to, subject, html, text });

  // In dev with Ethereal, log the preview URL
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) {
    logger.info(`Email preview (Ethereal): ${preview}`);
  } else {
    logger.info(`Email sent to ${to} — messageId: ${info.messageId}`);
  }

  return info;
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
