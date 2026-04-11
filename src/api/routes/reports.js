import express from 'express';
import { getCampaigns, startCampaignMetricsReport, checkReportStatus } from '../../services/amazon-ads.js';

const router = express.Router();

function validateDates(startDate, endDate, res) {
  const diffDays = (new Date(endDate) - new Date(startDate)) / 86400000;
  if (diffDays > 31) {
    res.status(400).json({ error: `Date range too large (${Math.round(diffDays)} days). Maximum is 31 days.` });
    return false;
  }
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  if (startDate < sixtyDaysAgo) {
    res.status(400).json({ error: `Start date ${startDate} is too far in the past. Amazon retains data for ~60 days.` });
    return false;
  }
  return true;
}

/**
 * GET /api/reports/start
 *
 * Creates a campaign metrics report and returns immediately with { reportId, campaigns, startDate, endDate }.
 * Poll GET /api/reports/status?reportId=&profileId= until status === 'COMPLETED'.
 */
router.get('/start', async (req, res) => {
  const profileId = req.query.profileId || process.env.AMAZON_DEFAULT_PROFILE_ID;
  if (!profileId) return res.status(400).json({ error: 'profileId required' });

  const endDate   = req.query.endDate   || new Date().toISOString().slice(0, 10);
  const startDate = req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  if (!validateDates(startDate, endDate, res)) return;

  try {
    const [campaigns, reportId] = await Promise.all([
      getCampaigns(profileId),
      startCampaignMetricsReport(profileId, startDate, endDate),
    ]);
    res.json({ reportId, campaigns, startDate, endDate });
  } catch (err) {
    console.error('Reports start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/status?reportId=&profileId=
 *
 * Single poll tick. Returns:
 *   { status: 'PENDING' | 'PROCESSING' }  — still in progress
 *   { status: 'COMPLETED', data: [] }      — raw metrics records
 */
router.get('/status', async (req, res) => {
  const { reportId } = req.query;
  const profileId = req.query.profileId || process.env.AMAZON_DEFAULT_PROFILE_ID;
  if (!reportId)  return res.status(400).json({ error: 'reportId required' });
  if (!profileId) return res.status(400).json({ error: 'profileId required' });

  try {
    const result = await checkReportStatus(profileId, reportId);
    res.json(result);
  } catch (err) {
    console.error('Reports status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
