import { Router } from 'express';
import TigerAutoTrader, { AutoTradeConfig } from '../../trading/TigerAutoTrader';
import TigerTradeClient from '../../trading/TigerTradeClient';
import config from '../../config';

const router = Router();

// Singleton instances
let autoTrader: TigerAutoTrader | null = null;
let tradeClient: TigerTradeClient | null = null;

/**
 * Get or create auto trader instance
 */
export function getAutoTrader(configOverride?: Partial<AutoTradeConfig>): TigerAutoTrader {
  if (!autoTrader) {
    autoTrader = new TigerAutoTrader(configOverride);
  }
  return autoTrader;
}

/**
 * Get or create trade client instance
 */
function getTradeClient(): TigerTradeClient {
  if (!tradeClient) {
    tradeClient = new TigerTradeClient();
  }
  return tradeClient;
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
 * Get current positions from Tiger
 */
router.get('/positions', async (req, res) => {
  try {
    const client = getTradeClient();
    const positions = await client.getPositions();
    res.json(positions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get open orders from Tiger
 */
router.get('/orders', async (req, res) => {
  try {
    const client = getTradeClient();
    const orders = await client.getOpenOrders();
    res.json(orders);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Test order - validates Tiger API connection without placing real order
 */
router.post('/test-order', async (req, res) => {
  try {
    const client = getTradeClient();

    // Get account info to test connection
    const accountInfo = await client.getAccountInfo();

    if (accountInfo.ok) {
      res.json({
        success: true,
        message: `Tiger API 连接正常 - 账户: ${accountInfo.accountId}, 可用资金: $${accountInfo.buyingPower?.toFixed(2) || 'N/A'}`,
        account: accountInfo,
      });
    } else {
      res.json({
        success: false,
        error: accountInfo.error || '无法获取账户信息',
      });
    }
  } catch (error: any) {
    res.json({
      success: false,
      error: error.message,
    });
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