import dotenv from 'dotenv';
import path from 'path';
import { getDatabase } from '../database/connection';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Config {
  dataSource: {
    provider: 'yahoo' | 'tiger' | 'simulated';
  };
  /** Tiger Open API: 实时行情数据源（需购买行情权限） */
  tiger: {
    configPath: string;
    python: string;
  };
  /** Databento: 仅用于回测历史 K 线（通过 Python 官方客户端拉取） */
  databento: {
    apiKey: string;
    dataset: string;
    python: string;
  };
  server: {
    port: number;
    wsPort: number;
    nodeEnv: string;
  };
  database: {
    path: string;
  };
  trading: {
    scoreThreshold: number;
    maxPositionPct: number;
    takeProfitPct: number;
    stopLossPct: number;
    samplingInterval: number;
    lookbackWindow: number;
    lagIntervals: number;
    maxPairs: number;
    expectedMoveThreshold: number;
    // Options trading parameters
    optionsStrikeDistancePct: number;   // 行权价距离阈值 (默认 0.05 = 5%)
    optionsMinOpenInterest: number;     // 最小持仓量 (默认 100)
    optionsMaxSpreadPct: number;        // 最大 Spread 百分比 (默认 0.10 = 10%)
    optionsMinDelta: number;            // 最小 Delta (默认 0.30)
    optionsMaxPremiumPct: number;       // 最大权利金占比 (默认 0.05 = 5%)
  };
  autoTrading: {
    enabled: boolean;
    dryRun: boolean;
    maxPositionSize: number;
    maxPositionValue: number;
  };
  aiMining: {
    paused: boolean;
  };
}

// Default config from environment variables
const defaultConfig: Config = {
  dataSource: {
    provider: (process.env.DATA_SOURCE as 'yahoo' | 'tiger' | 'simulated') || 'yahoo',
  },
  tiger: {
    configPath: (process.env.TIGER_CONFIG_PATH || '').trim(),
    python: process.env.TIGER_PYTHON || 'python3',
  },
  databento: {
    apiKey: (process.env.DATABENTO_API_KEY || '').trim(),
    dataset: (process.env.DATABENTO_DATASET || 'DBEQ.BASIC').trim(),
    python: process.env.DATABENTO_PYTHON || 'python3',
  },
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    wsPort: parseInt(process.env.WS_PORT || '3002', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  database: {
    path: process.env.DATABASE_PATH || './data/trading.db',
  },
  trading: {
    scoreThreshold: parseInt(process.env.SCORE_THRESHOLD || '87', 10),
    maxPositionPct: parseInt(process.env.MAX_POSITION_PCT || '10', 10),
    takeProfitPct: parseInt(process.env.TAKE_PROFIT_PCT || '200', 10),
    stopLossPct: parseInt(process.env.STOP_LOSS_PCT || '50', 10),
    samplingInterval: parseInt(process.env.SAMPLING_INTERVAL || '30', 10),
    lookbackWindow: parseInt(process.env.LOOKBACK_WINDOW || '30', 10),
    lagIntervals: parseInt(process.env.LAG_INTERVALS || '2', 10),
    maxPairs: parseInt(process.env.MAX_PAIRS || '400', 10),
    expectedMoveThreshold: parseFloat(process.env.EXPECTED_MOVE_THRESHOLD || '0.5'),
    // Options parameters
    optionsStrikeDistancePct: parseFloat(process.env.OPTIONS_STRIKE_DISTANCE || '0.05'),
    optionsMinOpenInterest: parseInt(process.env.OPTIONS_MIN_OI || '100', 10),
    optionsMaxSpreadPct: parseFloat(process.env.OPTIONS_MAX_SPREAD || '0.10'),
    optionsMinDelta: parseFloat(process.env.OPTIONS_MIN_DELTA || '0.30'),
    optionsMaxPremiumPct: parseFloat(process.env.OPTIONS_MAX_PREMIUM || '0.05'),
  },
  autoTrading: {
    enabled: process.env.AUTO_TRADING_ENABLED === 'true',
    dryRun: process.env.AUTO_TRADING_DRY_RUN !== 'false',
    maxPositionSize: parseInt(process.env.MAX_POSITION_SIZE || '100', 10),
    maxPositionValue: parseInt(process.env.MAX_POSITION_VALUE || '10000', 10),
  },
  aiMining: {
    paused: process.env.AI_MINING_PAUSED === 'true',
  },
};

/**
 * Load settings from database and override default config
 */
function loadSettingsFromDatabase(): void {
  try {
    const db = getDatabase();

    // Check if settings table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='settings'
    `).get();

    if (!tableExists) {
      return;
    }

    // Load all settings
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];

    for (const row of rows) {
      switch (row.key) {
        case 'max_pairs':
          config.trading.maxPairs = parseInt(row.value, 10) || config.trading.maxPairs;
          console.log(`📊 Loaded max_pairs from database: ${config.trading.maxPairs}`);
          break;
        case 'score_threshold':
          config.trading.scoreThreshold = parseInt(row.value, 10) || config.trading.scoreThreshold;
          console.log(`📊 Loaded score_threshold from database: ${config.trading.scoreThreshold}`);
          break;
        case 'take_profit_pct':
          config.trading.takeProfitPct = parseInt(row.value, 10) || config.trading.takeProfitPct;
          console.log(`📊 Loaded take_profit_pct from database: ${config.trading.takeProfitPct}`);
          break;
        case 'stop_loss_pct':
          config.trading.stopLossPct = parseInt(row.value, 10) || config.trading.stopLossPct;
          console.log(`📊 Loaded stop_loss_pct from database: ${config.trading.stopLossPct}`);
          break;
        case 'sampling_interval':
          config.trading.samplingInterval = parseInt(row.value, 10) || config.trading.samplingInterval;
          console.log(`📊 Loaded sampling_interval from database: ${config.trading.samplingInterval}`);
          break;
        case 'lookback_window':
          config.trading.lookbackWindow = parseInt(row.value, 10) || config.trading.lookbackWindow;
          console.log(`📊 Loaded lookback_window from database: ${config.trading.lookbackWindow}`);
          break;
        case 'lag_intervals':
          config.trading.lagIntervals = parseInt(row.value, 10) || config.trading.lagIntervals;
          console.log(`📊 Loaded lag_intervals from database: ${config.trading.lagIntervals}`);
          break;
        case 'expected_move_threshold':
          config.trading.expectedMoveThreshold = parseFloat(row.value) || config.trading.expectedMoveThreshold;
          console.log(`📊 Loaded expected_move_threshold from database: ${config.trading.expectedMoveThreshold}%`);
          break;
      }
    }
  } catch (error) {
    console.warn('Failed to load settings from database, using defaults');
  }
}

// Create config object (mutable for database override)
export const config: Config = { ...defaultConfig };

// Export function to reload settings from database
export function reloadSettings(): void {
  loadSettingsFromDatabase();
}

export default config;
