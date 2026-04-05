import dotenv from 'dotenv';
import path from 'path';

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
  };
}

export const config: Config = {
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
    lagIntervals: parseInt(process.env.LAG_INTERVALS || '10', 10),
  },
};

export default config;
