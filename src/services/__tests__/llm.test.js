/**
 * The one door to Claude: metered, capped, cached, and no worse than the
 * hand-rolled calls it replaces.
 */
jest.mock('../http.js', () => ({ fetchWithTimeout: jest.fn(), TIMEOUT_MS: { llm: 120000, api: 30000 } }));
jest.mock('../razorpay.js', () => ({ trackUsage: jest.fn(async () => {}) }));
jest.mock('../plan-limits.js', () => ({ checkPlanLimit: jest.fn(), planLimitMode: jest.fn(() => 'warn') }));

import { fetchWithTimeout } from '../http.js';
import { trackUsage } from '../razorpay.js';
import { checkPlanLimit, planLimitMode } from '../plan-limits.js';
import { claudeMessages, LlmBudgetExceededError, LLM_BUDGET_CODE } from '../llm.js';

const reply = (over = {}) => ({
  ok: true, status: 200,
  json: async () => ({
    content: [{ type: 'text', text: 'forty-two' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 80 },
    ...over,
  }),
});

const call = (over = {}) => claudeMessages({
  model: 'claude-sonnet-4-6', system: 'You are terse.', messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 500, orgId: 'org-1', purpose: 'test', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  planLimitMode.mockReturnValue('warn');
  checkPlanLimit.mockResolvedValue({ allowed: true, used: 0, limit: 1_500_000, tier: 'BASIC' });
  fetchWithTimeout.mockResolvedValue(reply());
});

afterAll(() => { delete process.env.ANTHROPIC_API_KEY; });

describe('the request', () => {
  it('sends the system prompt as a cacheable block, and the messages as given', async () => {
    await call();

    const [url, init] = fetchWithTimeout.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-test', 'anthropic-version': '2023-06-01' });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'claude-sonnet-4-6', max_tokens: 500, messages: [{ role: 'user', content: 'hi' }] });
    expect(body.system).toEqual([{ type: 'text', text: 'You are terse.', cache_control: { type: 'ephemeral' } }]);
  });

  it('omits system entirely when none is given', async () => {
    await call({ system: undefined });
    expect(JSON.parse(fetchWithTimeout.mock.calls[0][1].body)).not.toHaveProperty('system');
  });

  it('joins the text blocks of the reply and reports the stop reason', async () => {
    fetchWithTimeout.mockResolvedValue(reply({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }));
    await expect(call()).resolves.toMatchObject({ text: 'ab', stopReason: 'end_turn' });
  });

  it('turns a non-2xx into an error naming the status', async () => {
    fetchWithTimeout.mockResolvedValue({ ok: false, status: 529, statusText: 'Overloaded', json: async () => ({ error: { message: 'overloaded' } }) });
    await expect(call()).rejects.toThrow('Claude API error 529: overloaded');
  });

  it('refuses to run without a key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(call()).rejects.toThrow('ANTHROPIC_API_KEY');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
});

describe('metering', () => {
  it('records input and output tokens against the org, separately', async () => {
    await call();
    expect(trackUsage).toHaveBeenCalledWith('org-1', 'llmInputTokens', 1200);
    expect(trackUsage).toHaveBeenCalledWith('org-1', 'llmOutputTokens', 80);
  });

  it('counts cache reads and cache writes as input', async () => {
    fetchWithTimeout.mockResolvedValue(reply({ usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 10 } }));
    await call();
    expect(trackUsage).toHaveBeenCalledWith('org-1', 'llmInputTokens', 1050);
  });

  it('meters nothing and caps nothing with no org, so a system call is not charged to anyone', async () => {
    await call({ orgId: null });
    expect(trackUsage).not.toHaveBeenCalled();
    expect(checkPlanLimit).not.toHaveBeenCalled();
  });

  it('still returns the answer when the metering write fails', async () => {
    trackUsage.mockRejectedValue(new Error('db gone'));
    await expect(call()).resolves.toMatchObject({ text: 'forty-two' });
  });
});

describe('the ceiling', () => {
  it('checks the org against its plan with this call\'s max_tokens as the pessimistic estimate', async () => {
    await call({ maxTokens: 8192 });
    expect(checkPlanLimit).toHaveBeenCalledWith('org-1', 'llmTokens', 8192);
  });

  it('passes through in warn mode when over, as every other limit does', async () => {
    checkPlanLimit.mockResolvedValue({ allowed: false, used: 1_600_000, limit: 1_500_000, tier: 'BASIC' });
    await expect(call()).resolves.toMatchObject({ text: 'forty-two' });
  });

  it('refuses in strict mode without calling the model', async () => {
    planLimitMode.mockReturnValue('strict');
    checkPlanLimit.mockResolvedValue({ allowed: false, used: 1_600_000, limit: 1_500_000, tier: 'BASIC' });

    const err = await call().catch((e) => e);

    expect(err).toBeInstanceOf(LlmBudgetExceededError);
    expect(err.code).toBe(LLM_BUDGET_CODE);
    expect(err.message).toMatch(/BASIC plan/);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('skips the check entirely when limits are off', async () => {
    planLimitMode.mockReturnValue('off');
    await call();
    expect(checkPlanLimit).not.toHaveBeenCalled();
  });
});
