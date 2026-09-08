/**
 * Plan limits on the two routes that call a model.
 *
 * Both were ungated. The Ask-AI route had a per-minute limiter and nothing
 * else — UsageMetric.apiCalls existed and no code path incremented it, so the
 * "100 AI questions a month" on the pricing page was a number with no counter
 * behind it. The image route counted but nothing read the count.
 *
 * These are the two most expensive clicks in the product (the image route is
 * two model calls), and the plan tier is the only thing that is supposed to
 * bound them. So the tests here are about the refusal, and about counting
 * only what the model actually answered.
 */
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';

jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    organization:  { findUnique: jest.fn() },
    usageMetric:   { findFirst: jest.fn() },
    sellerProfile: { count: jest.fn() },
    orgMember:     { count: jest.fn() },
    campaignRule:  { count: jest.fn() },
  },
}));
jest.mock('../../../services/claude-mcp.js',              () => ({ executeMCPCommand: jest.fn() }));
jest.mock('../../../services/brand-analytics/loader.js',  () => ({ getBrandAnalyticsContext: jest.fn(async () => null) }));
jest.mock('../../../services/image-optimizer.js',         () => ({ optimizeMainImage: jest.fn() }));
jest.mock('../../../services/razorpay.js',                () => ({ trackUsage: jest.fn(async () => {}) }));
jest.mock('../../utils/capture.js',                       () => ({ swallow: () => () => {} }));
jest.mock('../../middleware/requireRole.js',              () => ({ requireRole: () => (_req, _res, next) => next() }));

import { prisma } from '../../../db/prisma.js';
import { executeMCPCommand } from '../../../services/claude-mcp.js';
import { optimizeMainImage } from '../../../services/image-optimizer.js';
import { trackUsage } from '../../../services/razorpay.js';
import { resetPlanLimitStats } from '../../../services/plan-limits.js';
import mcpRouter from '../mcp.js';
import imageRouter from '../image-optimizer.js';

const serve = sharedServer();

/**
 * The Ask-AI route also carries an in-memory per-user burst limiter keyed by
 * email, so each app gets its own address to keep tests independent of order.
 */
let n = 0;
function app(router) {
  const a = express();
  a.use(express.json({ limit: '1mb' }));
  a.use((req, _res, next) => {
    req.user   = { userId: 'u-1', email: `user-${n++}@example.com` };
    req.tenant = { orgId: 'org-1', org: { brandName: 'Brand' } };
    next();
  });
  a.use('/', router);
  return serve(a);
}

const onTier = (tier) => prisma.organization.findUnique.mockResolvedValue({ tier });
const used   = (field, count) => prisma.usageMetric.findFirst.mockResolvedValue({ [field]: count });

beforeEach(() => {
  jest.clearAllMocks();
  resetPlanLimitStats();
  process.env.PLAN_LIMITS_MODE = 'strict';
  onTier('BASIC');
  prisma.usageMetric.findFirst.mockResolvedValue(null);
  executeMCPCommand.mockResolvedValue({ answer: 'forty-two' });
  optimizeMainImage.mockResolvedValue({ image: { imageBase64: 'AAAA', mimeType: 'image/png' } });
});

afterAll(() => { delete process.env.PLAN_LIMITS_MODE; });

describe('POST /mcp/execute — AI questions', () => {
  it('refuses at the monthly allowance without asking the model', async () => {
    used('apiCalls', 100); // Starter: 100

    const res = await request(app(mcpRouter)).post('/execute').send({ command: 'what is my ACoS?' });

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', field: 'apiCalls', limit: 100, used: 100 });
    expect(executeMCPCommand).not.toHaveBeenCalled();
    expect(trackUsage).not.toHaveBeenCalled();
  });

  it('answers and counts one question when there is room', async () => {
    used('apiCalls', 99);

    const res = await request(app(mcpRouter)).post('/execute').send({ command: 'what is my ACoS?' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ answer: 'forty-two' });
    expect(trackUsage).toHaveBeenCalledWith('org-1', 'apiCalls');
  });

  it('does not count a question the model failed to answer', async () => {
    // The customer got nothing; charging their allowance for it would be the
    // 402 arriving one failure early.
    executeMCPCommand.mockRejectedValue(new Error('model timeout'));

    const res = await request(app(mcpRouter)).post('/execute').send({ command: 'anything' });

    expect(res.status).toBe(500);
    expect(trackUsage).not.toHaveBeenCalled();
  });

  it('checks the plan before validating the body, so a refusal is not disguised as a 400', async () => {
    used('apiCalls', 100);

    const res = await request(app(mcpRouter)).post('/execute').send({});

    expect(res.status).toBe(402);
  });

  it('is unlimited on Scale', async () => {
    onTier('ENTERPRISE');
    used('apiCalls', 50000);

    const res = await request(app(mcpRouter)).post('/execute').send({ command: 'go' });

    expect(res.status).toBe(200);
  });
});

describe('POST /image-optimizer/optimize — image regenerations', () => {
  const body = { details: { productName: 'Brass diya' } };

  it('refuses at the monthly allowance before either model is called', async () => {
    used('imagesOptimized', 10); // Starter: 10

    const res = await request(app(imageRouter)).post('/optimize').send(body);

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ field: 'imagesOptimized', limit: 10 });
    expect(optimizeMainImage).not.toHaveBeenCalled();
  });

  it('generates and counts when there is room', async () => {
    used('imagesOptimized', 9);

    const res = await request(app(imageRouter)).post('/optimize').send(body);

    expect(res.status).toBe(200);
    expect(optimizeMainImage).toHaveBeenCalledTimes(1);
    expect(trackUsage).toHaveBeenCalledWith('org-1', 'imagesOptimized');
  });
});

describe('in warn mode', () => {
  it('lets an over-limit question through, as every other gated route does', async () => {
    // The rollout contract: enforcement is exercised in production and logged
    // before it says no to anyone. These two routes join it on the same terms.
    delete process.env.PLAN_LIMITS_MODE;
    used('apiCalls', 500);

    const res = await request(app(mcpRouter)).post('/execute').send({ command: 'go' });

    expect(res.status).toBe(200);
    expect(executeMCPCommand).toHaveBeenCalledTimes(1);
  });
});
