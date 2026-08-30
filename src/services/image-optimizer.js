// Main Image Optimizer service.
// Two-step pipeline:
//   1) Claude turns product details into a tightly-constrained prompt that
//      bakes in Amazon's main-image policy (pure white background, no text /
//      logos / props, single product, ~85% frame fill, square 1:1).
//   2) Gemini 2.5 Flash Image (a.k.a. "nano banana") takes that prompt plus
//      the user's uploaded reference photo and returns a regenerated image
//      that matches the brief.
//
// Both providers are reused from existing env vars — no new keys required.

import { fetchWithTimeout, TIMEOUT_MS } from './http.js';

const GEMINI_API_KEY    = process.env.GOOGLE_AI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;

// Google has renamed this model twice (preview → GA). Try the current GA
// name first, then a couple of historical aliases so a future rename
// doesn't take the feature down again.
const GEMINI_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-2.5-flash-image-preview',
  'gemini-2.0-flash-preview-image-generation',
];
const geminiImageUrl = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

const PROMPT_SYSTEM_PROMPT = `You are an expert Amazon main-image art director. You will be shown the EXACT product the seller already has — usually as a reference photo — and asked to produce a prompt that re-photographs THAT EXACT PRODUCT against an Amazon-compliant background. You are NOT redesigning the product, NOT inventing a new product, NOT creating a stylized rendering. The output must look like the same physical item the user uploaded, photographed in a clean studio.

Treat the reference image as the ground truth. Describe what you literally see — silhouette, proportions, materials, surface finish, color (be specific about hue and saturation), branding/printing visible on the product, distinctive parts (handles, buttons, lids, stitching, lacing, hinges, etc.). When the brief disagrees with the photo, the photo wins. Mention the photo explicitly inside the prompt with phrases like "matching the supplied reference exactly" so the downstream image model anchors on it.

Hard constraints to bake into every prompt (Amazon main-image policy):
- Pure white background, RGB (255, 255, 255). No gradient, no shadow on the background, no studio sweep, no surface, no scene.
- Single product only. No accessories, props, decorations, packaging (unless the packaging IS the product), or anything not included with the purchase.
- The product MUST fill at least 85% of the frame — bounding box of the product should occupy roughly 85% of the shorter dimension. Centered horizontally and vertically, fully in-frame, no cropping. Camera framed tight; no negative space wasted.
- No people, hands, body parts, mannequins, animals, or text/watermarks/logos overlaid on the image.
- Realistic representation — TRUE colors and proportions matching the reference. Do not stylize, illustrate, cartoonify, restyle, recolor, or add unrealistic effects.
- Square 1:1 aspect ratio. Soft, even, diffuse studio lighting. Subtle natural contact shadow under the product is allowed; no dramatic shadows. Sharp focus throughout. High-resolution photorealistic photograph.

Respond ONLY with valid JSON in exactly this shape (no markdown fences, no extra text):
  {"prompt":"...","style":"photorealistic product photography","camera":"...","negativePrompt":"...","complianceNotes":["...","..."]}

- prompt: a single paragraph (4–7 sentences). Open with "Re-photograph the exact product shown in the reference image" then describe what you see (form, materials, colors, every visible detail), then state the framing rule ("the product fills at least 85% of the frame, centered"), then the background ("pure white #FFFFFF, no scene"), then the lighting and camera.
- camera: pick the angle that most closely matches the reference photo (straight-on, slight 3/4, top-down, etc.) — DO NOT pick an angle that would hide a feature visible in the reference.
- negativePrompt: comma-separated list to exclude: "redesign, restyle, recolor, different product, generic version, people, hands, mannequin, props, accessories, decorative items, backgrounds other than pure white, gradient background, scene, surface, shadow on background, text, watermark, logo overlay, multiple products, illustration, cartoon, 3D render look, low resolution, blurry, oversaturated, unrealistic colors, product smaller than 80% of frame".
- complianceNotes: 2–4 short bullets reminding the user which Amazon rules this prompt enforces.`;

async function callClaudeJson(userPrompt, { referenceImageBase64, referenceMimeType } = {}, maxTokens = 1500) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');

  const content = [];
  if (referenceImageBase64) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: referenceMimeType || 'image/jpeg',
        data: referenceImageBase64,
      },
    });
  }
  content.push({ type: 'text', text: userPrompt });

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: PROMPT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    }),
  }, TIMEOUT_MS.llm);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude API error ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }
  const json = await res.json();
  const raw = json.content?.map((b) => b.text).join('') ?? '';
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  const jsonStr = start !== -1 && end > start ? raw.slice(start, end + 1) : raw.trim();
  return JSON.parse(jsonStr);
}

