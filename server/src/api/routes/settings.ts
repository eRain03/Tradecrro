import { Router } from 'express';
import { getDatabase } from '../../database/connection';

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
    res.json({ success: true, key, value });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

export default router;
