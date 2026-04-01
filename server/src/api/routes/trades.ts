import { Router } from 'express';
import { getDatabase } from '../../database/connection';

const router = Router();

// Get open trades
router.get('/open', (req, res) => {
  try {
    const db = getDatabase();
    const trades = db.prepare(`
      SELECT id, stock_symbol as stockSymbol, option_epic as optionEpic,
             strike_price as strikePrice, entry_price as entryPrice,
             position_size as positionSize, entry_time as entryTime, status
      FROM trades
      WHERE status = 'open' AND is_simulated = 1
      ORDER BY entry_time DESC
    `).all();
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch open trades' });
  }
});

// Get closed trades
router.get('/closed', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const db = getDatabase();
    const trades = db.prepare(`
      SELECT id, stock_symbol as stockSymbol, entry_price as entryPrice,
             exit_price as exitPrice, pnl_pct as pnlPct, pnl_amount as pnlAmount,
             exit_time as exitTime, exit_reason as exitReason, status
      FROM trades
      WHERE status = 'closed' AND is_simulated = 1
      ORDER BY exit_time DESC
      LIMIT ?
    `).all(limit);
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch closed trades' });
  }
});

// Close trade
router.post('/:id/close', (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    // This would trigger the exit logic
    res.json({ message: 'Trade close requested', id, reason });
  } catch (error) {
    res.status(500).json({ error: 'Failed to close trade' });
  }
});

export default router;
