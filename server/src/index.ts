import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import config, { reloadSettings } from './config';
import { runMigrations } from './database/migrations';
import { seedData } from './database/seed';
import UnifiedDataFetcher from './data/UnifiedDataFetcher';
import SignalGenerator from './strategy/SignalGenerator';
import { AIPairMiner } from './core/ai/AIPairMiner';
import { getAutoTrader } from './api/routes/autoTrading';

// Import routes
import pairsRoutes from './api/routes/pairs';
import signalsRoutes from './api/routes/signals';
import tradesRoutes from './api/routes/trades';
import settingsRoutes from './api/routes/settings';
import backtestRoutes from './api/routes/backtest';
import testRoutes from './api/routes/test';
import monitoringRoutes from './api/routes/monitoring';
import autoTradingRoutes from './api/routes/autoTrading';
import { wsService } from './api/websocket';

const app = express();

// Initialize WebSocket server
wsService.initialize();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dataSource: config.dataSource.provider
  });
});

// API Routes
app.use('/api/pairs', pairsRoutes);
app.use('/api/signals', signalsRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/test', testRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/auto-trading', autoTradingRoutes);

// Initialize database
runMigrations();
seedData();

// Load settings from database (overrides env defaults)
reloadSettings();

// Initialize data fetcher and signal generator
const dataFetcher = new UnifiedDataFetcher(config.dataSource.provider);
const signalGenerator = new SignalGenerator(dataFetcher);

// Initialize auto trader (disabled by default, enable via API)
const autoTrader = getAutoTrader({
  enabled: config.autoTrading.enabled,
  dryRun: config.autoTrading.dryRun,
  maxPositionSize: config.autoTrading.maxPositionSize,
  maxPositionValue: config.autoTrading.maxPositionValue,
});

// Start data fetching
async function startDataFetching() {
  try {
    await dataFetcher.initialize();

    // Get active pairs from database
    const db = require('./database/connection').getDatabase();
    const pairs = db.prepare('SELECT * FROM stock_pairs WHERE is_active = 1').all();

    if (pairs.length > 0) {
      const symbols = new Set<string>();
      pairs.forEach((p: any) => {
        symbols.add(p.stock_a);
        symbols.add(p.stock_b);
      });

      // Start fetching data
      await dataFetcher.startFetching(Array.from(symbols));

      // Start signal generation
      setInterval(async () => {
        try {
          const signals = await signalGenerator.generateAllSignals();
          const triggeredSignals = signals.filter(s => s.triggered);
          console.log(`Generated ${signals.length} signals, ${triggeredSignals.length} triggered`);

          // Process triggered signals through auto trader
          for (const signal of triggeredSignals) {
            if (signal.entryConfirmed) {
              await autoTrader.processSignal(signal);
            }
          }
        } catch (error) {
          console.error('Signal generation error:', error);
        }
      }, config.trading.samplingInterval * 1000);

      console.log(`📊 Monitoring ${pairs.length} pairs, ${symbols.size} symbols`);
    } else {
      console.log('⚠️ No active pairs configured');
    }
  } catch (error) {
    console.error('Failed to start data fetching:', error);
  }
}

// Start server
const PORT = config.server.port;
app.listen(PORT, () => {
  console.log(`🚀 Trading Server running on port ${PORT}`);
  console.log(`📊 Environment: ${config.server.nodeEnv}`);
  console.log(`📈 Data Source: ${config.dataSource.provider}`);

  // Start data fetching after server is ready
  startDataFetching();

  // Start AI Pair Miner with pair limit and liquidity cleanup
  const miner = new AIPairMiner(dataFetcher);
  miner.trimPairsToLimit();
  miner.cleanupLowLiquidityPairs().then(() => {
    miner.start();
  });

  // Export miner for settings updates
  (global as any).__aiPairMiner = miner;
});

export default app;
