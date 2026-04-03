import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import config from '../config';
import type { HistoricalData } from './YahooFinanceClient';

const execFileAsync = promisify(execFile);

/**
 * Historical OHLCV via Databento (official Python client).
 * Used for backtest replay only; does not affect live polling.
 */
export class DatabentoHistorical {
  private pythonBin: string;
  private scriptPath: string;
  private dataset: string;
  private cache = new Map<string, HistoricalData[]>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.pythonBin = config.databento.python;
    this.dataset = config.databento.dataset;
    this.scriptPath = path.join(__dirname, '../../scripts/databento_ohlcv.py');
  }

  /**
   * Clear cache for a new backtest session.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Stop any pending heartbeat.
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 1m bars aligned with SignalBacktester (interval string ignored; always ohlcv-1m).
   * @param onHeartbeat - Optional callback to keep connection alive during long fetch
   */
  async getHistoricalRange(
    symbol: string,
    startTime: Date,
    endTime: Date,
    _interval: string = '1m',
    onHeartbeat?: () => void
  ): Promise<HistoricalData[]> {
    const raw = symbol.trim();
    const cacheKey = `${raw}:${startTime.getTime()}:${endTime.getTime()}`;

    if (this.cache.has(cacheKey)) {
      console.log(`[Databento] 命中缓存: ${raw}`);
      return this.cache.get(cacheKey)!;
    }

    if (raw.includes('/')) {
      throw new Error(
        'Databento 回测当前仅支持美股 raw 代码（如 AAPL），不支持外汇对写法（如 EUR/USD）。'
      );
    }

    const startIso = startTime.toISOString();
    const endIso = endTime.toISOString();

    const env = {
      ...process.env,
      DATABENTO_API_KEY: config.databento.apiKey,
      PYTHONUNBUFFERED: '1',
    };

    console.log(`[Databento] 拉取 K 线 ${raw} ${startIso} → ${endIso} dataset=${this.dataset}`);

    // Start heartbeat to keep connection alive during long fetch
    if (onHeartbeat) {
      this.heartbeatInterval = setInterval(() => {
        console.log(`[Databento] 心跳: ${raw} 正在等待数据...`);
        onHeartbeat();
      }, 5000); // Every 5 seconds
    }

    let stdout: string;
    try {
      const result = await execFileAsync(
        this.pythonBin,
        [this.scriptPath, raw, startIso, endIso, this.dataset],
        {
          env,
          maxBuffer: 256 * 1024 * 1024,
          timeout: 600_000,
        }
      );
      stdout = result.stdout;
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      if (e.stderr) {
        console.error(`[Databento] ${raw} stderr:`, e.stderr);
      }
      // Stop heartbeat on error
      this.stopHeartbeat();
      throw err;
    }

    // Stop heartbeat after fetch completes
    this.stopHeartbeat();

    let rows: Array<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;

    try {
      rows = JSON.parse(stdout) as typeof rows;
    } catch {
      throw new Error(`Databento 输出解析失败: ${stdout.slice(0, 200)}`);
    }

    if (!Array.isArray(rows)) {
      throw new Error('Databento 返回格式无效（期望 JSON 数组）');
    }

    console.log(`[Databento] ${raw} 解析完成，共 ${rows.length} 根 K 线`);

    const resultData = rows.map((r) => ({
      date: new Date(r.date),
      open: this.fin(r.open),
      high: this.fin(r.high),
      low: this.fin(r.low),
      close: this.fin(r.close),
      volume: this.fin(r.volume),
    }));

    this.cache.set(cacheKey, resultData);
    return resultData;
  }

  private fin(v: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
}