/**
 * Forex Epic Code Mapper for IG Markets
 *
 * IG Markets uses specific epic codes for forex pairs.
 *
 * Common formats:
 * - Spot Forex: FX:EUR/USD, FX:GBP/USD, etc.
 * - Forex (no slash): FX:EURUSD
 * - Some brokers use: EURUSD.FEB25 (forward contracts)
 *
 * This mapper provides the correct epic codes for IG Markets.
 */

interface EpicMapping {
  [pair: string]: string;
}

export class ForexEpicMapper {
  // IG Markets forex epic codes - using FX: prefix format
  private static readonly FOREX_MAPPINGS: EpicMapping = {
    // Majors
    'EUR/USD': 'FX:EURUSD',
    'GBP/USD': 'FX:GBPUSD',
    'USD/JPY': 'FX:USDJPY',
    'USD/CHF': 'FX:USDCHF',
    'AUD/USD': 'FX:AUDUSD',
    'USD/CAD': 'FX:USDCAD',
    'NZD/USD': 'FX:NZDUSD',

    // EUR crosses
    'EUR/GBP': 'FX:EURGBP',
    'EUR/JPY': 'FX:EURJPY',
    'EUR/CHF': 'FX:EURCHF',
    'EUR/AUD': 'FX:EURAUD',
    'EUR/CAD': 'FX:EURCAD',
    'EUR/NZD': 'FX:EURNZD',

    // GBP crosses
    'GBP/JPY': 'FX:GBPJPY',
    'GBP/CHF': 'FX:GBPCHF',
    'GBP/AUD': 'FX:GBPAUD',
    'GBP/CAD': 'FX:GBPCAD',
    'GBP/NZD': 'FX:GBPNZD',

    // AUD crosses
    'AUD/JPY': 'FX:AUDJPY',
    'AUD/CAD': 'FX:AUDCAD',
    'AUD/CHF': 'FX:AUDCHF',
    'AUD/NZD': 'FX:AUDNZD',

    // CAD crosses
    'CAD/JPY': 'FX:CADJPY',
    'CAD/CHF': 'FX:CADCHF',

    // CHF crosses
    'CHF/JPY': 'FX:CHFJPY',

    // NZD crosses
    'NZD/JPY': 'FX:NZDJPY',
    'NZD/CAD': 'FX:NZDCAD',
    'NZD/CHF': 'FX:NZDCHF',

    // Indices
    'DXY': 'FX:DXY', // US Dollar Index
  };

  /**
   * Get IG epic code for a forex pair
   * Format: FX:EURUSD (with colon and no slash)
   */
  static getEpic(pair: string): string {
    const upperPair = pair.toUpperCase().trim();
    const mapping = this.FOREX_MAPPINGS[upperPair];

    if (mapping) {
      return mapping;
    }

    // Generate epic from pair name as fallback
    // Convert "EUR/USD" to "FX:EURUSD"
    const generatedEpic = this.generateEpicFromPair(pair);
    console.warn(`No mapping found for ${pair}, using generated epic: ${generatedEpic}`);
    return generatedEpic;
  }

  /**
   * Generate epic code from pair name (fallback method)
   * Converts EUR/USD -> FX:EURUSD
   */
  private static generateEpicFromPair(pair: string): string {
    const normalized = pair.toUpperCase().replace('/', '').replace(' ', '');
    return `FX:${normalized}`;
  }

  /**
   * Check if a symbol is a forex pair
   */
  static isForexPair(symbol: string): boolean {
    const upperSymbol = symbol.toUpperCase().trim();

    // Check if it's in our mapping
    if (this.FOREX_MAPPINGS[upperSymbol]) {
      return true;
    }

    // Check if it matches forex pattern (XXX/YYY)
    return /^[A-Z]{3}\/[A-Z]{3}$/.test(upperSymbol);
  }

  /**
   * Get all supported forex pairs
   */
  static getAllPairs(): string[] {
    return Object.keys(this.FOREX_MAPPINGS);
  }

  /**
   * Search for pairs containing a symbol (e.g., "EUR" returns all EUR pairs)
   */
  static searchPairs(symbol: string): string[] {
    const upperSymbol = symbol.toUpperCase().trim();
    return Object.keys(this.FOREX_MAPPINGS).filter(
      pair => pair.includes(upperSymbol)
    );
  }
}

export default ForexEpicMapper;
