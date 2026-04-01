export interface ReturnPoint {
  timestamp: Date;
  return: number;  // Percentage return (e.g., 0.05 for 5%)
}

export class ReturnCalculator {
  /**
   * Calculate returns from a price series
   * r_t = (P_t - P_{t-1}) / P_{t-1}
   */
  static calculateReturns(prices: number[]): number[] {
    if (prices.length < 2) {
      return [];
    }

    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const r = (prices[i] - prices[i - 1]) / prices[i - 1];
      returns.push(r);
    }

    return returns;
  }

  /**
   * Calculate returns with timestamps from price data
   */
  static calculateReturnsWithTime(
    priceData: { price: number; timestamp: Date }[]
  ): ReturnPoint[] {
    if (priceData.length < 2) {
      return [];
    }

    const returns: ReturnPoint[] = [];
    for (let i = 1; i < priceData.length; i++) {
      const r = (priceData[i].price - priceData[i - 1].price) / priceData[i - 1].price;
      returns.push({
        timestamp: priceData[i].timestamp,
        return: r,
      });
    }

    return returns;
  }

  /**
   * Get sliding window of returns
   * Default: 60 data points = 30 minutes @ 30s interval
   */
  static getSlidingWindow(
    returns: number[],
    windowSize: number = 60
  ): number[] {
    if (returns.length <= windowSize) {
      return [...returns];
    }
    return returns.slice(-windowSize);
  }

  /**
   * Calculate average return
   */
  static averageReturn(returns: number[]): number {
    if (returns.length === 0) return 0;
    return returns.reduce((sum, r) => sum + r, 0) / returns.length;
  }

  /**
   * Calculate return volatility (standard deviation)
   */
  static volatility(returns: number[]): number {
    if (returns.length < 2) return 0;

    const avg = this.averageReturn(returns);
    const squaredDiffs = returns.map(r => Math.pow(r - avg, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / (returns.length - 1);

    return Math.sqrt(variance);
  }

  /**
   * Check if price movement meets threshold
   */
  static meetsMovementThreshold(
    returns: number[],
    threshold: number,
    direction: 'up' | 'down' | 'any' = 'any'
  ): boolean {
    const totalReturn = returns.reduce((sum, r) => sum + r, 0);

    switch (direction) {
      case 'up':
        return totalReturn >= threshold;
      case 'down':
        return totalReturn <= -threshold;
      case 'any':
      default:
        return Math.abs(totalReturn) >= threshold;
    }
  }
}

export default ReturnCalculator;
