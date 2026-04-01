import IGClient from './IGClient';

export interface OptionContract {
  epic: string;
  strike: number;
  expiry: Date;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  underlyingPrice: number;
}

export interface OptionChain {
  underlyingEpic: string;
  underlyingPrice: number;
  calls: OptionContract[];
  puts: OptionContract[];
  expiryDates: Date[];
}

export class OptionChainFetcher {
  private igClient: IGClient;

  constructor(igClient: IGClient) {
    this.igClient = igClient;
  }

  async fetchOptionChain(underlyingSymbol: string): Promise<OptionChain> {
    // Search for options on this underlying
    const optionMarkets = await this.igClient.searchMarkets(
      underlyingSymbol
    );

    if (!optionMarkets || optionMarkets.length === 0) {
      throw new Error(`No options found for ${underlyingSymbol}`);
    }

    // Get underlying market data
    const underlyingMarket = await this.igClient.getMarketData(underlyingSymbol);
    const underlyingSnapshot = underlyingMarket.snapshot || underlyingMarket as any;
    const underlyingPrice = ((underlyingSnapshot as any).bid + (underlyingSnapshot as any).ask) / 2;

    // Parse options
    const calls: OptionContract[] = [];
    const puts: OptionContract[] = [];
    const expirySet = new Set<string>();

    for (const market of optionMarkets) {
      const contract = this.parseOptionContract(market, underlyingPrice);

      if (contract) {
        // Simple heuristic: if strike > underlying, likely call; else put
        // In real implementation, IG API should provide option type
        if (market.epic.includes('CALL') || market.epic.includes('C')) {
          calls.push(contract);
        } else if (market.epic.includes('PUT') || market.epic.includes('P')) {
          puts.push(contract);
        } else {
          // Default to call for ATM and above
          if (contract.strike >= underlyingPrice) {
            calls.push(contract);
          } else {
            puts.push(contract);
          }
        }

        expirySet.add(contract.expiry.toISOString().split('T')[0]);
      }
    }

    // Sort by strike
    calls.sort((a, b) => a.strike - b.strike);
    puts.sort((a, b) => a.strike - b.strike);

    return {
      underlyingEpic: underlyingSymbol,
      underlyingPrice,
      calls,
      puts,
      expiryDates: Array.from(expirySet).map(d => new Date(d)),
    };
  }

  async fetchCallsOnly(underlyingSymbol: string): Promise<OptionContract[]> {
    const chain = await this.fetchOptionChain(underlyingSymbol);
    return chain.calls;
  }

  async getOptionDetails(epic: string): Promise<OptionContract | null> {
    try {
      const market = await this.igClient.getMarketData(epic);
      return this.parseOptionContract(market, 0);
    } catch (error) {
      console.error(`Failed to get option details for ${epic}:`, error);
      return null;
    }
  }

  private parseOptionContract(market: any, underlyingPrice: number): OptionContract | null {
    try {
      const snapshot = market.snapshot || market;

      // Extract strike from epic or instrument name
      // Format varies by market, this is a simplified parser
      const strikeMatch = market.instrument?.name?.match(/(\d+(?:\.\d+)?)/);
      const strike = strikeMatch ? parseFloat(strikeMatch[1]) : 0;

      // Parse expiry date
      const expiryStr = market.instrument?.expiry;
      const expiry = expiryStr ? new Date(expiryStr) : new Date();

      return {
        epic: market.epic,
        strike,
        expiry,
        bid: snapshot.bid,
        ask: snapshot.ask,
        volume: snapshot.volume || 0,
        openInterest: 0, // May not be available in basic API
        underlyingPrice,
      };
    } catch (error) {
      console.error('Failed to parse option contract:', error);
      return null;
    }
  }
}

export default OptionChainFetcher;
