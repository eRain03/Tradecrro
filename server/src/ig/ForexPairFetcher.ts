import IGClient from './IGClient';

/**
 * Forex pair data structure
 */
export interface ForexPair {
  epic: string;           // Unique IG market identifier, e.g. CS.D.EURUSD.CFD.IP
  pairName: string;       // Normalized name, e.g. EUR/USD
  instrumentName: string; // Full name returned by IG
  instrumentType: string; // CURRENCIES
  marketStatus: string;   // TRADEABLE, CLOSED etc.
}

/**
 * Forex pair retrieval service
 *
 * Use keyword matrix to search IG markets and fetch available forex pairs
 * Reference: testjs/testall.js
 */
export class ForexPairFetcher {
  private igClient: IGClient;

  // Core currency keyword matrix
  private searchKeywords = [
    'USD', 'EUR', 'GBP', 'JPY',
    'AUD', 'CAD', 'CHF', 'NZD'
  ];

  constructor(igClient: IGClient) {
    this.igClient = igClient;
  }

  /**
   * Fetch all available forex pairs
   *
   * @returns De-duplicated forex pair list
   */
  async searchAllForexPairs(): Promise<ForexPair[]> {
    console.log('🔍 Starting forex pair retrieval from IG API...');

    // Ensure authenticated
    if (!this.igClient.isConnected) {
      await this.igClient.authenticate();
    }

    const allPairs: ForexPair[] = [];
    const epicSet = new Set<string>();

    // Search keyword by keyword
    for (const keyword of this.searchKeywords) {
      console.log(`  Searching instruments containing "${keyword}" ...`);

      try {
        const markets = await this.searchMarkets(keyword);

        let addedCount = 0;
        for (const market of markets) {
          // Keep only tradeable forex instruments
          if (market.instrumentType === 'CURRENCIES' &&
              market.marketStatus === 'TRADEABLE') {

            // De-duplicate: check whether epic already exists
            if (!epicSet.has(market.epic)) {
              epicSet.add(market.epic);

              const forexPair = this.normalizePair(market);
              if (forexPair) {
                allPairs.push(forexPair);
                addedCount++;
              }
            }
          }
        }

        console.log(`    └─ Added  ${addedCount}  pairs`);

      } catch (error) {
        console.error(`    ❌ Search ${keyword}  failed:`, error);
      }

      // Delay 1 second between requests to avoid API rate limiting
      await this.sleep(1000);
    }

    console.log(`\n✅ Retrieval complete! total active de-duplicated forex pairs:  ${allPairs.length} `);
    return allPairs;
  }

  /**
   * Search markets
   */
  private async searchMarkets(keyword: string): Promise<any[]> {
    return await this.igClient.searchMarkets(keyword);
  }

  /**
   * Normalize forex pair data
   *
   * Convert IG market data to standard ForexPair format
   */
  private normalizePair(market: any): ForexPair | null {
    const instrumentName = market.instrumentName || '';

    // Skip non-standard contracts (mini/special etc.)
    // Prefer CFD contracts
    if (!market.epic.includes('.CFD.IP')) {
      // If no CFD contract exists, accept other standard contracts
      // Adjust according to requirements
    }

    // Extract pair name from instrumentName
    // Example: "Euro/US Dollar" -> "EUR/USD"
    // Or:"EUR/USD" -> "EUR/USD"
    const pairName = this.extractPairName(instrumentName);

    if (!pairName) {
      return null;
    }

    return {
      epic: market.epic,
      pairName: pairName,
      instrumentName: instrumentName,
      instrumentType: market.instrumentType || 'CURRENCIES',
      marketStatus: market.marketStatus || 'TRADEABLE',
    };
  }

  /**
   * Extract normalized pair name from instrumentName
   *
   * Support Chinese and English name parsing
   */
  private extractPairName(instrumentName: string): string | null {
    // Currency code mapping (Chinese -> English)
    const currencyMap: Record<string, string> = {
      'Euro': 'EUR',
      'US Dollar': 'USD',
      'British Pound': 'GBP',
      'Japanese Yen': 'JPY',
      'Australian Dollar': 'AUD',
      'Canadian Dollar': 'CAD',
      'Swiss Franc': 'CHF',
      'New Zealand Dollar': 'NZD',
      'Chinese Yuan': 'CNH',
      'Hong Kong Dollar': 'HKD',
      'Singapore Dollar': 'SGD',
      'Norwegian Krone': 'NOK',
      'Swedish Krona': 'SEK',
      'Danish Krone': 'DKK',
      'Polish Zloty': 'PLN',
      'Czech Koruna': 'CZK',
      'Hungarian Forint': 'HUF',
      'Turkish Lira': 'TRY',
      'Mexican Peso': 'MXN',
      'South African Rand': 'ZAR',
      'Indian Rupee': 'INR',
      'Korean Won': 'KRW',
      'Philippine Peso': 'PHP',
      'New Taiwan Dollar': 'TWD',
    };

    // Try matching Chinese names (e.g. Euro/USD)
    for (const [cnName, enCode] of Object.entries(currencyMap)) {
      if (instrumentName.includes(cnName)) {
        // Find paired second currency
        for (const [cnName2, enCode2] of Object.entries(currencyMap)) {
          if (cnName !== cnName2 && instrumentName.includes(cnName2)) {
            // Determine order: which currency appears first
            const index1 = instrumentName.indexOf(cnName);
            const index2 = instrumentName.indexOf(cnName2);

            if (index1 < index2) {
              return `${enCode}/${enCode2}`;
            } else {
              return `${enCode2}/${enCode}`;
            }
          }
        }
      }
    }

    // Try matching English names (e.g. EUR/USD)
    const forexPattern = /([A-Z]{3})\/([A-Z]{3})/;
    const match = instrumentName.match(forexPattern);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }

    // If no match, return original name as pairName
    return instrumentName.split(' ')[0];
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all search keywords
   */
  getKeywords(): string[] {
    return [...this.searchKeywords];
  }

  /**
   * Add search keyword
   */
  addKeyword(keyword: string): void {
    const upperKeyword = keyword.toUpperCase().trim();
    if (!this.searchKeywords.includes(upperKeyword)) {
      this.searchKeywords.push(upperKeyword);
    }
  }
}

export default ForexPairFetcher;
