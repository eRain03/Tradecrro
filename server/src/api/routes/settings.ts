import { Router } from 'express';
import { getDatabase } from '../../database/connection';
import { AIPairMiner } from '../../core/ai/AIPairMiner';
import config, { reloadSettings } from '../../config';

const router = Router();

// Get all settings
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    rows.forEach((row) => {
      settings[row.key] = row.value;
    });

    // Add current pair count
    const pairCount = db.prepare('SELECT COUNT(*) as count FROM stock_pairs WHERE is_active = 1').get() as { count: number };
    settings['current_pair_count'] = String(pairCount.count);

    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update setting
router.post('/', (req, res) => {
  try {
    const { key, value } = req.body;
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(key, value);

    // Update config object immediately
    reloadSettings();

    // If updating max_pairs, also update the miner instance
    if (key === 'max_pairs') {
      const miner = (global as any).__aiPairMiner as AIPairMiner | undefined;
      if (miner) {
        miner.setMaxPairs(parseInt(value, 10));
      }
    }

    res.json({ success: true, key, value });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

export default router;
