export interface VolumeData {
  symbol: string;
  currentVolume: number;
  averageVolume: number;
  timestamp: Date;
}

export class VolumeAnalyzer {
  private volumeHistory: Map<string, number[]> = new Map();
  private readonly historyLength: number = 20; // Keep 20 periods for average

  /**
   * Update volume data and calculate ratio
   */
  updateVolume(symbol: string, volume: number): VolumeData {
    // Get or initialize history
    let history = this.volumeHistory.get(symbol);
    if (!history) {
      history = [];
      this.volumeHistory.set(symbol, history);
    }

    // Add new volume
    history.push(volume);

    // Keep only last N periods
    while (history.length > this.historyLength) {
      history.shift();
    }

    // Calculate average
    const averageVolume = history.length > 0
      ? history.reduce((sum, v) => sum + v, 0) / history.length
      : volume;

    return {
      symbol,
      currentVolume: volume,
      averageVolume,
      timestamp: new Date(),
    };
  }

  /**
   * Calculate volume ratio
   * Ratio = Current Volume / Average Volume
   */
  static calculateRatio(currentVolume: number, averageVolume: number): number {
    if (averageVolume === 0) return 1;
    return currentVolume / averageVolume;
  }

  /**
   * Calculate volume score (0-10)
   * LINEAR scaling as per system design:
   * Ratio 1.0 (normal) = 0 points
   * Ratio 2.0 = 5 points
   * Ratio 3.0+ = 10 points (max)
   * Formula: score = min(max((ratio - 1) * 5, 0), 10)
   */
  static calculateScore(ratio: number): number {
    // Linear scaling: (ratio - 1) * 5
    // ratio=1.0 -> 0, ratio=2.0 -> 5, ratio=3.0 -> 10
    const score = (ratio - 1) * 5;
    return Math.min(Math.max(score, 0), 10);
  }

  /**
   * Check if volume is elevated
   */
  static isElevated(ratio: number, threshold: number = 1.2): boolean {
    return ratio >= threshold;
  }

  /**
   * Get volume history for a symbol
   */
  getHistory(symbol: string): number[] {
    return [...(this.volumeHistory.get(symbol) || [])];
  }

  /**
   * Clear history for a symbol
   */
  clearHistory(symbol: string): void {
    this.volumeHistory.delete(symbol);
  }

  /**
   * Clear all history
   */
  clearAll(): void {
    this.volumeHistory.clear();
  }
}

export default VolumeAnalyzer;
