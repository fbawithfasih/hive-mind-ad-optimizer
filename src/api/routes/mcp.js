import express from 'express';
import { executeMCPCommand } from '../../services/claude-mcp.js';
import campaigns from '../../data/mock-campaigns.js';

const router = express.Router();

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
router.post('/execute', async (req, res) => {
  const { command, history, model } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'command is required' });
  }

  try {
    const result = await executeMCPCommand(command, history || [], model || 'gemini');
    return res.json(result);
  } catch (err) {
    console.error('MCP route error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
