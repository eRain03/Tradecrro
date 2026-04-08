import YahooFinanceClient, { YahooQuote } from './YahooFinanceClient';
import TigerClient, { TigerQuote } from './TigerClient';
import { getDatabase } from '../database/connection';
import config from '../config';

// Pseudo-random number generator for symbol-specific randomness
function createRandom(seed: number) {
  return function() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function hashSymbol(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash) + symbol.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export interface StockData {
  symbol: string;
  timestamp: Date;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  source: 'yahoo' | 'tiger' | 'simulated';
}

export type DataSource = 'yahoo' | 'tiger' | 'simulated';

/**
 * Unified Data Fetcher
 * Supports multiple data sources: Yahoo Finance, Tiger API, or Simulated
 * Yahoo Finance is free but has rate limits
 * Tiger API requires purchased market data permissions
 */
export class UnifiedDataFetcher {
  private yahooClient: YahooFinanceClient;
  private tigerClient: TigerClient | null = null;
  private source: DataSource;
  private priceHistory: Map<string, StockData[]> = new Map();
  private lastCumulativeVolume: Map<string, { volume: number; dateKey: string }> = new Map();
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly lookbackPoints: number;
  private activeSymbols: Set<string> = new Set();

  // Per-symbol random state for independent randomness
  private symbolRandomStates: Map<string, number> = new Map();

  private toFinite(value: unknown, fallback: number = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  constructor(source: DataSource = 'yahoo') {
    this.source = source;
    this.yahooClient = new YahooFinanceClient();

    // Initialize Tiger client if configured
    if (source === 'tiger') {
      this.tigerClient = new TigerClient();
      console.log('📊 Tiger API client initialized (requires market data permissions)');
      console.log('📊 Batch quotes: up to 50 symbols per request, 120 requests/min');
    }

    this.lookbackPoints = Math.max(
      2,
      Math.floor((config.trading.lookbackWindow * 60) / config.trading.samplingInterval)
    );

    console.log(`📊 Data Fetcher initialized with source: ${source}`);
  }

  /**
   * Initialize the data fetcher
   */
  async initialize(): Promise<void> {
    // Yahoo Finance doesn't require authentication
    // Tiger API credentials are validated in TigerClient constructor
  }

  /**
   * Add new symbols dynamically
   */
  async addSymbols(symbols: string[]): Promise<void> {
    const newSymbols = symbols.filter(s => s && s.trim() && !this.activeSymbols.has(s));
    if (newSymbols.length === 0) return;

    for (const symbol of newSymbols) {
      this.activeSymbols.add(symbol);
    }
    
    console.log(`📈 Dynamically fetching historical data for ${newSymbols.length} new symbols...`);
    for (const symbol of newSymbols) {
      await this.fetchHistoricalData(symbol);
    }
  }

  /**
   * Start fetching data for symbols
   */
  async startFetching(symbols: string[]): Promise<void> {
    if (this.isRunning) {
      console.log('Data fetcher already running');
      return;
    }

    this.isRunning = true;

    // Filter out duplicates and invalid symbols
    const uniqueSymbols = [...new Set(symbols.filter(s => s && s.trim()))];

    if (uniqueSymbols.length !== symbols.length) {
      console.warn(`⚠️ Removed ${symbols.length - uniqueSymbols.length} duplicate symbols`);
    }

    for (const symbol of uniqueSymbols) {
      this.activeSymbols.add(symbol);
    }

    // Fetch initial historical data
    console.log(`📈 Fetching historical data for ${this.activeSymbols.size} unique symbols...`);

    if (this.source === 'tiger') {
      // Tiger: batch historical data with rate limit consideration
      // get_stock_briefs is high-frequency (120/min), but get_bars/get_timeline are low-frequency
      for (const symbol of this.activeSymbols) {
        await this.fetchHistoricalData(symbol);
        // Small delay for low-frequency historical APIs
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      for (const symbol of this.activeSymbols) {
        await this.fetchHistoricalData(symbol);
      }
    }

    // Start polling
    const intervalMs = config.trading.samplingInterval * 1000;
    this.intervalId = setInterval(async () => {
      if (this.source === 'tiger') {
        // Tiger: use batch fetching to minimize API calls (rate limit: 10/min)
        await this.fetchAllCurrentPrices();
      } else {
        // Yahoo/Simulated: individual fetching (no strict limits)
        for (const symbol of this.activeSymbols) {
          await this.fetchCurrentPrice(symbol);
        }
      }
    }, intervalMs);

    console.log(`🔄 Started polling every ${config.trading.samplingInterval}s`);
  }

  /**
   * Fetch all current prices - optimized for Tiger batch API
   */
  private async fetchAllCurrentPrices(): Promise<void> {
    try {
      const results = await this.fetchAllFromTiger();

      for (const [symbol, data] of results) {
        this.updateHistory(symbol, data);
        this.saveToDatabase(data);
      }

      // Log any symbols that weren't fetched
      const fetchedSymbols = new Set(results.keys());
      for (const symbol of this.activeSymbols) {
        if (!fetchedSymbols.has(symbol)) {
          console.warn(`⚠️ No data received for ${symbol}`);
        }
      }
    } catch (error) {
      console.error('Failed to fetch batch prices from Tiger:', error);
    }
  }

  /**
   * Stop fetching data
   */
  stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('⏹️ Data fetcher stopped');
  }

  /**
   * Fetch current price
   */
  private async fetchCurrentPrice(symbol: string): Promise<void> {
    try {
      let data: StockData;

      switch (this.source) {
        case 'tiger':
          data = await this.fetchFromTiger(symbol);
          break;
        case 'yahoo':
          data = await this.fetchFromYahoo(symbol);
          break;
        case 'simulated':
          data = await this.fetchSimulated(symbol);
          break;
        default:
          data = await this.fetchFromYahoo(symbol);
      }

      // Update history
      this.updateHistory(symbol, data);

      // Save to database
      this.saveToDatabase(data);

    } catch (error) {
      console.error(`Failed to fetch price for ${symbol}:`, error);
    }
  }

  /**
   * Fetch from Yahoo Finance
   */
  private async fetchFromYahoo(symbol: string): Promise<StockData> {
    const quote = await this.yahooClient.getQuote(symbol);
    const history = this.priceHistory.get(symbol) || [];
    const dateKey = quote.timestamp.toISOString().slice(0, 10);
    const lastVolumeState = this.lastCumulativeVolume.get(symbol);

    let normalizedVolume = 0;

    if (lastVolumeState && lastVolumeState.dateKey === dateKey) {
      normalizedVolume = Math.max(quote.volume - lastVolumeState.volume, 0);
    } else if (history.length > 0) {
      const recentVolumes = history
        .slice(-Math.min(this.lookbackPoints, history.length))
        .map(item => item.volume)
        .filter(volume => Number.isFinite(volume) && volume >= 0);

      if (recentVolumes.length > 0) {
        normalizedVolume = recentVolumes.reduce((sum, volume) => sum + volume, 0) / recentVolumes.length;
      }
    }

    this.lastCumulativeVolume.set(symbol, { volume: quote.volume, dateKey });

    return {
      symbol,
      timestamp: quote.timestamp,
      price: quote.price,
      bid: quote.bid,
      ask: quote.ask,
      volume: normalizedVolume,
      source: 'yahoo',
    };
  }

  /**
   * Fetch from Tiger API
   * Note: Tiger has strict rate limits (10 req/min for low-freq APIs)
   * Uses batching (max 50 symbols per request) to minimize API calls
   */
  private async fetchFromTiger(symbol: string): Promise<StockData> {
    if (!this.tigerClient) {
      throw new Error('Tiger client not initialized');
    }

    const quote = await this.tigerClient.getQuote(symbol);
    const history = this.priceHistory.get(symbol) || [];
    const dateKey = quote.timestamp.toISOString().slice(0, 10);
    const lastVolumeState = this.lastCumulativeVolume.get(symbol);

    let normalizedVolume = quote.volume;

    // Tiger API provides per-interval volume, no need for normalization
    // But we still check for valid volume
    if (!Number.isFinite(normalizedVolume) || normalizedVolume < 0) {
      if (history.length > 0) {
        const recentVolumes = history
          .slice(-Math.min(this.lookbackPoints, history.length))
          .map(item => item.volume)
          .filter(volume => Number.isFinite(volume) && volume >= 0);

        if (recentVolumes.length > 0) {
          normalizedVolume = recentVolumes.reduce((sum, volume) => sum + volume, 0) / recentVolumes.length;
        }
      }
    }

    return {
      symbol,
      timestamp: quote.timestamp,
      price: quote.price,
      bid: quote.bid,
      ask: quote.ask,
      volume: normalizedVolume,
      source: 'tiger',
    };
  }

  /**
   * Fetch all current prices from Tiger in batch
   * More efficient than individual requests due to rate limits
   */
  async fetchAllFromTiger(): Promise<Map<string, StockData>> {
    if (!this.tigerClient || this.activeSymbols.size === 0) {
      return new Map();
    }

    const symbols = Array.from(this.activeSymbols);
    const results = new Map<string, StockData>();

    try {
      // Tiger supports up to 50 symbols per batch
      const quotes = await this.tigerClient.getQuotes(symbols);

      for (const quote of quotes) {
        const data: StockData = {
          symbol: quote.symbol,
          timestamp: quote.timestamp,
          price: quote.price,
          bid: quote.bid,
          ask: quote.ask,
          volume: quote.volume,
          source: 'tiger',
        };
        results.set(quote.symbol, data);
      }
    } catch (error) {
      console.error('Failed to fetch batch quotes from Tiger:', error);
    }

    return results;
  }

  /**
   * Generate simulated price with symbol-specific randomness
   */
  private async fetchSimulated(symbol: string): Promise<StockData> {
    const history = this.priceHistory.get(symbol);
    const lastPrice = history && history.length > 0
      ? history[history.length - 1].price
      : this.getBasePrice(symbol);

    // Use symbol-specific volatility and random generator
    const volatility = this.getSymbolVolatility(symbol);
    const symbolHash = hashSymbol(symbol);

    // Get or initialize per-symbol random state
    let randomState = this.symbolRandomStates.get(symbol) || symbolHash;

    // Create random function using per-symbol state
    const random = () => {
      randomState = (randomState * 9301 + 49297) % 233280;
      return randomState / 233280;
    };

    // Update the state for next call
    this.symbolRandomStates.set(symbol, randomState);

    // Random walk with symbol-specific variance
    const change = (random() - 0.5) * lastPrice * volatility;
    const price = lastPrice + change;

    // Generate volume with symbol-specific randomness
    const volumeState = (randomState + 10000) % 233280;
    const volumeRandom = () => {
      return (volumeState * 9301 + 49297) % 233280 / 233280;
    };
    const volume = Math.floor(volumeRandom() * 900000) + 100000;

    return {
      symbol,
      timestamp: new Date(),
      price,
      bid: price * 0.999,
      ask: price * 1.001,
      volume,
      source: 'simulated',
    };
  }

  /**
   * Get base price for a symbol (different starting prices)
   */
  private getBasePrice(symbol: string): number {
    // Different currency pairs have different typical price levels
    const basePrices: Record<string, number> = {
      'EUR/USD': 1.08,
      'GBP/USD': 1.27,
      'USD/JPY': 151.5,
      'USD/CHF': 0.88,
      'AUD/USD': 0.66,
      'USD/CAD': 1.36,
      'NZD/USD': 0.61,
      'EUR/GBP': 0.85,
      'EUR/JPY': 163.5,
      'EUR/CHF': 0.95,
      'EUR/AUD': 1.64,
      'EUR/CAD': 1.47,
      'EUR/NZD': 1.77,
      'GBP/JPY': 192.5,
      'GBP/CHF': 1.12,
      'GBP/AUD': 1.93,
      'GBP/CAD': 1.73,
      'GBP/NZD': 2.08,
      'AUD/JPY': 100.5,
      'AUD/CAD': 0.90,
      'AUD/CHF': 0.58,
      'AUD/NZD': 0.92,
      'CAD/JPY': 111.5,
      'CHF/JPY': 172.0,
      'NZD/JPY': 92.5,
      'NZD/CAD': 0.83,
      'NZD/CHF': 0.54,
    };

    return basePrices[symbol] || (100 + Math.random() * 50);
  }

  /**
   * Get symbol-specific volatility to create more independent price movements
   */
  private getSymbolVolatility(symbol: string): number {
    // Use hash of symbol to create consistent but different volatility per symbol
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
      hash = ((hash << 5) - hash) + symbol.charCodeAt(i);
      hash = hash & hash;
    }

    // Map hash to volatility between 0.001 and 0.005
    const normalized = Math.abs(hash % 100) / 100;
    return 0.001 + normalized * 0.004;
  }

  /**
   * Fetch historical data
   */
  private async fetchHistoricalData(symbol: string): Promise<void> {
    try {
      if (this.source === 'tiger' && this.tigerClient) {
        // Tiger API: use bars for intraday 1-minute data
        const historical = await this.tigerClient.getHistoricalData(symbol, '1d', '1m');

        // Filter out invalid data (zero or null prices)
        const validHistorical = historical.filter(h => h.close > 0 && Number.isFinite(h.close));

        // If Tiger returns empty (symbol not in permission list), fallback to Yahoo Finance
        if (validHistorical.length === 0) {
          console.log(`⚠️ Tiger historical data empty for ${symbol}, falling back to Yahoo Finance`);
          const yahooHistorical = await this.yahooClient.getHistoricalData(symbol, '1d', '1m');
          const validYahoo = yahooHistorical.filter(h => h.close > 0 && Number.isFinite(h.close));

          const stockData: StockData[] = validYahoo.map((h) => ({
            symbol,
            timestamp: h.date,
            price: h.close,
            bid: h.low,
            ask: h.high,
            volume: this.toFinite(h.volume),
            source: 'yahoo',
          }));

          this.priceHistory.set(symbol, stockData.slice(-(this.lookbackPoints + 1)));
          for (const data of stockData.slice(-(this.lookbackPoints + 1))) {
            this.saveToDatabase(data);
          }
          console.log(`📊 Loaded ${Math.min(stockData.length, this.lookbackPoints + 1)} historical prices for ${symbol} (Yahoo fallback)`);
          return;
        }

        const stockData: StockData[] = validHistorical.map((h) => ({
          symbol,
          timestamp: h.date,
          price: h.close,
          bid: h.low,
          ask: h.high,
          volume: this.toFinite(h.volume),
          source: 'tiger',
        }));

        // Keep only enough points required by strategy window (+1 for return calculation)
        this.priceHistory.set(symbol, stockData.slice(-(this.lookbackPoints + 1)));

        // Save to database
        for (const data of stockData.slice(-(this.lookbackPoints + 1))) {
          this.saveToDatabase(data);
        }

        console.log(`📊 Loaded ${Math.min(stockData.length, this.lookbackPoints + 1)} historical prices for ${symbol} (Tiger)`);
      } else if (this.source === 'yahoo') {
        const historical = await this.yahooClient.getHistoricalData(symbol, '1d', '1m');

        // Filter out invalid data (zero or null prices)
        const validHistorical = historical.filter(h => h.close > 0 && Number.isFinite(h.close));

        const stockData: StockData[] = validHistorical.map((h) => ({
          symbol,
          timestamp: h.date,
          price: h.close,
          bid: h.low,
          ask: h.high,
          volume: this.toFinite(h.volume),
          source: 'yahoo',
        }));

        // Keep only enough points required by strategy window (+1 for return calculation)
        this.priceHistory.set(symbol, stockData.slice(-(this.lookbackPoints + 1)));

        // Save to database
        for (const data of stockData.slice(-(this.lookbackPoints + 1))) {
          this.saveToDatabase(data);
        }

        console.log(`📊 Loaded ${Math.min(stockData.length, this.lookbackPoints + 1)} historical prices for ${symbol}`);
      }
    } catch (error) {
      console.error(`Failed to fetch historical data for ${symbol}:`, error);
    }
  }

  /**
   * Update price history
   */
  private updateHistory(symbol: string, data: StockData): void {
    const history = this.priceHistory.get(symbol) || [];
    history.push(data);

    // Keep only strategy lookback window (+1 for return generation)
    while (history.length > this.lookbackPoints + 1) {
      history.shift();
    }

    this.priceHistory.set(symbol, history);
  }

  /**
   * Save to database
   */
  private saveToDatabase(data: StockData): void {
    try {
      const db = getDatabase();

      // Calculate return if we have previous data
      const history = this.priceHistory.get(data.symbol);
      let returnPct: number | null = null;

      if (history && history.length >= 2) {
        const prevPrice = history[history.length - 2].price;
        if (prevPrice > 0 && Number.isFinite(data.price)) {
          returnPct = (data.price - prevPrice) / prevPrice;
          // Check for Infinity or NaN
          if (!Number.isFinite(returnPct)) {
            returnPct = null;
          }
        }
      }

      db.prepare(`
        INSERT OR REPLACE INTO price_data (symbol, timestamp, price, volume, return_pct)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        data.symbol,
        data.timestamp.toISOString(),
        data.price,
        data.volume,
        returnPct
      );
    } catch (error) {
      console.error('Failed to save to database:', error);
    }
  }

  /**
   * Get price history for a symbol
   */
  getPriceHistory(symbol: string): StockData[] {
    return [...(this.priceHistory.get(symbol) || [])];
  }

  /**
   * Get latest price for a symbol
   */
  getLatestPrice(symbol: string): StockData | null {
    const history = this.priceHistory.get(symbol);
    return history && history.length > 0 ? history[history.length - 1] : null;
  }

  /**
   * Get all price histories
   */
  getAllPriceHistories(): Map<string, StockData[]> {
    return new Map(this.priceHistory);
  }

  get isActive(): boolean {
    return this.isRunning;
  }
}

export default UnifiedDataFetcher;
