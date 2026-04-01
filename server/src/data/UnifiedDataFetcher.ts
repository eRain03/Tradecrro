import YahooFinanceClient, { YahooQuote } from './YahooFinanceClient';
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
  source: 'yahoo' | 'simulated';
}

export type DataSource = 'yahoo' | 'simulated';

/**
 * Unified Data Fetcher
 * Supports multiple data sources: Yahoo Finance or Simulated
 * IG has been removed - use Yahoo Finance for stock/ETF data
 */
export class UnifiedDataFetcher {
  private yahooClient: YahooFinanceClient;
  private source: DataSource;
  private priceHistory: Map<string, StockData[]> = new Map();
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;

  // Per-symbol random state for independent randomness
  private symbolRandomStates: Map<string, number> = new Map();

  constructor(source: DataSource = 'yahoo') {
    this.source = source;
    this.yahooClient = new YahooFinanceClient();

    console.log(`📊 Data Fetcher initialized with source: ${source}`);
  }

  /**
   * Initialize the data fetcher
   */
  async initialize(): Promise<void> {
    // Yahoo Finance doesn't require authentication
    // IG data source has been removed
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

    // Fetch initial historical data
    console.log(`📈 Fetching historical data for ${uniqueSymbols.length} unique symbols...`);
    for (const symbol of uniqueSymbols) {
      await this.fetchHistoricalData(symbol);
    }

    // Start polling
    const intervalMs = config.trading.samplingInterval * 1000;
    this.intervalId = setInterval(async () => {
      for (const symbol of uniqueSymbols) {
        await this.fetchCurrentPrice(symbol);
      }
    }, intervalMs);

    console.log(`🔄 Started polling every ${config.trading.samplingInterval}s`);
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

    return {
      symbol,
      timestamp: quote.timestamp,
      price: quote.price,
      bid: quote.bid,
      ask: quote.ask,
      volume: quote.volume,
      source: 'yahoo',
    };
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
      if (this.source === 'yahoo') {
        const historical = await this.yahooClient.getHistoricalData(symbol, '5d', '1m');

        // Filter out invalid data (zero or null prices)
        const validHistorical = historical.filter(h => h.close > 0 && Number.isFinite(h.close));

        const stockData: StockData[] = validHistorical.map((h) => ({
          symbol,
          timestamp: h.date,
          price: h.close,
          bid: h.low,
          ask: h.high,
          volume: h.volume,
          source: 'yahoo',
        }));

        this.priceHistory.set(symbol, stockData);

        // Save to database
        for (const data of stockData) {
          this.saveToDatabase(data);
        }

        console.log(`📊 Loaded ${stockData.length} historical prices for ${symbol}`);
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

    // Keep only last 60 data points (30 minutes @ 30s)
    while (history.length > 60) {
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
