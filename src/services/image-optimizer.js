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

const GEMINI_API_KEY    = process.env.GOOGLE_AI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image-preview';
const GEMINI_IMAGE_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const PROMPT_SYSTEM_PROMPT = `You are an expert Amazon main-image art director. You translate a product brief into a single, vivid, prescriptive prompt for an image-generation model.

Hard constraints to bake into every prompt (Amazon main-image policy):
- Pure white background, RGB (255, 255, 255). No gradient, no shadow on the background, no studio sweep, no scene, no surface.
- Single product only. No accessories, props, decorations, or anything not included with the purchase.
- Product fills 85% of the frame, centered, fully in-frame, no cropping.
- No people, hands, body parts, mannequins, animals, or text/watermarks/logos overlaid on the image.
- Realistic representation — true colors, true proportions. Do not stylize, illustrate, cartoonify, or add unrealistic effects.
- Square 1:1 aspect ratio. Studio-lit, soft, even lighting. Sharp focus throughout. High resolution, photorealistic.

Respond ONLY with valid JSON in exactly this shape (no markdown fences, no extra text):
  {"prompt":"...","style":"photorealistic","camera":"straight-on product photography, slight 3/4 if it shows the product better","negativePrompt":"...","complianceNotes":["...","..."]}

- prompt: a single paragraph (3–6 sentences) describing the product, materials, colors, key visible features, lighting, and the composition rules above. Lead with the product description, end with the composition / background / lighting constraints.
- negativePrompt: a comma-separated list of things to exclude: "people, hands, mannequin, props, accessories, decorative items, backgrounds other than pure white, shadows on background, text, watermark, logo, multiple products, packaging unless it IS the product, illustration, cartoon, low resolution, blurry, oversaturated, unrealistic colors".
- complianceNotes: 2–4 short bullets reminding the user which Amazon rules this prompt enforces, so they can review the output against them.`;

async function callClaudeJson(userPrompt, maxTokens = 1500) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
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
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
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
export async function generateImagePrompt(details) {
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

  const userPrompt = `Generate a single Amazon-main-image prompt for the following product. Return ONLY JSON.\n\n${lines}`;
  const parsed = await callClaudeJson(userPrompt);
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

  // Append the negative prompt so Gemini knows what to exclude — the API
  // doesn't have a dedicated negativePrompt field for this model.
  const fullText = negativePrompt
    ? `${prompt}\n\nDo NOT include: ${negativePrompt}.`
    : prompt;

  const parts = [{ text: fullText }];
  if (referenceImageBase64) {
    parts.push({
      inline_data: {
        mime_type: referenceMimeType || 'image/jpeg',
        data:      referenceImageBase64,
      },
    });
  }

  const res = await fetch(GEMINI_IMAGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents:          [{ parts }],
      generationConfig:  { responseModalities: ['IMAGE'] },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini image API error ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  const json = await res.json();
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
 * One-shot pipeline: brief → prompt → image.
 */
export async function optimizeMainImage({ details, referenceImageBase64, referenceMimeType }) {
  const promptSpec = await generateImagePrompt(details);
  const image = await generateMainImage({
    prompt:               promptSpec.prompt,
    negativePrompt:       promptSpec.negativePrompt,
    referenceImageBase64,
    referenceMimeType,
  });
  return {
    image,        // { imageBase64, mimeType }
    promptSpec,   // { prompt, negativePrompt, complianceNotes, style, camera }
  };
}
