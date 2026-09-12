import express from 'express';
import { optimizeMainImage } from '../../services/image-optimizer.js';
import { requireRole } from '../middleware/requireRole.js';
import { LLM_BUDGET_CODE } from '../../services/llm.js';
import { trackUsage } from '../../services/razorpay.js';
import { enforcePlanLimit } from '../../services/plan-limits.js';
import { swallow } from '../utils/capture.js';

const router = express.Router();

const MAX_BASE64_LEN = 12 * 1024 * 1024; // ~12 MB raw → ~9 MB image

/**
 * POST /api/image-optimizer/optimize — MEMBER or above
 *
 * Body: {
 *   referenceImageBase64?: string  // raw base64 (no data: prefix)
 *   referenceMimeType?:    string  // e.g. "image/jpeg"
 *   details: {
 *     productName:    string,
 *     category?:      string,
 *     material?:      string,
 *     endUse?:        string,
 *     targetAudience?: string,
 *     color?:         string,
 *     sizeContext?:   string,
 *     styleNotes?:    string,
 *     avoid?:         string,
 *   }
 * }
 *
 * Returns: {
 *   image: { imageBase64, mimeType },
 *   promptSpec: { prompt, negativePrompt, complianceNotes, style, camera }
 * }
 */
// Two model calls per request (Claude writes the prompt, Gemini draws), so
// this is the most expensive thing a Starter customer can click. The counter
// has been incrementing since capture.js fixed it; now something reads it.
router.post('/optimize', requireRole('MEMBER'), enforcePlanLimit('imagesOptimized'), async (req, res) => {
  const { referenceImageBase64, referenceMimeType, details, provider } = req.body ?? {};

  if (!details?.productName) {
    return res.status(400).json({ error: 'details.productName is required' });
  }
  if (referenceImageBase64 && referenceImageBase64.length > MAX_BASE64_LEN) {
    return res.status(413).json({ error: 'Reference image too large — keep it under ~9 MB.' });
  }

  try {
    const result = await optimizeMainImage({
      details,
      referenceImageBase64,
      referenceMimeType,
      provider,
      orgId: req.tenant.orgId,
    });
    trackUsage(req.tenant.orgId, 'imagesOptimized').catch(swallow('trackUsage:imagesOptimized'));
    res.json(result);
  } catch (err) {
    if (err?.code === LLM_BUDGET_CODE) {
      return res.status(402).json({ error: err.message, code: 'PLAN_LIMIT_REACHED', field: 'llmTokens', limit: err.limit, used: err.used, tier: err.tier });
    }
    console.error('[image-optimizer] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
