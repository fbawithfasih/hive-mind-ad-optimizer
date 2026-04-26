import express from 'express';
import { prisma } from '../../db/prisma.ts';
import { executeRule, executeAllRules } from '../../services/rule-engine.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('AUTOMATION');

const VALID_METRICS    = ['acos', 'roas', 'ctr', 'spend', 'clicks', 'impressions'];
const VALID_CONDITIONS = ['gt', 'lt', 'gte', 'lte'];
const VALID_ACTIONS    = ['increase_budget', 'decrease_budget', 'pause', 'enable'];

function validateRule(body) {
  const { name, profileId, metric, condition, threshold, action, adjustment, lookbackDays } = body;
  if (!name)                             return 'name is required';
  if (!profileId)                        return 'profileId is required';
  if (!VALID_METRICS.includes(metric))   return `metric must be one of: ${VALID_METRICS.join(', ')}`;
  if (!VALID_CONDITIONS.includes(condition)) return `condition must be one of: ${VALID_CONDITIONS.join(', ')}`;
  if (threshold == null || isNaN(Number(threshold))) return 'threshold must be a number';
  if (!VALID_ACTIONS.includes(action))   return `action must be one of: ${VALID_ACTIONS.join(', ')}`;
  if (['increase_budget', 'decrease_budget'].includes(action)) {
    const adj = Number(adjustment);
    if (!adj || adj <= 0 || adj > 100)   return 'adjustment must be 1–100 (percent)';
  }
  if (lookbackDays !== undefined && (isNaN(lookbackDays) || lookbackDays < 1 || lookbackDays > 60)) {
    return 'lookbackDays must be 1–60';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/automation/rules — create rule
// ─────────────────────────────────────────────────────────────────────────────
router.post('/rules', async (req, res) => {
  const err = validateRule(req.body);
  if (err) return res.status(400).json({ error: err });

  const { name, profileId, metric, condition, threshold, action, adjustment = 10, lookbackDays = 14 } = req.body;

  try {
    const rule = await prisma.campaignRule.create({
      data: {
        orgId:       req.tenant.orgId,
        name,
        profileId:   profileId.toString(),
        metric,
        condition,
        threshold:   Number(threshold),
        action,
        adjustment:  Number(adjustment),
        lookbackDays: Number(lookbackDays),
      },
    });
    logger.info(`Rule "${name}" created for org ${req.tenant.orgId}`);
    res.status(201).json(rule);
  } catch (e) {
    logger.error(`Create rule error: ${e.message}`);
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/automation/rules — list rules for org
// ─────────────────────────────────────────────────────────────────────────────
router.get('/rules', async (req, res) => {
  const rules = await prisma.campaignRule.findMany({
    where:   { orgId: req.tenant.orgId },
    orderBy: { createdAt: 'desc' },
    include: {
      executions: {
        orderBy: { executedAt: 'desc' },
        take: 1,
        select: { status: true, affectedCount: true, executedAt: true },
      },
    },
  });
  res.json(rules);
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/automation/rules/:id — update rule fields
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/rules/:id', async (req, res) => {
  const rule = await prisma.campaignRule.findFirst({
    where: { id: req.params.id, orgId: req.tenant.orgId },
  });
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  const allowed = ['name', 'metric', 'condition', 'threshold', 'action', 'adjustment', 'lookbackDays', 'isActive'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = ['threshold', 'adjustment', 'lookbackDays'].includes(key)
        ? Number(req.body[key])
        : req.body[key];
    }
  }

  const updated = await prisma.campaignRule.update({
    where: { id: rule.id },
    data:  updates,
  });
  res.json(updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/automation/rules/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/rules/:id', async (req, res) => {
  const rule = await prisma.campaignRule.findFirst({
    where: { id: req.params.id, orgId: req.tenant.orgId },
  });
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  await prisma.campaignRule.delete({ where: { id: rule.id } });
  res.json({ deleted: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/automation/rules/:id/run — manually execute one rule
// ─────────────────────────────────────────────────────────────────────────────
router.post('/rules/:id/run', async (req, res) => {
  const rule = await prisma.campaignRule.findFirst({
    where: { id: req.params.id, orgId: req.tenant.orgId },
  });
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  const result = await executeRule(rule, req.adsClient);

  await prisma.ruleExecution.create({
    data: {
      ruleId:        rule.id,
      orgId:         req.tenant.orgId,
      status:        result.status,
      affectedCount: result.affectedCount,
      changes:       result.changes,
      error:         result.error ?? null,
    },
  });

  await prisma.campaignRule.update({
    where: { id: rule.id },
    data:  { lastRunAt: new Date() },
  });

  logger.info(`Rule "${rule.name}" manual run: ${result.status}, ${result.affectedCount} campaigns affected`);
  res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/automation/run-all — execute all active rules for the org
// ─────────────────────────────────────────────────────────────────────────────
router.post('/run-all', async (req, res) => {
  const results = await executeAllRules(req.tenant.orgId, req.adsClient);
  logger.info(`run-all for org ${req.tenant.orgId}: ${results.length} rules processed`);
  res.json({ results });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/automation/rules/:id/history — execution history for one rule
// ─────────────────────────────────────────────────────────────────────────────
router.get('/rules/:id/history', async (req, res) => {
  const rule = await prisma.campaignRule.findFirst({
    where: { id: req.params.id, orgId: req.tenant.orgId },
  });
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  const history = await prisma.ruleExecution.findMany({
    where:   { ruleId: rule.id },
    orderBy: { executedAt: 'desc' },
    take:    50,
  });
  res.json(history);
});

export default router;
