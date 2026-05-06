import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATS_DIR = path.resolve(__dirname, '../../../data/public-stats');

// Allowed slugs map to JSON files. Anything else returns 404.
const ALLOWED = new Set(['queenza-ytd']);

router.get('/stats/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!ALLOWED.has(slug)) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const file = path.join(STATS_DIR, `${slug}.json`);
    const raw = await readFile(file, 'utf8');
    const data = JSON.parse(raw);
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.json(data);
  } catch (err) {
    console.error(`[public-stats] read failed for ${slug}:`, err.message);
    res.status(500).json({ error: 'stats unavailable' });
  }
});

export default router;