/**
 * Build a structured Amazon-compliant prompt from the user's product brief.
 * @param {{
 *   productName: string,
 *   category?: string,
 *   material?: string,
 *   endUse?: string,
 *   targetAudience?: string,
 *   color?: string,
 *   sizeContext?: string,
 *   styleNotes?: string,
 *   avoid?: string,
 * }} details
 * @returns {Promise<{prompt: string, negativePrompt: string, complianceNotes: string[], style?: string, camera?: string}>}
 */
export async function generateImagePrompt(details, { referenceImageBase64, referenceMimeType } = {}) {
  const lines = [
    `Product name: ${details.productName ?? '(unspecified)'}`,
    details.category       && `Category: ${details.category}`,
    details.material       && `Material(s): ${details.material}`,
    details.endUse         && `Primary end use / function: ${details.endUse}`,
    details.targetAudience && `Target audience: ${details.targetAudience}`,
    details.color          && `Color(s): ${details.color}`,
    details.sizeContext    && `Size context: ${details.sizeContext}`,
    details.styleNotes     && `Style notes: ${details.styleNotes}`,
    details.avoid          && `Things to avoid in the image: ${details.avoid}`,
  ].filter(Boolean).join('\n');

  const userPrompt = referenceImageBase64
    ? `The product photo above is the EXACT product the seller is selling. Look at it carefully and generate the Amazon main-image prompt. The brief below is supplementary context — when it conflicts with the photo, the photo wins. Return ONLY JSON.\n\n${lines}`
    : `No reference photo provided. Generate a single Amazon main-image prompt for the following product brief. Return ONLY JSON.\n\n${lines}`;

  const parsed = await callClaudeJson(userPrompt, { referenceImageBase64, referenceMimeType });
  if (!parsed.prompt) throw new Error('Claude did not return a usable prompt');
  return {
    prompt:           String(parsed.prompt),
    negativePrompt:   String(parsed.negativePrompt ?? ''),
    complianceNotes:  Array.isArray(parsed.complianceNotes) ? parsed.complianceNotes : [],
    style:            parsed.style  ?? null,
    camera:           parsed.camera ?? null,
  };
}

/**
 * Generate an Amazon-compliant main image with Gemini 2.5 Flash Image.
 * Accepts an optional reference photo (base64) so the model preserves the
 * actual product identity rather than hallucinating a generic version.
 *
 * @param {{ prompt: string, negativePrompt?: string, referenceImageBase64?: string, referenceMimeType?: string }} args
 * @returns {Promise<{ imageBase64: string, mimeType: string }>}
 */
export async function generateMainImage({ prompt, negativePrompt, referenceImageBase64, referenceMimeType }) {
  if (!GEMINI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not configured');
  if (!prompt) throw new Error('prompt is required');

  // The model anchors more strongly on whichever modality comes first, so
  // when a reference photo is supplied we lead with it and frame the text
  // as a re-photograph instruction. Text instructions then call out the
  // 85% frame-fill rule explicitly so it isn't lost in the prose.
  const framingRule = 'CRITICAL FRAMING: the product MUST occupy at least 85% of the frame (bounding box). Center it horizontally and vertically. Square 1:1 output. Pure white #FFFFFF background — nothing else.';
  const fidelityRule = referenceImageBase64
    ? 'FIDELITY: this is a re-photograph of the EXACT product in the supplied reference image. Preserve silhouette, proportions, materials, colors, and every visible detail. Do NOT redesign, restyle, recolor, or generate a generic version. Same product, new clean studio shot.'
    : '';
  const negativeLine = negativePrompt ? `Do NOT include: ${negativePrompt}.` : '';
  const fullText = [fidelityRule, prompt, framingRule, negativeLine].filter(Boolean).join('\n\n');

  const parts = [];
  if (referenceImageBase64) {
    parts.push({
      inline_data: {
        mime_type: referenceMimeType || 'image/jpeg',
        data:      referenceImageBase64,
      },
    });
  }
  parts.push({ text: fullText });

  // Walk the candidate model list, skipping past 404 (model not available)
  // until one accepts the request. Anything else is a real error.
  let json, lastErr;
  for (const model of GEMINI_IMAGE_MODELS) {
    const res = await fetchWithTimeout(geminiImageUrl(model), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents:          [{ parts }],
        generationConfig:  { responseModalities: ['IMAGE'] },
      }),
    }, TIMEOUT_MS.llm);
    if (res.ok) { json = await res.json(); break; }
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message ?? res.statusText;
    if (res.status === 404 || /not found|not supported/i.test(msg)) {
      lastErr = `${model}: ${msg}`;
      continue;
    }
    throw new Error(`Gemini image API error ${res.status} (${model}): ${msg}`);
  }
  if (!json) throw new Error(`Gemini image API: no candidate model accepted the request — ${lastErr}`);
  const partsOut = json.candidates?.[0]?.content?.parts ?? [];
  const imagePart = partsOut.find(p => p.inline_data || p.inlineData);
  if (!imagePart) {
    const textOut = partsOut.map(p => p.text).filter(Boolean).join('\n');
    throw new Error(`Gemini returned no image. Text response: ${textOut || '(empty)'}`);
  }
  const data = imagePart.inline_data ?? imagePart.inlineData;
  return {
    imageBase64: data.data,
    mimeType:    data.mime_type ?? data.mimeType ?? 'image/png',
  };
}

