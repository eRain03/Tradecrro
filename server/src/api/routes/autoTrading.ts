import { Router } from 'express';
import TigerAutoTrader, { AutoTradeConfig } from '../../trading/TigerAutoTrader';
import TigerTradeClient from '../../trading/TigerTradeClient';
import OptionsTrader, { OptionsTradeConfig, OptionsTradeExecution } from '../../trading/OptionsTrader';
import apiOrchestrator from '../../data/APIOrchestrator';
import config from '../../config';

const router = Router();

// Singleton instances
let autoTrader: TigerAutoTrader | null = null;
let tradeClient: TigerTradeClient | null = null;
let optionsTrader: OptionsTrader | null = null;

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
 * Get or create options trader instance
 */
export function getOptionsTrader(configOverride?: Partial<OptionsTradeConfig>): OptionsTrader {
  if (!optionsTrader) {
    optionsTrader = new OptionsTrader(configOverride);
  }
  return optionsTrader;
}

/**
 * Get API orchestrator status (data source health)
 */
router.get('/api-status', (req, res) => {
  try {
    const status = apiOrchestrator.getStatus();
    const currentSource = apiOrchestrator.getCurrentSource();
    const usingFallback = apiOrchestrator.isUsingFallback();

    res.json({
      currentSource,
      primarySource: config.dataSource.provider,
      usingFallback,
      sources: status,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get API status' });
  }
});

/**
 * Force switch data source
 */
router.post('/switch-source', (req, res) => {
  try {
    const { source } = req.body;

    if (source === 'tiger' || source === 'yahoo') {
      apiOrchestrator.forceSwitch(source);
      res.json({
        success: true,
        currentSource: apiOrchestrator.getCurrentSource(),
      });
    } else {
      res.status(400).json({ error: 'Invalid source. Use "tiger" or "yahoo"' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to switch source' });
  }
});

/**
 * Trigger recovery check
 */
router.post('/check-recovery', async (req, res) => {
  try {
    const recovered = await apiOrchestrator.checkRecovery();
    res.json({
      success: true,
      recovered,
      currentSource: apiOrchestrator.getCurrentSource(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check recovery' });
  }
});

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

// ============ Options Trading Routes ============

/**
 * Get options trading status
 */
router.get('/options-status', (req, res) => {
  try {
    const trader = getOptionsTrader();
    const activeTrades = trader.getActiveTrades();

    res.json({
      enabled: trader['config'].enabled,
      dryRun: trader['config'].dryRun,
      activeTrades: activeTrades.length,
      trades: activeTrades,
      config: {
        maxCapitalPct: trader['config'].maxCapitalPct,
        takeProfitPct: trader['config'].takeProfitPct,
        stopLossPct: trader['config'].stopLossPct,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get options trading status' });
  }
});

/**
 * Enable options trading
 */
router.post('/options-enable', (req, res) => {
  try {
    const { dryRun } = req.body;
    const trader = getOptionsTrader();

    if (dryRun !== undefined) {
      trader['config'].dryRun = dryRun;
    }

    trader.enable();

    res.json({
      success: true,
      enabled: true,
      dryRun: trader['config'].dryRun,
      message: 'Options trading enabled',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to enable options trading' });
  }
});

/**
 * Disable options trading
 */
router.post('/options-disable', (req, res) => {
  try {
    const trader = getOptionsTrader();
    trader.disable();

    res.json({
      success: true,
      enabled: false,
      message: 'Options trading disabled',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disable options trading' });
  }
});

/**
 * Update options trading configuration
 */
router.post('/options-config', (req, res) => {
  try {
    const trader = getOptionsTrader();
    const { maxCapitalPct, takeProfitPct, stopLossPct, dryRun } = req.body;

    if (maxCapitalPct !== undefined) {
      trader['config'].maxCapitalPct = Number(maxCapitalPct);
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
    res.status(500).json({ error: 'Failed to update options config' });
  }
});

/**
 * Get options active trades
 */
router.get('/options-trades', (req, res) => {
  try {
    const trader = getOptionsTrader();
    const trades = trader.getActiveTrades();

    res.json({
      trades,
      count: trades.length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get options trades' });
  }
});

/**
 * Get option chain for a symbol
 */
router.get('/option-chain/:symbol', async (req, res) => {
  try {
    const client = getTradeClient();
    const symbol = req.params.symbol.toUpperCase();
    const chain = await client.getOptionChain(symbol);

    res.json({
      symbol,
      contracts: chain,
      count: chain.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Test stock trade execution (simulate signal)
 */
router.post('/stock-test', async (req, res) => {
  try {
    const {
      symbolA = 'NVDA',
      symbolB = 'AMD',
      strategyType = 'positive_lag',
      leader = 'NVDA',
      lagger = 'AMD'
    } = req.body;

    const trader = getAutoTrader();

    // Create a mock signal
    const mockSignal: any = {
      id: 999999,
      stockA: symbolA,
      stockB: symbolB,
      strategyType,
      triggered: true,
      entryConfirmed: true,
      score: {
        leader,
        lagger,
        totalScore: 90,
        syncCorrelation: 0.85,
        lagCorrelation: 0.75,
      },
    };

    console.log('');
    console.log('='.repeat(60));
    console.log('🧪 [TEST] Simulating STOCK trade execution');
    console.log('='.repeat(60));
    console.log(`   Symbol A: ${symbolA}`);
    console.log(`   Symbol B: ${symbolB}`);
    console.log(`   Strategy: ${strategyType}`);
    console.log(`   Leader: ${leader}`);
    console.log(`   Lagger: ${lagger}`);
    console.log('='.repeat(60));

    const results = await trader.processSignal(mockSignal);

    if (results && results.length > 0) {
      res.json({
        success: true,
        trades: results,
        message: 'Stock trade executed successfully',
      });
    } else {
      res.json({
        success: false,
        message: 'Trade not executed (check server logs for details)',
      });
    }
  } catch (error: any) {
    console.error('[TEST] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Test options trade execution (simulate signal)
 */
router.post('/options-test', async (req, res) => {
  try {
    const { symbolA = 'SPY', symbolB = 'SH', strategyType = 'negative_corr' } = req.body;

    const trader = getOptionsTrader();

    // Create a mock signal
    const mockSignal: any = {
      id: 999999,
      stockA: symbolA,
      stockB: symbolB,
      strategyType,
      triggered: true,
      entryConfirmed: true,
      score: {
        leader: symbolA,
        lagger: symbolB,
        totalScore: 85,
      },
    };

    console.log('');
    console.log('='.repeat(60));
    console.log('🧪 [TEST] Simulating options trade execution');
    console.log('='.repeat(60));
    console.log(`   Symbol A: ${symbolA}`);
    console.log(`   Symbol B: ${symbolB}`);
    console.log(`   Strategy: ${strategyType}`);
    console.log('='.repeat(60));

    const result = await trader.processSignal(mockSignal);

    if (result) {
      res.json({
        success: true,
        trade: result,
        message: 'Options trade executed successfully',
      });
    } else {
      res.json({
        success: false,
        message: 'Trade not executed (check server logs for details)',
      });
    }
  } catch (error: any) {
    console.error('[TEST] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;