import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import config from '../config';
import rateLimitMonitor from '../core/monitoring/RateLimitMonitor';

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
  // NOTE: 'code=4', 'rate limit error', 'current limiting interface' are TEMPORARY
  // rate limits, NOT blacklist threats. They should trigger pause, not permanent disable.
];

// Rate limit patterns - these are TEMPORARY, not blacklist threats
// When detected, we should pause and retry, not permanently disable the client
const RATE_LIMIT_PATTERNS = [
  'code=4',
  'rate limit error',
  'current limiting interface',
  'request limit',
  'too many requests',
  'frequency limit',
];

// Permission denied patterns that are NOT blacklist threats:
// 1. Symbol permission - historical data only available for subscribed symbols (e.g., Nasdaq)
// 2. Market permission - only subscribed markets have data access
// These should be handled at pair selection level, not trigger blacklist protection
const SYMBOL_PERMISSION_DENIED_PATTERN = /permission denied.*symbols of historical market data|permission denied.*occupied symbols/i;

/**
 * Check if error message indicates blacklist threat (permanent danger)
 * Returns: 'blacklist' | 'rate_limit' | null
 */
function checkErrorType(errorMsg: string): 'blacklist' | 'rate_limit' | null {
  // First check if this is a symbol-specific permission issue (not blacklist)
  if (SYMBOL_PERMISSION_DENIED_PATTERN.test(errorMsg)) {
    // This is just "symbol not in your historical data list" - not a threat
    console.warn(`⚠️ Symbol not in historical data permission list: ${errorMsg.slice(0, 100)}...`);
    return null;
  }

  const errorLower = errorMsg.toLowerCase();

  // Check for blacklist threats (permanent danger)
  for (const keyword of DANGER_KEYWORDS) {
    if (errorLower.includes(keyword.toLowerCase())) {
      return 'blacklist';
    }
  }

  // Check for rate limit errors (temporary, should pause and retry)
  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (errorLower.includes(pattern.toLowerCase())) {
      return 'rate_limit';
    }
  }

  return null;
}

/**
 * Log blacklist threat and throw error (stops all operations permanently)
 */
