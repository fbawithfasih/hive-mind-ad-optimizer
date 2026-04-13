/**
 * Custom hook for managing AI command execution
 * Handles command submission, context building, and result/error states
 */
import { useState } from 'react';
import { executeCommand } from '../services/api.js';

export function useAICommandExecution(filteredCampaigns, allCampaigns) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [aiModel, setAiModel] = useState('gemini');

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
