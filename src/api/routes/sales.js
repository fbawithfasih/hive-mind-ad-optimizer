import express from 'express';

const router = express.Router();

const DAY_MS = 86400000;
const isoDay = d => new Date(d).toISOString().slice(0, 10);

/**
 * GET /api/sales/start?startDate=&endDate=
 * Kicks off a SALES_AND_TRAFFIC SP-API report. Returns { reportId }.
 */
router.get('/start', async (req, res) => {
  if (!req.spClient?.startSalesAndTrafficReport) {
    return res.status(412).json({ error: 'SP-API is not connected for this organization.', code: 'SP_NOT_CONNECTED' });
  }

  const today = isoDay(Date.now());
  const endDate   = req.query.endDate   || today;
  const startDate = req.query.startDate || isoDay(Date.now() - 30 * DAY_MS);
  const safeEnd   = endDate > today ? today : endDate;
  const safeStart = startDate > safeEnd ? safeEnd : startDate;

  try {
    const reportId = await req.spClient.startSalesAndTrafficReport(safeStart, safeEnd);
    res.json({ reportId, startDate: safeStart, endDate: safeEnd });
  } catch (err) {
    console.error('Sales start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sales/status?reportId=
 * Returns:
 *   { status: 'PENDING' }
 *   { status: 'FAILED', error }
 *   { status: 'COMPLETED', totalSales, currency, days }
 */
router.get('/status', async (req, res) => {
  if (!req.spClient?.pollSalesAndTrafficReport) {
    return res.status(412).json({ error: 'SP-API is not connected for this organization.', code: 'SP_NOT_CONNECTED' });
  }

  const { reportId } = req.query;
  if (!reportId) return res.status(400).json({ error: 'reportId required' });

  try {
    const result = await req.spClient.pollSalesAndTrafficReport(reportId);
    res.json(result);
  } catch (err) {
    console.error('Sales status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