function logBlacklistThreat(errorMsg: string): void {
  console.error('');
  console.error('='.repeat(70));
  console.error('🚫🚫🚫 BLACKLIST THREAT DETECTED 🚫🚫🚫');
  console.error('='.repeat(70));
  console.error(`Error: ${errorMsg}`);
  console.error('ALL TIGER API CALLS STOPPED TO PROTECT YOUR ACCOUNT!');
  console.error('DO NOT MAKE ANY MORE API CALLS!');
  console.error('='.repeat(70));
  console.error('');

  throw new Error(`BLACKLIST_THREAT: ${errorMsg}`);
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
 * Rate Limits (per Tiger Open API documentation):
 * - High-frequency APIs (get_stock_briefs): 120 requests/minute
 * - Medium-frequency APIs (get_bars, get_depth_quote): 60 requests/minute
 * - Low-frequency APIs (grab_quote_permission): 10 requests/minute
 *
 * NOTE: We use get_bars (medium-frequency) for all historical data including 1-minute
 * because get_timeline returns 0 prices for OHLC data. This means more conservative
 * rate limiting for historical data (60/min instead of 120/min).
 *
 * Our CONSERVATIVE limit: 60 requests/minute (50% of high-frequency max)
 * Sliding window: 60 seconds
 *
 * ⚠️ IMPORTANT: We use is_grab_permission=False in Python script to avoid
 * calling the low-frequency grab_quote_permission API (10/min limit).
 * This allows us to use high-frequency APIs like get_stock_briefs (120/min).
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
  private readonly maxRequestsPerMinute = 100; // Conservative limit (83% of 120)
  private readonly minRequestIntervalMs = 1000; // 1 second between requests
  private readonly slidingWindowMs = 60000; // 60 second sliding window

  // Track if we've hit a blacklist threat (permanent)
  private blacklistThreatDetected = false;

  // Track rate limit pause (temporary, clears after cooldown)
  private rateLimitPauseUntil: number = 0;
  private readonly rateLimitCooldownMs = 60_000; // 60 seconds cooldown after rate limit error

  constructor() {
    this.pythonBin = config.tiger.python;
    this.scriptPath = path.join(__dirname, '../../scripts/tiger_quotes.py');
    // Default config path relative to project root
    this.configPath = config.tiger.configPath || path.join(__dirname, '../../config/tiger_openapi_config.properties');

    console.log('');
    console.log('⚠️  Tiger API Safety Configuration:');
    console.log(`   Max rate limit: 120 requests/minute (Tiger's limit)`);
    console.log(`   Our limit: 100 requests/minute (83% for safety)`);
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

    // Record API call - get_stock_briefs is high-frequency API
    rateLimitMonitor.recordCall('high_frequency');

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
      // Check rate limit pause before each batch
      this.guardBlacklist();
      await this.rateLimit();

      // Record API call - get_stock_briefs is high-frequency API
      rateLimitMonitor.recordCall('high_frequency');

      try {
        const json = await this.callPython('quotes', batches[i].join(','));
        const quotes = this.parseQuotes(json);
        results.push(...quotes);
      } catch (error: any) {
        this.handleError(error);

        // If rate limit pause was triggered, wait and retry this batch
        if (this.isInRateLimitPause() && !this.blacklistThreatDetected) {
          const waitMs = this.rateLimitPauseUntil - Date.now();
          console.log(`⏳ Rate limit pause active, waiting ${(waitMs / 1000).toFixed(1)}s before retrying batch ${i + 1}...`);
          await this.sleep(waitMs);
          // Retry this batch (don't increment i)
          i--;
          continue;
        }

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
      // Use get_bars for all intervals including 1m
      // get_timeline returns 0 prices for OHLC data, but get_bars works correctly
      if (interval === '1m') {
        // Record API call - get_bars is medium-frequency API (60/min)
        rateLimitMonitor.recordCall('medium_frequency');
        const result = await this.callPython(
          'bars',
          symbol,
          '1min'  // Tiger's 1-minute period format
        );

        const data = this.parseHistorical(result);
        // Filter to only return last ~60 minutes of data for 1m interval
        const cutoffTime = new Date(endTime.getTime() - 60 * 60 * 1000); // 1 hour lookback
        return data.filter(h => h.date >= cutoffTime && h.date <= endTime);
      }

      // For other intervals, use bars action
      // Record API call - get_bars is medium-frequency API
      rateLimitMonitor.recordCall('medium_frequency');
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
   * Guard against blacklist and rate limit pause - check before every API call
   */
  private guardBlacklist(): void {
    // Check for permanent blacklist threat
    if (this.blacklistThreatDetected) {
      throw new Error('🚫 Tiger API disabled due to blacklist threat. Do not make any more calls!');
    }

    // Check for temporary rate limit pause
    const now = Date.now();
    if (now < this.rateLimitPauseUntil) {
      const waitSeconds = Math.ceil((this.rateLimitPauseUntil - now) / 1000);
      throw new Error(`⏳ Tiger API temporarily paused due to rate limit. Wait ${waitSeconds}s before retrying.`);
    }
  }

  /**
   * Check if we're currently in rate limit pause period
   */
  isInRateLimitPause(): boolean {
    return Date.now() < this.rateLimitPauseUntil;
  }

  /**
   * Handle errors with blacklist/rate-limit detection
   */
  private handleError(error: any): void {
    const errorMsg = error.message || String(error);
    const errorType = checkErrorType(errorMsg);

    if (errorType === 'blacklist') {
      // Permanent blacklist threat - stop all operations
      this.blacklistThreatDetected = true;
      logBlacklistThreat(errorMsg);
    } else if (errorType === 'rate_limit') {
      // Temporary rate limit - pause for cooldown period
      this.rateLimitPauseUntil = Date.now() + this.rateLimitCooldownMs;
      console.warn(`⚠️ Tiger API rate limit detected. Pausing for ${this.rateLimitCooldownMs / 1000}s.`);
      console.warn(`   Error: ${errorMsg.slice(0, 100)}...`);
    } else {
      // Other error - just log it
      console.error('Tiger API error:', errorMsg.slice(0, 200));
    }
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