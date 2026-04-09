import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import config from '../config';
import type { HistoricalData } from './YahooFinanceClient';

const execFileAsync = promisify(execFile);

/**
 * Historical OHLCV via Databento (official Python client).
 * Used for backtest replay only; does not affect live polling.
 *
 * OPTIMIZED: Supports concurrent batch fetching for faster backtests
 */
export class DatabentoHistorical {
  private pythonBin: string;
  private scriptPath: string;
  private dataset: string;
  private cache = new Map<string, HistoricalData[]>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // Concurrency control
  private activeRequests = 0;
  private readonly maxConcurrency: number;

  constructor(maxConcurrency: number = 5) {
    this.pythonBin = config.databento.python;
    this.dataset = config.databento.dataset;
    this.scriptPath = path.join(__dirname, '../../scripts/databento_ohlcv.py');
    this.maxConcurrency = maxConcurrency;
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
   * Get current cache size (for debugging)
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Check cache for a symbol
   */
  hasCache(symbol: string, startTime: Date, endTime: Date): boolean {
    const cacheKey = `${symbol}:${startTime.getTime()}:${endTime.getTime()}`;
    return this.cache.has(cacheKey);
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
      console.log(`[Databento] Cache hit: ${raw}`);
      return this.cache.get(cacheKey)!;
    }

    if (raw.includes('/')) {
      throw new Error(
        'Databento backtest only supports US stock raw codes (e.g. AAPL), not forex pairs (e.g. EUR/USD).'
      );
    }

    const startIso = startTime.toISOString();
    const endIso = endTime.toISOString();

    const env = {
      ...process.env,
      DATABENTO_API_KEY: config.databento.apiKey,
      PYTHONUNBUFFERED: '1',
    };

    console.log(`[Databento] Fetching ${raw} ${startIso} → ${endIso} dataset=${this.dataset}`);

    // Start heartbeat to keep connection alive during long fetch
    if (onHeartbeat) {
      this.heartbeatInterval = setInterval(() => {
        console.log(`[Databento] Heartbeat: ${raw} waiting for data...`);
        onHeartbeat();
      }, 5000);
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
      this.stopHeartbeat();
      throw err;
    }

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
      throw new Error(`Databento parse failed: ${stdout.slice(0, 200)}`);
    }

    if (!Array.isArray(rows)) {
      throw new Error('Databento returned invalid format (expected JSON array)');
    }

    console.log(`[Databento] ${raw} parsed, ${rows.length} bars`);

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

  /**
   * Batch fetch multiple symbols concurrently
   * Much faster than sequential fetching for backtests
   */
  async getHistoricalRangeBatch(
    symbols: string[],
    startTime: Date,
    endTime: Date,
    _interval: string = '1m',
    onProgress?: (completed: number, total: number, symbol: string) => void
  ): Promise<Map<string, HistoricalData[]>> {
    const results = new Map<string, HistoricalData[]>();
    let completed = 0;

    // Process in batches with concurrency control
    const processSymbol = async (symbol: string): Promise<void> => {
      // Wait if we've reached max concurrency
      while (this.activeRequests >= this.maxConcurrency) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      this.activeRequests++;

      try {
        const data = await this.getHistoricalRange(symbol, startTime, endTime, _interval);
        results.set(symbol, data);
        completed++;
        onProgress?.(completed, symbols.length, symbol);
      } catch (error: any) {
        console.error(`[Databento] Failed to fetch ${symbol}:`, error.message);
        results.set(symbol, []);
        completed++;
        onProgress?.(completed, symbols.length, symbol);
      } finally {
        this.activeRequests--;
      }
    };

    // Start all requests (they will self-regulate via activeRequests counter)
    await Promise.all(symbols.map(processSymbol));

    return results;
  }

  /**
   * Prefetch symbols for faster backtest (warm up cache)
   */
  async prefetchSymbols(
    symbols: string[],
    startTime: Date,
    endTime: Date,
    onProgress?: (completed: number, total: number, symbol: string) => void
  ): Promise<void> {
    console.log(`[Databento] Prefetching ${symbols.length} symbols with concurrency=${this.maxConcurrency}...`);
    const t0 = Date.now();

    await this.getHistoricalRangeBatch(symbols, startTime, endTime, '1m', onProgress);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[Databento] Prefetch complete in ${elapsed}s for ${symbols.length} symbols`);
  }

  private fin(v: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
}

export default DatabentoHistorical;