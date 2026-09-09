/**
 * When the model call is refused for budget, the client hears "plan limit",
 * not "internal error".
 *
 * The chat and image routes catch everything and answer 500. A budget
 * refusal thrown from inside services/llm.js would have surfaced as a
 * server fault — the one kind of answer the billing page cannot turn into
 * an upgrade prompt.
 */
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';

jest.mock('../../../db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../../services/claude-mcp.js',              () => ({ executeMCPCommand: jest.fn() }));
jest.mock('../../../services/brand-analytics/loader.js',  () => ({ getBrandAnalyticsContext: jest.fn(async () => null) }));
jest.mock('../../../services/image-optimizer.js',         () => ({ optimizeMainImage: jest.fn() }));
jest.mock('../../../services/razorpay.js',                () => ({ trackUsage: jest.fn(async () => {}) }));
jest.mock('../../utils/capture.js',                       () => ({ swallow: () => () => {} }));
jest.mock('../../middleware/requireRole.js',              () => ({ requireRole: () => (_req, _res, next) => next() }));

import { executeMCPCommand } from '../../../services/claude-mcp.js';
import { optimizeMainImage } from '../../../services/image-optimizer.js';
import { LlmBudgetExceededError } from '../../../services/llm.js';
import mcpRouter from '../mcp.js';
import imageRouter from '../image-optimizer.js';

const serve = sharedServer();
let n = 0;
function app(router) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user   = { userId: 'u-1', email: `u${n++}@example.com` };
    req.tenant = { orgId: 'org-1', org: {} };
    next();
  });
  a.use('/', router);
  return serve(a);
}

const overBudget = () => new LlmBudgetExceededError({ used: 1_600_000, limit: 1_500_000, tier: 'BASIC' });

beforeEach(() => jest.clearAllMocks());

it('the chat route answers 402 with the plan-limit shape', async () => {
  executeMCPCommand.mockRejectedValue(overBudget());

  const res = await request(app(mcpRouter)).post('/execute').send({ command: 'hi' });

  expect(res.status).toBe(402);
  expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', field: 'llmTokens', limit: 1_500_000, used: 1_600_000, tier: 'BASIC' });
  expect(res.body.error).toMatch(/monthly AI allowance/);
});

it('the chat route passes the org through, so the call is metered against it', async () => {
  executeMCPCommand.mockResolvedValue({ answer: 'ok' });

  await request(app(mcpRouter)).post('/execute').send({ command: 'hi' }).expect(200);

  expect(executeMCPCommand).toHaveBeenCalledWith('hi', [], 'gemini', null, { orgId: 'org-1' });
});

it('the image route answers 402 with the plan-limit shape', async () => {
  optimizeMainImage.mockRejectedValue(overBudget());

  const res = await request(app(imageRouter)).post('/optimize').send({ details: { productName: 'Diya' } });

  expect(res.status).toBe(402);
  expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', field: 'llmTokens' });
});

it('the image route passes the org through', async () => {
  optimizeMainImage.mockResolvedValue({ image: {} });

  await request(app(imageRouter)).post('/optimize').send({ details: { productName: 'Diya' } }).expect(200);

  expect(optimizeMainImage).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }));
});

it('any other failure is still a 500', async () => {
  executeMCPCommand.mockRejectedValue(new Error('model timeout'));
  const res = await request(app(mcpRouter)).post('/execute').send({ command: 'hi' });
  expect(res.status).toBe(500);
});
