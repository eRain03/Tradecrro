import { Router } from 'express';
import { getDatabase } from '../../database/connection';

const router = Router();

// Get all pairs
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const pairs = db.prepare(`
      SELECT id, stock_a as stockA, stock_b as stockB,
             strategy_type as strategyType, is_active as isActive
      FROM stock_pairs WHERE is_active = 1
    `).all();
    res.json(pairs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pairs' });
  }
});

// Create new pair
router.post('/', (req, res) => {
  try {
    const { stockA, stockB, strategyType } = req.body;

    // Validate: prevent self-matching
    if (!stockA || !stockB) {
      return res.status(400).json({ error: 'Both stockA and stockB are required' });
    }

    if (stockA === stockB) {
      return res.status(400).json({
        error: 'Invalid pair: stockA and stockB cannot be the same symbol',
        details: `Received: ${stockA}/${stockB}`
      });
    }

    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO stock_pairs (stock_a, stock_b, strategy_type)
      VALUES (?, ?, ?)
    `).run(stockA, stockB, strategyType);

    res.json({
      id: result.lastInsertRowid,
      stockA,
      stockB,
      strategyType,
      isActive: true
    });
  } catch (error) {
    console.error('Failed to create pair:', error);
    res.status(500).json({ error: 'Failed to create pair' });
  }
});

// Delete a pair (soft delete by setting is_active = 0)
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    // Check if pair exists
    const pair = db.prepare('SELECT id FROM stock_pairs WHERE id = ?').get(id);
    if (!pair) {
      return res.status(404).json({ error: 'Pair not found' });
    }

    // Soft delete (set is_active = 0)
    db.prepare('UPDATE stock_pairs SET is_active = 0 WHERE id = ?').run(id);

    res.json({ success: true, message: 'Pair deleted' });
  } catch (error) {
    console.error('Failed to delete pair:', error);
    res.status(500).json({ error: 'Failed to delete pair' });
  }
});

export default router;
