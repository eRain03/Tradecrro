import SyncCorrelation from '../correlation/SyncCorrelation';
import LagCorrelation from '../correlation/LagCorrelation';
import VolumeAnalyzer from '../data/VolumeAnalyzer';
import config from '../../config';

export interface PairScore {
  stockA: string;
  stockB: string;
  // Correlation scores
  syncCorrelation: number;
  lagCorrelation: number;
  correlationScore: number; // Max 60
  // Volume scores
  volumeRatioA: number;
  volumeRatioB: number;
  volumeScoreA: number; // Max 20
  volumeScoreB: number; // Max 20
  volumeScore: number; // Max 40
  // Total
  totalScore: number; // Max 100
  // Analysis
  isNegativeCorr: boolean;
  isPositiveLag: boolean;
  leader?: string;
  lagger?: string;
  // Threshold check
  meetsThreshold: boolean;
}

export class ScoringEngine {
  private readonly CORRELATION_MAX = 80;
  private readonly VOLUME_MAX = 20;
  // Trading threshold from config (default 87)
  private readonly THRESHOLD = config.trading.scoreThreshold;

  /**
   * Calculate complete pair score
   */
  calculatePairScore(
    stockA: string,
    stockB: string,
    returnsA: number[],
    returnsB: number[],
    currentVolumeA: number,
    avgVolumeA: number,
    currentVolumeB: number,
    avgVolumeB: number,
    maxLag: number = 10 // Default lag intervals
  ): PairScore {
    console.log(`[ScoringEngine] THRESHOLD=${this.THRESHOLD}`);
    // Debug: log returns data
    console.log(`[ScoringEngine] ${stockA}/${stockB}: returnsA.length=${returnsA.length}, returnsB.length=${returnsB.length}, maxLag=${maxLag}`);
    if (returnsA.length > 0) {
      console.log(`[ScoringEngine] ${stockA}: returnsA sample=[${returnsA.slice(0, 5).map(r => r.toFixed(6)).join(', ')}]`);
    }

    // Check for NaN or Infinity in returns
    const hasNaN = returnsA.some(r => !Number.isFinite(r)) || returnsB.some(r => !Number.isFinite(r));
    if (hasNaN) {
      console.error(`[ScoringEngine] ${stockA}/${stockB}: NaN or Infinity detected in returns!`);
    }

    // Calculate correlations with custom max lag
    const syncResult = SyncCorrelation.calculate(returnsA, returnsB);
    const lagResult = LagCorrelation.calculate(returnsA, returnsB, maxLag);

    console.log(`[ScoringEngine] ${stockA}/${stockB}: syncResult.correlation=${syncResult.correlation}, syncScore=${SyncCorrelation.calculateScore(syncResult.correlation)}`);

    // Determine which correlation to use:
    // - Sync correlation only counts when it is NEGATIVE (inverse strategy)
    // - Lag correlation only counts when it is POSITIVE (lead-lag strategy)
    const syncScore = SyncCorrelation.calculateScore(syncResult.correlation);
    // Use discounted correlation for lag score to penalize higher lags
    const lagScore = lagResult ? LagCorrelation.calculateScore(lagResult.discountedCorrelation) : 0;
    const negativeSyncScore = syncResult.isNegative ? syncScore : 0;
    const positiveLagScore = lagResult?.isPositive ? lagScore : 0;

    // Use the stronger correlation
    const useSync = negativeSyncScore >= positiveLagScore;
    const correlationScore = Math.max(negativeSyncScore, positiveLagScore);

    // Calculate volume scores
    const volumeRatioA = VolumeAnalyzer.calculateRatio(currentVolumeA, avgVolumeA);
    const volumeRatioB = VolumeAnalyzer.calculateRatio(currentVolumeB, avgVolumeB);
    const volumeScoreA = VolumeAnalyzer.calculateScore(volumeRatioA);
    const volumeScoreB = VolumeAnalyzer.calculateScore(volumeRatioB);
    const volumeScore = volumeScoreA + volumeScoreB;

    // Calculate total
    const totalScore = correlationScore + volumeScore;

    console.log(`[ScoringEngine] ${stockA}/${stockB}: correlationScore=${correlationScore.toFixed(2)}, volumeScore=${volumeScore.toFixed(2)}, totalScore=${totalScore.toFixed(2)}, THRESHOLD=${this.THRESHOLD}, meetsThreshold=${totalScore >= this.THRESHOLD}`);

    return {
      stockA,
      stockB,
      syncCorrelation: syncResult.correlation,
      lagCorrelation: lagResult?.correlation || 0,
      correlationScore,
      volumeRatioA,
      volumeRatioB,
      volumeScoreA,
      volumeScoreB,
      volumeScore,
      totalScore,
      isNegativeCorr: useSync && syncResult.isNegative,
      isPositiveLag: !useSync && (lagResult?.isPositive || false),
      leader: lagResult?.leader === 'A' ? stockA : lagResult?.leader === 'B' ? stockB : undefined,
      lagger: lagResult?.lagger === 'A' ? stockA : lagResult?.lagger === 'B' ? stockB : undefined,
      meetsThreshold: totalScore >= this.THRESHOLD,
    };
  }

  /**
   * Check if score meets threshold
   */
  meetsThreshold(score: PairScore): boolean {
    return score.totalScore >= this.THRESHOLD;
  }

  /**
   * Determine strategy type based on correlation
   */
  determineStrategy(score: PairScore): 'positive_lag' | 'negative_corr' | null {
    if (!score.meetsThreshold) {
      return null;
    }

    if (score.isNegativeCorr) {
      return 'negative_corr';
    }

    if (score.isPositiveLag && score.leader && score.lagger) {
      return 'positive_lag';
    }

    return null;
  }

  /**
   * Get score breakdown for display
   */
  getScoreBreakdown(score: PairScore): {
    correlation: { score: number; max: number; pct: number };
    volume: { score: number; max: number; pct: number };
    total: { score: number; max: number; pct: number };
    threshold: { score: number; met: boolean };
  } {
    return {
      correlation: {
        score: score.correlationScore,
        max: this.CORRELATION_MAX,
        pct: (score.correlationScore / this.CORRELATION_MAX) * 100,
      },
      volume: {
        score: score.volumeScore,
        max: this.VOLUME_MAX,
        pct: (score.volumeScore / this.VOLUME_MAX) * 100,
      },
      total: {
        score: score.totalScore,
        max: this.CORRELATION_MAX + this.VOLUME_MAX,
        pct: (score.totalScore / (this.CORRELATION_MAX + this.VOLUME_MAX)) * 100,
      },
      threshold: {
        score: this.THRESHOLD,
        met: score.meetsThreshold,
      },
    };
  }
}

export default ScoringEngine;
