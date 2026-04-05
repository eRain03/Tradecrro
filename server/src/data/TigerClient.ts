import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import config from '../config';

const execFileAsync = promisify(execFile);

// Reuse existing interfaces for compatibility with UnifiedDataFetcher
export interface TigerQuote {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: Date;
  change: number;
  changePercent: number;
}

export interface HistoricalData {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================================================
// HARDCODED DANGER KEYWORDS - DO NOT MODIFY
// These trigger IMMEDIATE termination to protect account from blacklist
// ============================================================================
const DANGER_KEYWORDS = [
  'blacklist',
  'black list',
  'permission denied',
  'rate limit',
  'code=4',
  'current limiting',
];

/**
 * Check if error message indicates blacklist threat
 * CRITICAL: This function MUST be called before any error is thrown
 */
function checkBlacklistThreat(errorMsg: string): void {
  const errorLower = errorMsg.toLowerCase();

  for (const keyword of DANGER_KEYWORDS) {
    if (errorLower.includes(keyword.toLowerCase())) {
      console.error('');
      console.error('='.repeat(70));
      console.error('🚫🚫🚫 BLACKLIST THREAT DETECTED 🚫🚫🚫');
      console.error('='.repeat(70));
      console.error(`Error: ${errorMsg}`);
      console.error('ALL TIGER API CALLS STOPPED TO PROTECT YOUR ACCOUNT!');
      console.error('DO NOT MAKE ANY MORE API CALLS!');
      console.error('='.repeat(70));
      console.error('');

      // Hard throw - this will stop all operations
      throw new Error(`BLACKLIST_THREAT: ${errorMsg}`);
    }
  }
}

/**
 * Tiger Open API Client
 * Uses Python bridge script (tiger_quotes.py) to call official tigeropen SDK
 *
 * ⚠️ CRITICAL SAFETY - BLACKLIST PROTECTION ⚠️
 * Tiger will BLACKLIST accounts that violate rate limits!
 * This client has HARD-CODED protection that stops immediately on danger signals.
 *
 * Configuration:
 * - Uses config file at server/config/tiger_openapi_config.properties
 * - Or set TIGER_CONFIG_PATH environment variable
 *
 * Rate Limits (SAFETY - running at HALF capacity):
 * - Tiger High-frequency limit: 120 requests/minute
 * - Our CONSERVATIVE limit: 60 requests/minute (50% of max)
 * - Sliding window: 60 seconds
 *
 * Batch Quote API (get_stock_briefs):
 * - Max 50 symbols per request
 * - Efficient for fetching multiple quotes in one call
 *
 * Constraints:
 * - Requires purchased market data permissions
 */
export class TigerClient {
  private pythonBin: string;
  private scriptPath: string;
  private configPath: string;

  // Rate limiting - CONSERVATIVE (50% of max to stay safe)
  // Tiger allows 120/min for high-frequency, we use 60/min
  private requestTimestamps: number[] = [];
  private readonly maxRequestsPerMinute = 60; // HALF of 120 for safety
  private readonly minRequestIntervalMs = 1000; // 1 second between requests
  private readonly slidingWindowMs = 60000; // 60 second sliding window

  // Track if we've hit a blacklist threat
  private blacklistThreatDetected = false;

  constructor() {
    this.pythonBin = config.tiger.python;
    this.scriptPath = path.join(__dirname, '../../scripts/tiger_quotes.py');
    // Default config path relative to project root
    this.configPath = config.tiger.configPath || path.join(__dirname, '../../config/tiger_openapi_config.properties');

    console.log('');
    console.log('⚠️  Tiger API Safety Configuration:');
    console.log(`   Max rate limit: 120 requests/minute (Tiger's limit)`);
    console.log(`   Our limit: 60 requests/minute (50% for safety)`);
    console.log(`   Min interval: 1 second between requests`);
    console.log('⚠️  Blacklist protection: ENABLED');
    console.log('');
  }

  /**
   * Check if client is safe to use (not blacklisted)
   */
  isSafe(): boolean {
    return !this.blacklistThreatDetected;
  }

  /**
   * Get real-time quote for a single symbol
   */
  async getQuote(symbol: string): Promise<TigerQuote> {
    this.guardBlacklist();
    await this.rateLimit();

    try {
      const result = await this.callPython('quotes', symbol);
      const quotes = this.parseQuotes(result);

      if (quotes.length === 0) {
        throw new Error(`No quote data available for ${symbol}`);
      }

      return quotes[0];
    } catch (error: any) {
      this.handleError(error);
      throw error;
    }
  }

