import express from 'express';
import { executeMCPCommand } from '../../services/claude-mcp.js';
import campaigns from '../../data/mock-campaigns.js';
import { rateLimitMiddleware } from '../utils/rateLimit.js';
import { getBrandAnalyticsContext } from '../../services/brand-analytics/loader.js';

const router = express.Router();

// Rate limit: max 10 AI API calls per minute per user
// This prevents cost explosion from accidental or malicious spamming
const mcpRateLimit = rateLimitMiddleware(10, 60000, req => req.user?.email || req.ip);

/**
 * POST /execute
 * Executes an MCP command via the Claude MCP service.
 *
 * @route POST /execute
 * @param {Object} req.body - Request body
 * @param {string} req.body.command - The MCP command to execute (required)
 * @param {Array}  [req.body.history] - Conversation history to provide as context
 * @returns {Object} 200 - JSON result from executeMCPCommand
 * @returns {Object} 400 - Missing command field
 * @returns {Object} 500 - Internal server error
 */
router.post('/execute', mcpRateLimit, async (req, res) => {
  const { command, history, model } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'command is required' });
  }

  try {
    const brand        = req.body.brand ?? req.tenant?.org?.brandName ?? null;
    const orgId        = req.tenant?.orgId ?? null;
    const brandContext = orgId ? await getBrandAnalyticsContext(orgId, brand ?? 'Unknown') : null;

    const result = await executeMCPCommand(command, history || [], model || 'gemini', brandContext);
    return res.json(result);
  } catch (err) {
    console.error('MCP route error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
