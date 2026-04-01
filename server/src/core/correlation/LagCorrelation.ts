import CorrelationCalculator from './CorrelationCalculator';
import config from '../../config';

/**
 * Lagged Correlation (Positive Correlation Detection)
 * Used for detecting lead-lag relationships
 * Default lag: 10 intervals = 5 minutes @ 30s interval
 */
export class LagCorrelation {
  private static readonly DEFAULT_LAG = config.trading.lagIntervals;

  /**
   * Calculate lagged correlation with default settings
   * Tests both directions and returns the stronger relationship
   * Uses discounted correlation to penalize higher lags
   */
  static calculate(
    returnsA: number[],
    returnsB: number[],
    maxLag: number = LagCorrelation.DEFAULT_LAG
  ): {
    leader: 'A' | 'B';
    lagger: 'A' | 'B';
    correlation: number; // Raw correlation
    discountedCorrelation: number; // Correlation with lag discount
    lag: number;
    isPositive: boolean;
    strength: 'weak' | 'moderate' | 'strong';
  } | null {
    const result = CorrelationCalculator.detectLeadLag(returnsA, returnsB, maxLag);

    if (!result) {
      return null;
    }

    // Determine strength based on discounted correlation
    const absCorr = Math.abs(result.discountedCorrelation);
    let strength: 'weak' | 'moderate' | 'strong';
    if (absCorr >= 0.8) {
      strength = 'strong';
    } else if (absCorr >= 0.5) {
      strength = 'moderate';
    } else {
      strength = 'weak';
    }

    return {
      ...result,
      isPositive: result.discountedCorrelation > 0,
      strength,
    };
  }

  /**
   * Check if lagged correlation meets threshold
   */
  static meetsThreshold(
    returnsA: number[],
    returnsB: number[],
    threshold: number = 0.8
  ): boolean {
    const result = this.calculate(returnsA, returnsB);
    if (!result) return false;
    return result.correlation >= threshold;
  }

  /**
   * Calculate correlation score (0-80 scale)
   */
  static calculateScore(correlation: number): number {
    return Math.abs(correlation) * 80;
  }

  /**
   * Get leader stock symbol
   */
  static getLeader(
    stockA: string,
    stockB: string,
    result: { leader: 'A' | 'B' }
  ): string {
    return result.leader === 'A' ? stockA : stockB;
  }

  /**
   * Get lagger stock symbol
   */
  static getLagger(
    stockA: string,
    stockB: string,
    result: { lagger: 'A' | 'B' }
  ): string {
    return result.lagger === 'A' ? stockA : stockB;
  }
}

export default LagCorrelation;
