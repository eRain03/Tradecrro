import * as yahooFinanceModules from 'yahoo-finance2/modules';
import createYahooFinance from 'yahoo-finance2/createYahooFinance';
import { YahooFinance } from 'yahoo-finance2';

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
  private yahooFinance: YahooFinance;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 100; // 100ms between requests

  constructor() {
    // Initialize Yahoo Finance client (v3 requires instantiation with modules)
    const YahooFinanceClass = createYahooFinance({ modules: yahooFinanceModules });
    this.yahooFinance = new YahooFinanceClass();
  }

  /**
   * Get real-time quote for a symbol
   */
  async getQuote(symbol: string): Promise<YahooQuote> {
    await this.rateLimit();

    try {
      // Yahoo uses different symbol formats
      const yahooSymbol = this.normalizeSymbol(symbol);

      const result: any = await this.yahooFinance.quote(yahooSymbol);

      return {
        symbol: symbol, // Return original symbol
        price: result.regularMarketPrice || 0,
        bid: result.bid || result.regularMarketPrice || 0,
        ask: result.ask || result.regularMarketPrice || 0,
        volume: result.regularMarketVolume || 0,
        timestamp: new Date(),
        change: result.regularMarketChange || 0,
        changePercent: result.regularMarketChangePercent || 0,
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

      const result: any = await this.yahooFinance.chart(yahooSymbol, queryOptions);

      if (!result.quotes || result.quotes.length === 0) {
        return [];
      }

      return result.quotes.map((item: any) => ({
        date: new Date(item.date),
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      }));
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
      const results: any = await this.yahooFinance.search(query);

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
