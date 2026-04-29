import express from 'express';
import { prisma } from '../../db/prisma.js';
import { createLogger } from '../utils/logger.js';
import { randomUUID } from 'crypto';

const router = express.Router();
const logger = createLogger('ALERTS');

const VALID_METRICS    = ['acos', 'spend', 'roas', 'ctr', 'clicks', 'impressions'];
const VALID_CONDITIONS = ['gt', 'lt', 'gte', 'lte'];
const DEDUP_HOURS      = 4; // don't re-fire same alert+campaign within this window

function meetsCondition(value, condition, threshold) {
  if (value == null) return false;
  switch (condition) {
    case 'gt':  return value >  threshold;
    case 'lt':  return value <  threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    default:    return false;
  }
}

function validateAlert(body) {
  const { name, metric, condition, threshold } = body;
  if (!name)                                   return 'name is required';
  if (!VALID_METRICS.includes(metric))         return `metric must be one of: ${VALID_METRICS.join(', ')}`;
  if (!VALID_CONDITIONS.includes(condition))   return `condition must be one of: ${VALID_CONDITIONS.join(', ')}`;
  if (threshold == null || isNaN(Number(threshold))) return 'threshold must be a number';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alerts/rules
// ─────────────────────────────────────────────────────────────────────────────
router.get('/rules', async (req, res) => {
  const rules = await prisma.campaignAlert.findMany({
    where:   { orgId: req.tenant.orgId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rules);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/alerts/rules
// ─────────────────────────────────────────────────────────────────────────────
router.post('/rules', async (req, res) => {
  const err = validateAlert(req.body);
  if (err) return res.status(400).json({ error: err });

  const { name, metric, condition, threshold } = req.body;
  try {
    const rule = await prisma.campaignAlert.create({
      data: {
        orgId:     req.tenant.orgId,
        name,
        metric,
        condition,
        threshold: Number(threshold),
      },
    });
    logger.info(`Alert "${name}" created for org ${req.tenant.orgId}`);
    res.status(201).json(rule);
  } catch (e) {
    logger.error(`Create alert error: ${e.message}`);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/alerts/rules/:id
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/rules/:id', async (req, res) => {
  const rule = await prisma.campaignAlert.findFirst({
    where: { id: req.params.id, orgId: req.tenant.orgId },
  });
  if (!rule) return res.status(404).json({ error: 'Alert not found' });

  const allowed = ['name', 'metric', 'condition', 'threshold', 'isActive'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = key === 'threshold' ? Number(req.body[key]) : req.body[key];
    }
  }
  updates.updatedAt = new Date();

  const updated = await prisma.campaignAlert.update({ where: { id: rule.id }, data: updates });
  res.json(updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/alerts/rules/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/rules/:id', async (req, res) => {
  const rule = await prisma.campaignAlert.findFirst({
    where: { id: req.params.id, orgId: req.tenant.orgId },
  });
  if (!rule) return res.status(404).json({ error: 'Alert not found' });

  await prisma.campaignAlert.delete({ where: { id: rule.id } });
  res.json({ deleted: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/alerts/evaluate
// Body: { campaigns: [{ campaignId, name, acos, spend, roas, ctr, clicks, impressions }] }
// Evaluates active alerts, creates AlertFire records (4h dedup), returns new fires
// ─────────────────────────────────────────────────────────────────────────────
router.post('/evaluate', async (req, res) => {
  const { campaigns } = req.body;
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return res.json({ fired: [], totalFired: 0 });
  }

  const alerts = await prisma.campaignAlert.findMany({
    where: { orgId: req.tenant.orgId, isActive: true },
  });

  if (!alerts.length) return res.json({ fired: [], totalFired: 0 });

  const dedupCutoff = new Date(Date.now() - DEDUP_HOURS * 60 * 60 * 1000);
  const recentFires = await prisma.alertFire.findMany({
    where: {
      orgId:       req.tenant.orgId,
      triggeredAt: { gte: dedupCutoff },
    },
    select: { alertId: true, campaignId: true },
  });
  const recentSet = new Set(recentFires.map(f => `${f.alertId}::${f.campaignId}`));

  const toCreate = [];
  const fired    = [];

  for (const alert of alerts) {
    for (const c of campaigns) {
      const value = c[alert.metric];
      if (!meetsCondition(value, alert.condition, alert.threshold)) continue;

      const dedupeKey = `${alert.id}::${c.campaignId ?? c.id}`;
      if (recentSet.has(dedupeKey)) continue;

      const campaignId   = String(c.campaignId ?? c.id ?? '');
      const campaignName = c.name ?? 'Unknown campaign';

      toCreate.push({
        id:           randomUUID(),
        alertId:      alert.id,
        orgId:        req.tenant.orgId,
        campaignId,
        campaignName,
        metricValue:  Number(value),
        isRead:       false,
        triggeredAt:  new Date(),
      });

      recentSet.add(dedupeKey); // prevent duplicates within this batch

      fired.push({
        alertId:      alert.id,
        alertName:    alert.name,
        campaignId,
        campaignName,
        metric:       alert.metric,
        condition:    alert.condition,
        threshold:    alert.threshold,
        value:        Number(value),
      });
    }
  }

  if (toCreate.length) {
    await prisma.alertFire.createMany({ data: toCreate });
    logger.info(`Alert evaluate for org ${req.tenant.orgId}: ${toCreate.length} fires created`);
  }

  res.json({ fired, totalFired: fired.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alerts/fires
// ─────────────────────────────────────────────────────────────────────────────
router.get('/fires', async (req, res) => {
  const fires = await prisma.alertFire.findMany({
    where:   { orgId: req.tenant.orgId },
    orderBy: { triggeredAt: 'desc' },
    take:    100,
    include: {
      alert: { select: { name: true, metric: true, condition: true, threshold: true } },
    },
  });
  res.json(fires);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alerts/unread-count
// ─────────────────────────────────────────────────────────────────────────────
router.get('/unread-count', async (req, res) => {
  const count = await prisma.alertFire.count({
    where: { orgId: req.tenant.orgId, isRead: false },
  });
  res.json({ count });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/alerts/fires/mark-read
// Body: { ids?: string[] } — omit ids to mark all as read
// ─────────────────────────────────────────────────────────────────────────────
router.post('/fires/mark-read', async (req, res) => {
  const { ids } = req.body;
  const where = { orgId: req.tenant.orgId, isRead: false };
  if (Array.isArray(ids) && ids.length) where.id = { in: ids };

  const { count } = await prisma.alertFire.updateMany({ where, data: { isRead: true } });
  res.json({ updated: count });
});

export default router;
