/**
 * Custom hook for managing AI command execution
 * Handles command submission, context building, result tracking, and model selection
 */
import { useState } from 'react';
import { executeCommand } from '../services/api.js';

/**
 * @typedef {Object} CommandResult
 * @property {string} text - Plain text result
 * @property {string} markdown - Markdown formatted result
 * @property {string[]} suggestions - Follow-up command suggestions
 */

/**
 * @typedef {Object} AICommandExecutionState
 * @property {boolean} isExecuting - Whether command is currently executing
 * @property {CommandResult|null} result - Command result (populated when complete)
 * @property {string|null} error - Error message if execution failed
 * @property {string} aiModel - Currently selected AI model (gemini, claude)
 * @property {Function} setAiModel - Update AI model selection
 * @property {Function} handleCommandSubmit - Execute a command with optional context
 */

/**
 * Manage AI command execution and model selection
 * Builds campaign context automatically or accepts pre-built context
 * Scrolls AI panel into view when executing
 *
 * @param {Array} filteredCampaigns - Filtered campaigns to include in auto context
 * @param {Array} allCampaigns - All campaigns (for context stats)
 * @returns {AICommandExecutionState} Execution state and control functions
 */
export function useAICommandExecution(filteredCampaigns, allCampaigns) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [aiModel, setAiModel] = useState('gemini');

  /**
   * Execute an AI command with optional context
   * If no context provided, auto-builds from filtered campaigns
   * Scrolls AI result panel into view before starting execution
   *
   * @param {string|null} command - The command/instruction to execute (null if using prebuiltContext)
   * @param {string} [prebuiltContext=null] - Pre-built context (skips auto context building)
   */
  async function handleCommandSubmit(command, prebuiltContext = null) {
    setIsExecuting(true);
    setError(null);
    setResult(null);

    // Scroll AI panel into view
    document.getElementById('ai-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const ctx = prebuiltContext
        ?? `Campaigns (${filteredCampaigns.length} of ${allCampaigns.length}): ${JSON.stringify(filteredCampaigns.slice(0, 60))}\n\nCommand: ${command}`;
      setResult(await executeCommand(ctx, [], aiModel));
    } catch (err) {
      setError(err.message || 'Command failed');
    } finally {
      setIsExecuting(false);
    }
  }

  return {
    isExecuting,
    result,
    error,
    aiModel,
    setAiModel,
    handleCommandSubmit,
  };
}
