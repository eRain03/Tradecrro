import CorrelationCalculator, { CorrelationResult } from './CorrelationCalculator';

/**
 * Synchronous Correlation (Negative Correlation Detection)
 * Used for detecting stocks that move in opposite directions simultaneously
 */
export class SyncCorrelation {
  /**
   * Calculate synchronous negative correlation
   * Returns correlation and strength assessment
   */
  static calculate(
    returnsA: number[],
    returnsB: number[]
  ): {
    correlation: number;
    isNegative: boolean;
    strength: 'weak' | 'moderate' | 'strong';
    result: CorrelationResult;
  } {
    const result = CorrelationCalculator.calculateSyncCorrelation(returnsA, returnsB);
    const correlation = result.correlation;

    // Determine strength
    const absCorr = Math.abs(correlation);
    let strength: 'weak' | 'moderate' | 'strong';
    if (absCorr >= 0.8) {
      strength = 'strong';
    } else if (absCorr >= 0.5) {
      strength = 'moderate';
    } else {
      strength = 'weak';
    }

    return {
      correlation,
      isNegative: correlation < 0,
      strength,
      result,
    };
  }

  /**
   * Check if negative correlation meets threshold
   */
  static meetsThreshold(
    returnsA: number[],
    returnsB: number[],
    threshold: number = -0.8
  ): boolean {
    const { correlation } = this.calculate(returnsA, returnsB);
    return correlation <= threshold;
  }

  /**
   * Calculate correlation score (0-80 scale)
   */
  static calculateScore(correlation: number): number {
    return Math.abs(correlation) * 80;
  }
}

export default SyncCorrelation;
