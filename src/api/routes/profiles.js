import express from 'express';
import { getProfiles } from '../../services/amazon-ads.js';

const router = express.Router();

// GET /api/profiles - Fetch all advertiser profiles
router.get('/', async (req, res) => {
  try {
    const profiles = await getProfiles();
    res.json(profiles);
  } catch (error) {
    console.error('Profiles route error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch profiles',
      message: error.message 
    });
  }
});

export default router;
