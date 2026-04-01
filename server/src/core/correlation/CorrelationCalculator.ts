import ReturnCalculator from '../data/ReturnCalculator';

export interface CorrelationResult {
  correlation: number;
  pValue: number;
  sampleSize: number;
}

export class CorrelationCalculator {
  /**
   * Calculate Pearson correlation coefficient
   * Range: -1 to +1
   */
  static pearsonCorrelation(x: number[], y: number[]): CorrelationResult {
    const n = x.length;

    if (n !== y.length || n < 2) {
      return { correlation: 0, pValue: 1, sampleSize: n };
    }

    // Check for NaN or Infinity in input data
    const xValid = x.every(v => Number.isFinite(v));
    const yValid = y.every(v => Number.isFinite(v));
    if (!xValid || !yValid) {
      console.log(`[CorrelationCalculator] Invalid data: xValid=${xValid}, yValid=${yValid}, n=${n}`);
      return { correlation: 0, pValue: 1, sampleSize: n };
    }

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt(
      (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
    );

    if (denominator === 0) {
      console.log(`[CorrelationCalculator] Denominator is 0, numerator=${numerator}`);
      return { correlation: 0, pValue: 1, sampleSize: n };
    }

    const correlation = numerator / denominator;

    // Calculate p-value (simplified)
    const tStat = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));
    const pValue = this.calculatePValue(tStat, n - 2);

    return {
      correlation: Math.max(-1, Math.min(1, correlation)),
      pValue,
      sampleSize: n,
    };
  }

  /**
   * Calculate synchronous correlation (no lag)
   * For negative correlation detection
   */
  static calculateSyncCorrelation(
    returnsA: number[],
    returnsB: number[]
  ): CorrelationResult {
    return this.pearsonCorrelation(returnsA, returnsB);
  }

  /**
   * Calculate lagged correlation
   * Tests if series A leads series B by 'lag' periods
   */
  static calculateLaggedCorrelation(
    leader: number[],
    lagger: number[],
    lag: number
  ): CorrelationResult {
    if (leader.length !== lagger.length || leader.length <= lag) {
      return { correlation: 0, pValue: 1, sampleSize: 0 };
    }

    // Shift leader forward by 'lag' periods
    const leaderSlice = leader.slice(0, leader.length - lag);
    const laggerSlice = lagger.slice(lag);

    return this.pearsonCorrelation(leaderSlice, laggerSlice);
  }

  /**
   * Detect lead-lag relationship
   * Tests both directions and returns the stronger relationship
   * Uses discounted correlation to penalize higher lags
   */
  static detectLeadLag(
    returnsA: number[],
    returnsB: number[],
    maxLag: number = 10
  ): {
    leader: 'A' | 'B';
    lagger: 'A' | 'B';
    correlation: number;
    discountedCorrelation: number; // Correlation with lag discount applied
    lag: number;
  } | null {
    let bestResult: {
      leader: 'A' | 'B';
      lagger: 'A' | 'B';
      correlation: number;
      discountedCorrelation: number;
      lag: number;
    } | null = null;

    let maxScore = 0;

    // Test A leading B
    for (let lag = 1; lag <= maxLag; lag++) {
      const result = this.calculateLaggedCorrelation(returnsA, returnsB, lag);
      // Apply discount factor for higher lags (prefer shorter lags)
      const discountFactor = 1 - (lag / (maxLag + 1)); // e.g., lag=1: 0.9, lag=10: 0.09
      const discountedScore = result.correlation * discountFactor;

      if (discountedScore > maxScore) {
        maxScore = discountedScore;
        bestResult = {
          leader: 'A',
          lagger: 'B',
          correlation: result.correlation,
          discountedCorrelation: discountedScore,
          lag,
        };
      }
    }

    // Test B leading A
    for (let lag = 1; lag <= maxLag; lag++) {
      const result = this.calculateLaggedCorrelation(returnsB, returnsA, lag);
      const discountFactor = 1 - (lag / (maxLag + 1));
      const discountedScore = result.correlation * discountFactor;

      if (discountedScore > maxScore) {
        maxScore = discountedScore;
        bestResult = {
          leader: 'B',
          lagger: 'A',
          correlation: result.correlation,
          discountedCorrelation: discountedScore,
          lag,
        };
      }
    }

    return bestResult;
  }

  /**
   * Calculate rolling correlation
   */
  static rollingCorrelation(
    returnsA: number[],
    returnsB: number[],
    windowSize: number = 60
  ): number[] {
    const correlations: number[] = [];

    for (let i = windowSize; i <= returnsA.length; i++) {
      const windowA = returnsA.slice(i - windowSize, i);
      const windowB = returnsB.slice(i - windowSize, i);
      const result = this.pearsonCorrelation(windowA, windowB);
      correlations.push(result.correlation);
    }

    return correlations;
  }

  /**
   * Check if correlation is significant
   */
  static isSignificant(
    correlation: number,
    sampleSize: number,
    alpha: number = 0.05
  ): boolean {
    if (sampleSize < 3) return false;

    const tStat = correlation * Math.sqrt((sampleSize - 2) / (1 - correlation * correlation));
    const criticalValue = 1.96; // Approximate for 95% confidence

    return Math.abs(tStat) > criticalValue;
  }

  private static calculatePValue(tStat: number, df: number): number {
    // Simplified p-value calculation
    // In production, use a proper statistical library
    if (df <= 0) return 1;

    const x = df / (df + tStat * tStat);
    // Beta function approximation for t-distribution
    return Math.min(1, Math.max(0, 2 * (1 - this.normalCDF(Math.abs(tStat)))));
  }

  private static normalCDF(x: number): number {
    // Approximation of standard normal CDF
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.sqrt(2);

    const t = 1 / (1 + p * absX);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

    return 0.5 * (1 + sign * y);
  }
}

export default CorrelationCalculator;
