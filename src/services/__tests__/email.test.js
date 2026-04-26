/**
 * Tests for src/services/email.js
 *
 * Strategy: jest.isolateModules() + require() gives a fresh module instance
 * per describe block, preventing the module-level _transporter singleton from
 * leaking between tests that need to exercise different transport paths.
 */

jest.mock('nodemailer');

import nodemailer from 'nodemailer';

// Shared sendMail mock — recreated in each describe block via isolateModules
const makeSendMail = () => jest.fn().mockResolvedValue({ messageId: '<test-msg-id@test>' });

beforeEach(() => {
  jest.clearAllMocks();
  nodemailer.getTestMessageUrl.mockReturnValue(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: load a fresh email module with specific env / transport mock
// ─────────────────────────────────────────────────────────────────────────────

function loadEmail(sendMail) {
  let mod;
  jest.isolateModules(() => {
    nodemailer.createTransport.mockReturnValue({ sendMail });
    nodemailer.createTestAccount.mockResolvedValue({ user: 'eth_user', pass: 'eth_pass' });
    mod = require('../email.js');
  });
  return mod;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport initialisation — SMTP path
// ─────────────────────────────────────────────────────────────────────────────

describe('email.js — SMTP transport', () => {
  const origHost = process.env.SMTP_HOST;

  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.resend.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'resend';
    process.env.SMTP_PASS = 're_test123';
  });

  afterEach(() => {
    if (origHost) process.env.SMTP_HOST = origHost;
    else delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  it('calls createTransport with host, port, and auth when SMTP_HOST is set', async () => {
    const sendMail = makeSendMail();
    const { sendVerificationEmail } = loadEmail(sendMail);

    await sendVerificationEmail('u@test.com', 'tok');

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host:   'smtp.resend.com',
        port:   587,
        secure: false,
        auth:   { user: 'resend', pass: 're_test123' },
      })
    );
  });

  it('uses secure:true when port is 465', async () => {
    process.env.SMTP_PORT = '465';
    const sendMail = makeSendMail();
    const { sendVerificationEmail } = loadEmail(sendMail);

    await sendVerificationEmail('u@test.com', 'tok');

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transport initialisation — Ethereal fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('email.js — Ethereal fallback', () => {
  const origHost = process.env.SMTP_HOST;

  beforeEach(() => {
    delete process.env.SMTP_HOST;
  });

  afterEach(() => {
    if (origHost) process.env.SMTP_HOST = origHost;
  });

  it('calls createTestAccount when SMTP_HOST is not set', async () => {
    const sendMail = makeSendMail();
    const { sendVerificationEmail } = loadEmail(sendMail);

    await sendVerificationEmail('u@test.com', 'tok');

    expect(nodemailer.createTestAccount).toHaveBeenCalled();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.ethereal.email' })
    );
  });

  it('logs the Ethereal preview URL when getTestMessageUrl returns one', async () => {
    nodemailer.getTestMessageUrl.mockReturnValue('https://ethereal.email/message/abc');
    const sendMail = makeSendMail();
    const { sendVerificationEmail } = loadEmail(sendMail);

    // Should not throw even with a preview URL present
    await expect(sendVerificationEmail('u@test.com', 'tok')).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendVerificationEmail
// ─────────────────────────────────────────────────────────────────────────────

describe('sendVerificationEmail', () => {
  let sendVerificationEmail;
  let sendMail;

  beforeEach(() => {
    sendMail = makeSendMail();
    ({ sendVerificationEmail } = loadEmail(sendMail));
  });

  it('calls sendMail with the correct recipient', async () => {
    await sendVerificationEmail('alice@example.com', 'mytoken');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('alice@example.com');
  });

  it('subject contains "Verify"', async () => {
    await sendVerificationEmail('u@test.com', 'tok');
    expect(sendMail.mock.calls[0][0].subject).toMatch(/verify/i);
  });

  it('HTML body contains the token URL', async () => {
    process.env.FRONTEND_URL = 'https://app.amaiop.com';
    await sendVerificationEmail('u@test.com', 'abc123');
    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('/verify-email?token=abc123');
    delete process.env.FRONTEND_URL;
  });

  it('plain-text body contains the token URL', async () => {
    await sendVerificationEmail('u@test.com', 'tok999');
    const { text } = sendMail.mock.calls[0][0];
    expect(text).toContain('/verify-email?token=tok999');
  });

  it('uses FRONTEND_URL env var in the link', async () => {
    process.env.FRONTEND_URL = 'https://staging.amaiop.com';
    await sendVerificationEmail('u@test.com', 'tok');
    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('https://staging.amaiop.com');
    delete process.env.FRONTEND_URL;
  });

  it('returns the sendMail result', async () => {
    sendMail.mockResolvedValue({ messageId: '<verify@sent>' });
    const result = await sendVerificationEmail('u@test.com', 'tok');
    expect(result.messageId).toBe('<verify@sent>');
  });

  it('propagates sendMail errors', async () => {
    sendMail.mockRejectedValue(new Error('SMTP connection refused'));
    await expect(sendVerificationEmail('u@test.com', 'tok')).rejects.toThrow('SMTP connection refused');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendPasswordResetEmail
// ─────────────────────────────────────────────────────────────────────────────

describe('sendPasswordResetEmail', () => {
  let sendPasswordResetEmail;
  let sendMail;

  beforeEach(() => {
    sendMail = makeSendMail();
    ({ sendPasswordResetEmail } = loadEmail(sendMail));
  });

  it('calls sendMail with the correct recipient', async () => {
    await sendPasswordResetEmail('bob@example.com', 'resettoken');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('bob@example.com');
  });

  it('subject contains "Reset" and "password"', async () => {
    await sendPasswordResetEmail('u@test.com', 'tok');
    const { subject } = sendMail.mock.calls[0][0];
    expect(subject).toMatch(/reset/i);
    expect(subject).toMatch(/password/i);
  });

  it('HTML body contains the reset token URL', async () => {
    process.env.FRONTEND_URL = 'https://app.amaiop.com';
    await sendPasswordResetEmail('u@test.com', 'reset456');
    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('/reset-password?token=reset456');
    delete process.env.FRONTEND_URL;
  });

  it('plain-text body contains the reset token URL', async () => {
    await sendPasswordResetEmail('u@test.com', 'reset789');
    const { text } = sendMail.mock.calls[0][0];
    expect(text).toContain('/reset-password?token=reset789');
  });

  it('uses FRONTEND_URL env var in the link', async () => {
    process.env.FRONTEND_URL = 'https://prod.amaiop.com';
    await sendPasswordResetEmail('u@test.com', 'tok');
    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('https://prod.amaiop.com');
    delete process.env.FRONTEND_URL;
  });

  it('returns the sendMail result', async () => {
    sendMail.mockResolvedValue({ messageId: '<reset@sent>' });
    const result = await sendPasswordResetEmail('u@test.com', 'tok');
    expect(result.messageId).toBe('<reset@sent>');
  });

  it('propagates sendMail errors', async () => {
    sendMail.mockRejectedValue(new Error('auth failed'));
    await expect(sendPasswordResetEmail('u@test.com', 'tok')).rejects.toThrow('auth failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transporter caching
// ─────────────────────────────────────────────────────────────────────────────

describe('email.js — transporter caching', () => {
  it('only calls createTransport once across multiple sends', async () => {
    const sendMail = makeSendMail();
    const { sendVerificationEmail, sendPasswordResetEmail } = loadEmail(sendMail);

    await sendVerificationEmail('a@test.com', 'tok1');
    await sendPasswordResetEmail('b@test.com', 'tok2');
    await sendVerificationEmail('c@test.com', 'tok3');

    // Singleton — should only initialise once
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });
});