  /**
   * Get quotes for multiple symbols
   * Automatically batches requests for >50 symbols (Tiger limit)
   *
   * IMPORTANT: Each batch counts as 1 API call against rate limit
   */
  async getQuotes(symbols: string[]): Promise<TigerQuote[]> {
    this.guardBlacklist();

    const batches = this.batchSymbols(symbols, 50);
    const results: TigerQuote[] = [];

    for (let i = 0; i < batches.length; i++) {
      await this.rateLimit();

      try {
        const json = await this.callPython('quotes', batches[i].join(','));
        const quotes = this.parseQuotes(json);
        results.push(...quotes);
      } catch (error: any) {
        this.handleError(error);
        // Don't continue if we hit a blacklist threat
        if (this.blacklistThreatDetected) {
          break;
        }
        console.warn(`Skipping batch ${i + 1}/${batches.length} due to error:`, error.message);
      }
    }

    return results;
  }

  /**
   * Get historical price data
   */
  async getHistoricalData(
    symbol: string,
    period: string = '1d',
    interval: string = '1m'
  ): Promise<HistoricalData[]> {
    this.guardBlacklist();
    await this.rateLimit();

    const tigerPeriod = this.mapInterval(interval);
    const startTime = this.getPeriodStartDate(period);
    const endTime = new Date();

    return this.getHistoricalRange(symbol, startTime, endTime, interval);
  }

  /**
   * Get historical data for explicit time range
   */
  async getHistoricalRange(
    symbol: string,
    startTime: Date,
    endTime: Date,
    interval: string = '1m'
  ): Promise<HistoricalData[]> {
    this.guardBlacklist();
    await this.rateLimit();

    const tigerPeriod = this.mapInterval(interval);

    try {
      // For 1m interval, use timeline action (latest trading day only)
      if (interval === '1m') {
        const result = await this.callPython('timeline', symbol);
        return this.parseHistorical(result);
      }

      // For other intervals, use bars action
      const result = await this.callPython(
        'bars',
        symbol,
        tigerPeriod,
        startTime.toISOString(),
        endTime.toISOString()
      );

      return this.parseHistorical(result);
    } catch (error: any) {
      this.handleError(error);
      return [];
    }
  }

  /**
   * Search for symbols
   * Tiger API doesn't have a search endpoint, return empty array
   */
  async search(query: string): Promise<Array<{
    symbol: string;
    name: string;
    type: string;
  }>> {
    console.warn('Tiger API does not support symbol search');
    return [];
  }

  // ============ Private Helper Methods ============

  /**
   * Guard against blacklist - check before every API call
   */
  private guardBlacklist(): void {
    if (this.blacklistThreatDetected) {
      throw new Error('🚫 Tiger API disabled due to blacklist threat. Do not make any more calls!');
    }
  }

  /**
   * Handle errors with blacklist detection
   */
  private handleError(error: any): void {
    const errorMsg = error.message || String(error);

    // Check for blacklist threat keywords
    for (const keyword of DANGER_KEYWORDS) {
      if (errorMsg.toLowerCase().includes(keyword.toLowerCase())) {
        this.blacklistThreatDetected = true;

        console.error('');
        console.error('='.repeat(70));
        console.error('🚫🚫🚫 BLACKLIST THREAT DETECTED 🚫🚫🚫');
        console.error('='.repeat(70));
        console.error(`Error: ${errorMsg}`);
        console.error('ALL TIGER API CALLS STOPPED TO PROTECT YOUR ACCOUNT!');
        console.error('DO NOT MAKE ANY MORE API CALLS!');
        console.error('='.repeat(70));
        console.error('');

        throw error;
      }
    }

    console.error('Tiger API error:', errorMsg);
  }

  /**
   * Call Python bridge script
   */
  private async callPython(action: string, ...args: string[]): Promise<string> {
    const env = {
      ...process.env,
      TIGER_CONFIG_PATH: this.configPath,
      PYTHONUNBUFFERED: '1',
    };

    try {
      const { stdout, stderr } = await execFileAsync(
        this.pythonBin,
        [this.scriptPath, action, ...args],
        { env, maxBuffer: 50 * 1024 * 1024, timeout: 30_000 }
      );

      // Check for errors in stderr
      if (stderr) {
        // Check for blacklist keywords first
        this.handleError(new Error(stderr));

        try {
          const errorJson = JSON.parse(stderr.trim());
          if (errorJson.ok === false) {
            this.handleError(new Error(errorJson.error || 'Unknown Tiger API error'));
          }
        } catch {
          // stderr might not be JSON
          if (stderr.trim()) {
            console.warn('Tiger script stderr:', stderr.trim());
          }
        }
      }

      return stdout;
    } catch (error: any) {
      // Check stderr from execFile error
      if (error.stderr) {
        this.handleError(new Error(error.stderr));
      }
      throw error;
    }
  }

