import { Router } from 'express';
import TigerAutoTrader, { AutoTradeConfig } from '../../trading/TigerAutoTrader';

const router = Router();

// Singleton instance
let autoTrader: TigerAutoTrader | null = null;

/**
 * Get or create auto trader instance
 */
export function getAutoTrader(config?: Partial<AutoTradeConfig>): TigerAutoTrader {
  if (!autoTrader) {
    autoTrader = new TigerAutoTrader(config);
  }
  return autoTrader;
}

/**
 * Get auto trading status
 */
router.get('/status', (req, res) => {
  try {
    const trader = getAutoTrader();
    const activeTrades = trader.getActiveTrades();

    res.json({
      enabled: trader['config'].enabled,
      dryRun: trader['config'].dryRun,
      activeTrades: activeTrades.length,
      trades: activeTrades,
      config: {
        maxPositionSize: trader['config'].maxPositionSize,
        maxPositionValue: trader['config'].maxPositionValue,
        takeProfitPct: trader['config'].takeProfitPct,
        stopLossPct: trader['config'].stopLossPct,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get auto trading status' });
  }
});

/**
 * Enable auto trading
 */
router.post('/enable', (req, res) => {
  try {
    const { dryRun } = req.body;
    const trader = getAutoTrader();

    if (dryRun !== undefined) {
      trader['config'].dryRun = dryRun;
    }

    trader.enable();

    res.json({
      success: true,
      enabled: true,
      dryRun: trader['config'].dryRun,
      message: 'Auto trading enabled',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to enable auto trading' });
  }
});

/**
 * Disable auto trading
 */
router.post('/disable', (req, res) => {
  try {
    const trader = getAutoTrader();
    trader.disable();

    res.json({
      success: true,
      enabled: false,
      message: 'Auto trading disabled',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disable auto trading' });
  }
});

/**
 * Update auto trading configuration
 */
router.post('/config', (req, res) => {
  try {
    const trader = getAutoTrader();
    const { maxPositionSize, maxPositionValue, takeProfitPct, stopLossPct, dryRun } = req.body;

    if (maxPositionSize !== undefined) {
      trader['config'].maxPositionSize = Number(maxPositionSize);
    }
    if (maxPositionValue !== undefined) {
      trader['config'].maxPositionValue = Number(maxPositionValue);
    }
    if (takeProfitPct !== undefined) {
      trader['config'].takeProfitPct = Number(takeProfitPct);
    }
    if (stopLossPct !== undefined) {
      trader['config'].stopLossPct = Number(stopLossPct);
    }
    if (dryRun !== undefined) {
      trader['config'].dryRun = Boolean(dryRun);
    }

    res.json({
      success: true,
      config: trader['config'],
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update config' });
  }
});

/**
 * Close all active trades
 */
router.post('/close-all', async (req, res) => {
  try {
    const trader = getAutoTrader();
    await trader.closeAllTrades('manual');

    res.json({
      success: true,
      message: 'All trades closed',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get trade history
 */
router.get('/history', (req, res) => {
  try {
    const trader = getAutoTrader();
    const limit = Number(req.query.limit) || 100;
    const history = trader.getTradeHistory(limit);

    res.json({
      trades: history,
      count: history.length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get trade history' });
  }
});

export default router;