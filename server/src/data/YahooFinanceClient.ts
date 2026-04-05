import YahooFinance from 'yahoo-finance2';

export interface YahooQuote {
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

/**
 * Yahoo Finance Client
 * Free data source, no API key required
 * Rate limit: ~2000 requests per hour per IP
 */
export class YahooFinanceClient {
  private static client = new YahooFinance();
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 100; // 100ms between requests

  private toFiniteNumber(value: unknown, fallback: number = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  constructor() {
    // yahoo-finance2 default singleton client
  }

  /**
   * Get real-time quote for a symbol
   */
  async getQuote(symbol: string): Promise<YahooQuote> {
    await this.rateLimit();

    try {
      // Yahoo uses different symbol formats
      const yahooSymbol = this.normalizeSymbol(symbol);

      const result: any = await YahooFinanceClient.client.quote(yahooSymbol);

      // Handle undefined or invalid results (delisted/invalid symbols)
      if (!result || result.regularMarketPrice === undefined) {
        throw new Error(`No market data available for ${symbol} (may be delisted or invalid)`);
      }

      const marketPrice = result.regularMarketPrice ?? 0;
      const bid = result.bid ?? marketPrice;
      const ask = result.ask ?? marketPrice;
      const volume = result.regularMarketVolume ?? 0;
      const change = result.regularMarketChange ?? 0;
      const changePercent = result.regularMarketChangePercent ?? 0;

      return {
        symbol: symbol, // Return original symbol
        price: marketPrice,
        bid,
        ask,
        volume,
        timestamp: new Date(),
        change,
        changePercent,
      };
    } catch (error) {
      console.error(`Failed to get quote for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get historical price data using chart endpoint
   */
  async getHistoricalData(
    symbol: string,
    period: string = '1d',
    interval: string = '1m'
  ): Promise<HistoricalData[]> {
    await this.rateLimit();

    try {
      const yahooSymbol = this.normalizeSymbol(symbol);

      // Use chart endpoint for historical data
      const queryOptions = {
        period1: this.getPeriodStartDate(period),
        period2: new Date(),
        interval: interval as any,
      };

      const result: any = await YahooFinanceClient.client.chart(yahooSymbol, queryOptions);

      if (!result.quotes || result.quotes.length === 0) {
        return [];
      }

      const quotes = result.quotes.map((item: any) => ({
        date: new Date(item.date),
        open: this.toFiniteNumber(item.open),
        high: this.toFiniteNumber(item.high),
        low: this.toFiniteNumber(item.low),
        close: this.toFiniteNumber(item.close),
        volume: this.toFiniteNumber(item.volume),
      }));

      return quotes;
    } catch (error) {
      console.error(`Failed to get historical data for ${symbol}:`, error);
      // Return empty array instead of throwing
      return [];
    }
  }

  /**
   * Get quotes for multiple symbols
   */
  async getQuotes(symbols: string[]): Promise<YahooQuote[]> {
    const quotes: YahooQuote[] = [];

    for (const symbol of symbols) {
      try {
        const quote = await this.getQuote(symbol);
        quotes.push(quote);
      } catch (error) {
        console.warn(`Skipping ${symbol} due to error`);
      }
    }

    return quotes;
  }

  /**
   * Search for symbols
   */
  async search(query: string): Promise<Array<{
    symbol: string;
    name: string;
    type: string;
  }>> {
    await this.rateLimit();

    try {
      const results: any = await YahooFinanceClient.client.search(query);

      return results.quotes.map((q: any) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        type: q.quoteType || 'EQUITY',
      }));
    } catch (error) {
      console.error(`Search failed for "${query}":`, error);
      return [];
    }
  }

  /**
   * Get historical data for an explicit time range
   */
  async getHistoricalRange(
    symbol: string,
    startTime: Date,
    endTime: Date,
    interval: string = '1m'
  ): Promise<HistoricalData[]> {
    await this.rateLimit();

    try {
      const yahooSymbol = this.normalizeSymbol(symbol);
      const result: any = await YahooFinanceClient.client.chart(yahooSymbol, {
        period1: startTime,
        period2: endTime,
        interval: interval as any,
      });

      if (!result.quotes || result.quotes.length === 0) {
        return [];
      }

      const quotes = result.quotes.map((item: any) => ({
        date: new Date(item.date),
        open: this.toFiniteNumber(item.open),
        high: this.toFiniteNumber(item.high),
        low: this.toFiniteNumber(item.low),
        close: this.toFiniteNumber(item.close),
        volume: this.toFiniteNumber(item.volume),
      }));

      return quotes;
    } catch (error) {
      console.error(`Failed to get historical range for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Normalize symbol for Yahoo Finance
   * Forex pairs: EUR/USD -> EURUSD=X
   * Stock symbols: AAPL -> AAPL
   */
  private normalizeSymbol(symbol: string): string {
    // Check if it's a forex pair (contains /)
    if (symbol.includes('/')) {
      // Convert EUR/USD to EURUSD=X
      const baseCurrency = symbol.split('/')[0];
      const quoteCurrency = symbol.split('/')[1];
      return `${baseCurrency}${quoteCurrency}=X`;
    }

    // Handle special cases for stocks
    const specialCases: Record<string, string> = {
      'BRK.A': 'BRK-A',
      'BRK.B': 'BRK-B',
    };

    return specialCases[symbol] || symbol;
  }

  /**
   * Get start date for historical data
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
   * Rate limiting to avoid being blocked
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      await this.sleep(this.minRequestInterval - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default YahooFinanceClient;