  /**
   * Parse JSON quotes from Python script
   */
  private parseQuotes(jsonStr: string): TigerQuote[] {
    try {
      const data = JSON.parse(jsonStr);

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map((item: any) => ({
        symbol: item.symbol || '',
        price: this.toFinite(item.price),
        bid: this.toFinite(item.bid, this.toFinite(item.price)),
        ask: this.toFinite(item.ask, this.toFinite(item.price)),
        volume: this.toFinite(item.volume, 0),
        timestamp: this.parseDate(item.timestamp),
        change: this.toFinite(item.change),
        changePercent: this.toFinite(item.changePercent),
      }));
    } catch (error) {
      console.error('Failed to parse Tiger quotes JSON:', error);
      return [];
    }
  }

  /**
   * Parse JSON historical data from Python script
   */
  private parseHistorical(jsonStr: string): HistoricalData[] {
    try {
      const data = JSON.parse(jsonStr);

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map((item: any) => ({
        date: this.parseDate(item.date),
        open: this.toFinite(item.open),
        high: this.toFinite(item.high),
        low: this.toFinite(item.low),
        close: this.toFinite(item.close),
        volume: this.toFinite(item.volume, 0),
      }));
    } catch (error) {
      console.error('Failed to parse Tiger historical JSON:', error);
      return [];
    }
  }

  /**
   * Batch symbols into groups (Tiger max 50 per request)
   */
  private batchSymbols(symbols: string[], batchSize: number): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < symbols.length; i += batchSize) {
      batches.push(symbols.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Map Yahoo interval to Tiger period format
   */
  private mapInterval(interval: string): string {
    const mapping: Record<string, string> = {
      '1m': '1min',
      '5m': '5min',
      '15m': '15min',
      '30m': '30min',
      '1h': '60min',
      '1d': 'day',
      '1wk': 'week',
      '1mo': 'month',
    };
    return mapping[interval] || 'day';
  }

  /**
   * Get start date for historical data period
   */
  private getPeriodStartDate(period: string): Date {
    const now = new Date();
    const start = new Date();

    switch (period) {
      case '1d':
        start.setDate(now.getDate() - 1);
        break;
      case '5d':
        start.setDate(now.getDate() - 5);
        break;
      case '1mo':
        start.setMonth(now.getMonth() - 1);
        break;
      case '3mo':
        start.setMonth(now.getMonth() - 3);
        break;
      case '6mo':
        start.setMonth(now.getMonth() - 6);
        break;
      case '1y':
        start.setFullYear(now.getFullYear() - 1);
        break;
      default:
        start.setDate(now.getDate() - 1);
    }

    return start;
  }

  /**
   * Parse date from various formats
   */
  private parseDate(value: any): Date {
    if (!value) return new Date();

    try {
      // ISO string format
      if (typeof value === 'string') {
        return new Date(value);
      }
      // Millisecond timestamp
      if (typeof value === 'number') {
        return new Date(value);
      }
      return new Date();
    } catch {
      return new Date();
    }
  }

  /**
   * Convert to finite number with fallback
   */
  private toFinite(value: unknown, fallback: number = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  /**
   * Rate limiting with sliding window algorithm
   * CONSERVATIVE: 60 requests/minute (50% of Tiger's 120/min limit)
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();

    // Remove timestamps outside the sliding window (older than 60 seconds)
    this.requestTimestamps = this.requestTimestamps.filter(
      ts => now - ts < this.slidingWindowMs
    );

    // Check if we're at the limit
    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      // Calculate wait time until oldest request exits the window
      const oldestTs = this.requestTimestamps[0];
      const waitMs = this.slidingWindowMs - (now - oldestTs) + 1000; // +1s safety margin

      if (waitMs > 0) {
        console.log(`⏳ Tiger rate limit: waiting ${(waitMs / 1000).toFixed(1)}s`);
        await this.sleep(waitMs);
      }
    }

    // Also enforce minimum interval between requests
    if (this.requestTimestamps.length > 0) {
      const lastTs = this.requestTimestamps[this.requestTimestamps.length - 1];
      const timeSinceLast = now - lastTs;
      if (timeSinceLast < this.minRequestIntervalMs) {
        await this.sleep(this.minRequestIntervalMs - timeSinceLast);
      }
    }

    // Record this request timestamp
    this.requestTimestamps.push(Date.now());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default TigerClient;