/**
 * Tests for src/services/email.js — Resend HTTP API.
 *
 * Mocks the Resend client so we can assert what we hand to the API
 * without making real network calls.
 */

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

import { Resend } from 'resend';

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({ data: { id: 'test-msg-id' }, error: null });
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.MAIL_FROM      = 'AMAIOP <noreply@amaiop.test>';
  process.env.FRONTEND_URL   = 'https://app.test';
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  delete process.env.FRONTEND_URL;
});

function loadEmail() {
  let mod;
  jest.isolateModules(() => { mod = require('../email.js'); });
  return mod;
}

describe('email.js — Resend client init', () => {
  it('throws when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;
    const { sendVerificationEmail } = loadEmail();
    await expect(sendVerificationEmail('a@b.test', 'tok')).rejects.toThrow(/RESEND_API_KEY/);
  });

  it('constructs the Resend client with the API key', async () => {
    const { sendVerificationEmail } = loadEmail();
    await sendVerificationEmail('a@b.test', 'tok');
    expect(Resend).toHaveBeenCalledWith('re_test_key');
  });

  it('reuses one client across multiple sends', async () => {
    const { sendVerificationEmail } = loadEmail();
    await sendVerificationEmail('a@b.test', 't1');
    await sendVerificationEmail('c@d.test', 't2');
    expect(Resend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe('email.js — sendVerificationEmail', () => {
  it('sends from MAIL_FROM with the right subject and HTML/text', async () => {
    const { sendVerificationEmail } = loadEmail();
    await sendVerificationEmail('user@test.com', 'tok123');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.from).toBe('AMAIOP <noreply@amaiop.test>');
    expect(arg.to).toBe('user@test.com');
    expect(arg.subject).toMatch(/Verify your.*email/i);
    expect(arg.html).toContain('https://app.test/verify-email?token=tok123');
    expect(arg.text).toContain('https://app.test/verify-email?token=tok123');
  });

  it('falls back to SMTP_FROM when MAIL_FROM is unset', async () => {
    delete process.env.MAIL_FROM;
    process.env.SMTP_FROM = 'Legacy <legacy@test>';
    const { sendVerificationEmail } = loadEmail();
    await sendVerificationEmail('user@test.com', 'tok');
    expect(mockSend.mock.calls[0][0].from).toBe('Legacy <legacy@test>');
    delete process.env.SMTP_FROM;
  });

  it('throws and surfaces the Resend error message on failure', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'invalid from address' } });
    const { sendVerificationEmail } = loadEmail();
    await expect(sendVerificationEmail('user@test.com', 'tok')).rejects.toThrow(/invalid from address/);
  });
});

describe('email.js — sendPasswordResetEmail', () => {
  it('uses the reset URL with the token and an appropriate subject', async () => {
    const { sendPasswordResetEmail } = loadEmail();
    await sendPasswordResetEmail('user@test.com', 'reset-tok-9');

    const arg = mockSend.mock.calls[0][0];
    expect(arg.subject).toMatch(/Reset your.*password/i);
    expect(arg.html).toContain('https://app.test/reset-password?token=reset-tok-9');
    expect(arg.text).toContain('https://app.test/reset-password?token=reset-tok-9');
  });
});

describe('email.js — sendCampaignAlertEmail', () => {
  const fires = [
    { alertName: 'Spend spike', campaignName: 'Camp A', metric: 'spend',
      condition: 'gt', threshold: 100, value: 250 },
  ];

  it('returns null and skips sending when fires array is empty', async () => {
    const { sendCampaignAlertEmail } = loadEmail();
    const r = await sendCampaignAlertEmail('admin@test.com', { orgName: 'Acme', fires: [] });
    expect(r).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends a single-fire alert email with the right subject', async () => {
    const { sendCampaignAlertEmail } = loadEmail();
    await sendCampaignAlertEmail('admin@test.com', { orgName: 'Acme', fires });

    const arg = mockSend.mock.calls[0][0];
    expect(arg.subject).toMatch(/Spend spike.*Camp A/);
    expect(arg.html).toContain('Camp A');
    expect(arg.html).toContain('SPEND');
  });

  it('sends to multiple recipients in one call', async () => {
    const { sendCampaignAlertEmail } = loadEmail();
    await sendCampaignAlertEmail(['a@test.com', 'b@test.com'], { orgName: 'Acme', fires });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toEqual(['a@test.com', 'b@test.com']);
  });

  it('escapes HTML in user-provided strings to prevent injection', async () => {
    const { sendCampaignAlertEmail } = loadEmail();
    await sendCampaignAlertEmail('a@test.com', {
      orgName: '<script>x</script>',
      fires: [{ ...fires[0], campaignName: '<img src=x>' }],
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toMatch(/<script>x<\/script>/);
    expect(html).not.toMatch(/<img src=x>/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });
});

describe('trial lifecycle emails', () => {
  const { sendTrialWelcomeEmail, sendTrialEndingEmail, sendTrialExpiredEmail } = require('../email.js');
  const ends = new Date('2026-09-23T06:00:00Z');

  it('welcome names the trial length and end date, and links to onboarding', async () => {
    await sendTrialWelcomeEmail('a@b.com', { orgName: 'Queenza <Crafts>', trialEndsAt: ends, trialDays: 14 });

    const msg = mockSend.mock.calls[0][0];
    expect(msg.to).toBe('a@b.com');
    expect(msg.subject).toMatch(/14-day trial/);
    expect(msg.text).toMatch(/23 September 2026/);
    expect(msg.html).toContain('/onboarding');
    expect(msg.html).toContain('Queenza &lt;Crafts&gt;'); // escaped, never raw
  });

  it('ending says how many days are left and links to billing', async () => {
    await sendTrialEndingEmail(['a@b.com', 'c@d.com'], { orgName: 'Queenza', daysLeft: 3, trialEndsAt: ends });

    const msg = mockSend.mock.calls[0][0];
    expect(msg.to).toEqual(['a@b.com', 'c@d.com']);
    expect(msg.subject).toBe('Your Hive Mind Nestor trial ends in 3 days');
    expect(msg.html).toContain('/billing');
  });

  it('ending uses the singular for one day', async () => {
    await sendTrialEndingEmail('a@b.com', { orgName: 'Queenza', daysLeft: 1, trialEndsAt: ends });
    expect(mockSend.mock.calls[0][0].subject).toMatch(/ends in 1 day$/);
  });

  it('expired says the account is kept and quotes no price', async () => {
    // Prices live on the pricing page; an email cannot be edited once sent.
    await sendTrialExpiredEmail('a@b.com', { orgName: 'Queenza' });

    const msg = mockSend.mock.calls[0][0];
    expect(msg.subject).toBe('Your Hive Mind Nestor trial has ended');
    expect(msg.text).toMatch(/history are kept/);
    expect(msg.text).not.toMatch(/₹|\$\d/);
    expect(msg.html).toContain('/billing');
  });
});
