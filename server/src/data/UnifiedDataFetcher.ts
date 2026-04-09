import YahooFinanceClient, { YahooQuote } from './YahooFinanceClient';
import TigerClient, { TigerQuote } from './TigerClient';
import apiOrchestrator, { DataSource } from './APIOrchestrator';
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

/**
 * Unified Data Fetcher
 *
 * Uses APIOrchestrator for automatic failover between Tiger and Yahoo.
 * When Tiger is rate-limited or unavailable, automatically switches to Yahoo.
 * When Tiger recovers, automatically switches back.
 */
export class UnifiedDataFetcher {
  private yahooClient: YahooFinanceClient;
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

    this.lookbackPoints = Math.max(
      2,
      Math.floor((config.trading.lookbackWindow * 60) / config.trading.samplingInterval)
    );

    console.log(`📊 Data Fetcher initialized with source: ${source}`);
    console.log(`📊 API Orchestrator status: ${apiOrchestrator.isUsingFallback() ? 'Using fallback (Yahoo)' : 'Using primary'}`);
  }

  /**
   * Initialize the data fetcher
   */
  async initialize(): Promise<void> {
    // API Orchestrator handles client initialization
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

    for (const symbol of this.activeSymbols) {
      await this.fetchHistoricalData(symbol);
    }

    // Start polling
    const intervalMs = config.trading.samplingInterval * 1000;
    this.intervalId = setInterval(async () => {
      await this.fetchAllCurrentPrices();
    }, intervalMs);

    console.log(`🔄 Started polling every ${config.trading.samplingInterval}s`);
  }

  /**
   * Fetch all current prices with automatic failover
   */
  private async fetchAllCurrentPrices(): Promise<void> {
    if (this.activeSymbols.size === 0) return;

    try {
      // Use orchestrator for batch fetching
      const results = await this.fetchAllWithOrchestrator();

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
      console.error('Failed to fetch batch prices:', error);
    }
  }

  /**
   * Fetch all symbols using orchestrator with failover
   */
  private async fetchAllWithOrchestrator(): Promise<Map<string, StockData>> {
    const symbols = Array.from(this.activeSymbols);
    const results = new Map<string, StockData>();

    // Check current source status
    const status = apiOrchestrator.getStatus();
    const usingFallback = apiOrchestrator.isUsingFallback();

    if (usingFallback) {
      console.log('📊 Using Yahoo (fallback mode)');
    }

    // Try Tiger first if available
    if (this.source === 'tiger' && apiOrchestrator.isTigerAvailable()) {
      const tigerClient = apiOrchestrator.getTigerClient();
      if (tigerClient) {
        try {
          const quotes = await tigerClient.getQuotes(symbols);

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

          // Record success
          const tigerStatus = status.tiger;
          tigerStatus.available = true;

          return results;
        } catch (error: any) {
          console.error('Tiger API error in batch fetch:', error.message?.slice(0, 100));

          // Let orchestrator handle the error and potential failover
          // Fall through to Yahoo
        }
      }
    }

    // Use Yahoo as fallback
    console.log('📊 Fetching from Yahoo Finance...');
    for (const symbol of symbols) {
      try {
        const data = await this.fetchFromYahoo(symbol);
        results.set(symbol, data);
      } catch (error: any) {
        console.error(`Failed to fetch ${symbol} from Yahoo:`, error.message?.slice(0, 50));
      }
    }

    return results;
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

      // Use orchestrator to determine source
      if (this.source === 'tiger' && apiOrchestrator.isTigerAvailable()) {
        data = await this.fetchFromTigerWithFailover(symbol);
      } else {
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
   * Fetch from Tiger with automatic failover to Yahoo
   */
  private async fetchFromTigerWithFailover(symbol: string): Promise<StockData> {
    const tigerClient = apiOrchestrator.getTigerClient();

    if (!tigerClient || !apiOrchestrator.isTigerAvailable()) {
      // Fall back to Yahoo
      console.log(`📊 Tiger unavailable, fetching ${symbol} from Yahoo`);
      return this.fetchFromYahoo(symbol);
    }

    try {
      const quote = await tigerClient.getQuote(symbol);

      return {
        symbol,
        timestamp: quote.timestamp,
        price: quote.price,
        bid: quote.bid,
        ask: quote.ask,
        volume: quote.volume,
        source: 'tiger',
      };
    } catch (error: any) {
      // Check if should failover
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('rate limit') ||
          errorMsg.includes('blacklist') ||
          errorMsg.includes('disabled') ||
          errorMsg.includes('paused')) {
        console.log(`⚠️ Tiger error for ${symbol}, falling back to Yahoo: ${error.message?.slice(0, 50)}`);
        return this.fetchFromYahoo(symbol);
      }
      throw error;
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
   */
  private async fetchFromTiger(symbol: string): Promise<StockData> {
    const tigerClient = apiOrchestrator.getTigerClient();
    if (!tigerClient) {
      throw new Error('Tiger client not available');
    }

    const quote = await tigerClient.getQuote(symbol);

    return {
      symbol,
      timestamp: quote.timestamp,
      price: quote.price,
      bid: quote.bid,
      ask: quote.ask,
      volume: quote.volume,
      source: 'tiger',
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

    const volatility = this.getSymbolVolatility(symbol);
    const symbolHash = hashSymbol(symbol);

    let randomState = this.symbolRandomStates.get(symbol) || symbolHash;

    const random = () => {
      randomState = (randomState * 9301 + 49297) % 233280;
      return randomState / 233280;
    };

    this.symbolRandomStates.set(symbol, randomState);

    const change = (random() - 0.5) * lastPrice * volatility;
    const price = lastPrice + change;

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
    const basePrices: Record<string, number> = {
      'EUR/USD': 1.08,
      'GBP/USD': 1.27,
      'USD/JPY': 151.5,
      'USD/CHF': 0.88,
      'AUD/USD': 0.66,
      'USD/CAD': 1.36,
      'NZD/USD': 0.61,
    };

    return basePrices[symbol] || (100 + Math.random() * 50);
  }

  /**
   * Get symbol-specific volatility
   */
  private getSymbolVolatility(symbol: string): number {
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
      hash = ((hash << 5) - hash) + symbol.charCodeAt(i);
      hash = hash & hash;
    }

    const normalized = Math.abs(hash % 100) / 100;
    return 0.001 + normalized * 0.004;
  }

  /**
   * Fetch historical data
   */
  private async fetchHistoricalData(symbol: string): Promise<void> {
    try {
      // Try Tiger first, then Yahoo
      if (this.source === 'tiger' && apiOrchestrator.isTigerAvailable()) {
        const tigerClient = apiOrchestrator.getTigerClient();
        if (tigerClient) {
          try {
            const historical = await tigerClient.getHistoricalData(symbol, '1d', '1m');
            const validHistorical = historical.filter(h => h.close > 0 && Number.isFinite(h.close));

            if (validHistorical.length > 0) {
              const stockData: StockData[] = validHistorical.map((h) => ({
                symbol,
                timestamp: h.date,
                price: h.close,
                bid: h.low,
                ask: h.high,
                volume: this.toFinite(h.volume),
                source: 'tiger' as const,
              }));

              this.priceHistory.set(symbol, stockData.slice(-(this.lookbackPoints + 1)));
              for (const data of stockData.slice(-(this.lookbackPoints + 1))) {
                this.saveToDatabase(data);
              }
              console.log(`📊 Loaded ${Math.min(stockData.length, this.lookbackPoints + 1)} historical prices for ${symbol} (Tiger)`);
              return;
            }
          } catch (error: any) {
            console.log(`⚠️ Tiger historical data failed for ${symbol}: ${error.message?.slice(0, 50)}`);
          }
        }
      }

      // Fallback to Yahoo
      const historical = await this.yahooClient.getHistoricalData(symbol, '1d', '1m');
      const validHistorical = historical.filter(h => h.close > 0 && Number.isFinite(h.close));

      const stockData: StockData[] = validHistorical.map((h) => ({
        symbol,
        timestamp: h.date,
        price: h.close,
        bid: h.low,
        ask: h.high,
        volume: this.toFinite(h.volume),
        source: 'yahoo' as const,
      }));

      this.priceHistory.set(symbol, stockData.slice(-(this.lookbackPoints + 1)));
      for (const data of stockData.slice(-(this.lookbackPoints + 1))) {
        this.saveToDatabase(data);
      }
      console.log(`📊 Loaded ${Math.min(stockData.length, this.lookbackPoints + 1)} historical prices for ${symbol} (Yahoo)`);
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

      const history = this.priceHistory.get(data.symbol);
      let returnPct: number | null = null;

      if (history && history.length >= 2) {
        const prevPrice = history[history.length - 2].price;
        if (prevPrice > 0 && Number.isFinite(data.price)) {
          returnPct = (data.price - prevPrice) / prevPrice;
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