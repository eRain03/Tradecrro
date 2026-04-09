import { Router } from 'express';
import { getDatabase } from '../../database/connection';
import { TigerTradeClient } from '../../trading/TigerTradeClient';

const router = Router();

// Get open trades
router.get('/open', async (req, res) => {
  try {
    const db = getDatabase();
    const localTrades = db.prepare(`
      SELECT id, stock_symbol as stockSymbol, option_epic as optionEpic,
             strike_price as strikePrice, entry_price as entryPrice,
             position_size as positionSize, entry_time as entryTime, status
      FROM trades
      WHERE status = 'open' AND is_simulated = 1
      ORDER BY entry_time DESC
    `).all();

    // Also get Tiger positions
    let tigerPositions: any[] = [];
    try {
      const tigerClient = new TigerTradeClient();
      tigerPositions = await tigerClient.getPositions();
    } catch (e) {
      console.warn('Failed to get Tiger positions:', e);
    }

    // Combine and format
    const tigerTrades = tigerPositions.map((p: any) => ({
      id: `tiger-${p.symbol}`,
      stockSymbol: p.symbol,
      positionSize: p.quantity,
      entryPrice: p.avgCost,
      markPrice: p.marketValue / p.quantity,
      unrealizedPnl: p.unrealizedPnl,
      entryTime: new Date().toISOString(),
      status: 'open',
      source: 'tiger'
    }));

    res.json([...localTrades, ...tigerTrades]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch open trades' });
  }
});

// Get closed trades
router.get('/closed', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const db = getDatabase();
    const localTrades = db.prepare(`
      SELECT id, stock_symbol as stockSymbol, entry_price as entryPrice,
             exit_price as exitPrice, pnl_pct as pnlPct, pnl_amount as pnlAmount,
             exit_time as exitTime, status
      FROM trades
      WHERE status = 'closed' AND is_simulated = 1
      ORDER BY exit_time DESC
      LIMIT ?
    `).all(limit);

    // Also get Tiger filled orders
    let tigerTrades: any[] = [];
    try {
      const tigerClient = new TigerTradeClient();
      const filledOrders = await tigerClient.getFilledOrders(7);

      // Convert filled orders to trade format
      tigerTrades = filledOrders.map((o: any) => ({
        id: `tiger-${o.orderId}`,
        stockSymbol: o.symbol,
        entryPrice: o.avgFillPrice,
        exitPrice: o.avgFillPrice,
        pnlPct: o.realizedPnl && o.avgFillPrice ? (o.realizedPnl / o.avgFillPrice) * 100 : 0,
        pnlAmount: o.realizedPnl || 0,
        exitTime: o.tradeTime,
        status: 'closed',
        action: o.action,
        quantity: o.quantity,
        source: 'tiger'
      }));
    } catch (e) {
      console.warn('Failed to get Tiger filled orders:', e);
    }

    res.json([...localTrades, ...tigerTrades]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch closed trades' });
  }
});

// Get Tiger account info
router.get('/tiger/account', async (req, res) => {
  try {
    const tigerClient = new TigerTradeClient();
    const account = await tigerClient.getAccountInfo();
    res.json(account);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get Tiger account' });
  }
});

// Get Tiger positions
router.get('/tiger/positions', async (req, res) => {
  try {
    const tigerClient = new TigerTradeClient();
    const positions = await tigerClient.getPositions();
    res.json(positions);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get Tiger positions' });
  }
});

// Get Tiger open orders
router.get('/tiger/orders', async (req, res) => {
  try {
    const tigerClient = new TigerTradeClient();
    const orders = await tigerClient.getOpenOrders();
    res.json(orders);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get Tiger orders' });
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
