import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Config {
  dataSource: {
    provider: 'yahoo' | 'simulated';
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
    provider: (process.env.DATA_SOURCE as 'yahoo' | 'simulated') || 'yahoo',
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