/**
 * Generate an Amazon-compliant main image with OpenAI's gpt-image-1.
 *
 * gpt-image-1 has the strongest "preserve product identity from a reference"
 * behaviour on the market right now. When a reference photo is supplied we
 * use the /images/edits endpoint (which actually consumes the reference);
 * without a reference we fall back to /images/generations.
 */
export async function generateMainImageOpenAI({ prompt, negativePrompt, referenceImageBase64, referenceMimeType }) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  if (!prompt) throw new Error('prompt is required');

  const framingRule = 'CRITICAL FRAMING: the product MUST occupy at least 85% of the frame (bounding box). Centered horizontally and vertically. Square 1:1 output. Pure white #FFFFFF background — nothing else, no shadow on background, no surface, no scene.';
  const fidelityRule = referenceImageBase64
    ? 'FIDELITY: this is a re-photograph of the EXACT product in the supplied reference image. Preserve silhouette, proportions, materials, colors, branding, and every visible detail. Do NOT redesign, restyle, recolor, or generate a generic version. Same product, new clean studio shot.'
    : '';
  const negativeLine = negativePrompt
    ? `Do NOT include or change: ${negativePrompt}.`
    : '';
  const fullText = [fidelityRule, prompt, framingRule, negativeLine].filter(Boolean).join('\n\n');

  const headers = { Authorization: `Bearer ${OPENAI_API_KEY}` };
  let res;

  if (referenceImageBase64) {
    const form = new FormData();
    form.append('model',  'gpt-image-1');
    form.append('prompt', fullText);
    form.append('size',   '1024x1024');
    form.append('n',      '1');
    form.append('background', 'opaque');
    const bytes = Buffer.from(referenceImageBase64, 'base64');
    const blob  = new Blob([bytes], { type: referenceMimeType || 'image/jpeg' });
    const ext   = (referenceMimeType || 'image/jpeg').split('/')[1] || 'jpg';
    form.append('image', blob, `reference.${ext}`);
    res = await fetchWithTimeout('https://api.openai.com/v1/images/edits', { method: 'POST', headers, body: form }, TIMEOUT_MS.llm);
  } else {
    res = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
      method:  'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body:    JSON.stringify({
        model: 'gpt-image-1',
        prompt: fullText,
        size: '1024x1024',
        n: 1,
        background: 'opaque',
      }),
    }, TIMEOUT_MS.llm);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI image API error ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }
  const json = await res.json();
  const b64  = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image data');
  return { imageBase64: b64, mimeType: 'image/png' };
}

/**
 * Pick a provider. 'openai' (gpt-image-1) is the default when the key is
 * configured because it preserves product identity from a reference photo
 * far better than Gemini. Falls back to Gemini when OpenAI isn't available
 * or the caller explicitly asks for it.
 */
function pickProvider(requested) {
  if (requested === 'gemini') return 'gemini';
  if (requested === 'openai') return 'openai';
  return OPENAI_API_KEY ? 'openai' : 'gemini';
}

/**
 * One-shot pipeline: brief → prompt → image.
 *
 * @param {{
 *   details: object,
 *   referenceImageBase64?: string,
 *   referenceMimeType?: string,
 *   provider?: 'openai'|'gemini',
 * }} args
 */
export async function optimizeMainImage({ details, referenceImageBase64, referenceMimeType, provider }) {
  const chosen = pickProvider(provider);
  const promptSpec = await generateImagePrompt(details, { referenceImageBase64, referenceMimeType });
  const generator = chosen === 'openai' ? generateMainImageOpenAI : generateMainImage;
  const image = await generator({
    prompt:               promptSpec.prompt,
    negativePrompt:       promptSpec.negativePrompt,
    referenceImageBase64,
    referenceMimeType,
  });
  return {
    image,        // { imageBase64, mimeType }
    promptSpec,   // { prompt, negativePrompt, complianceNotes, style, camera }
    provider:     chosen,
  };
}
