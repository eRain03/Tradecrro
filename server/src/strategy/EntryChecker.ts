import { PairScore } from '../core/scoring/ScoringEngine';
import config from '../config';

export interface EntryCheckResult {
  canEnter: boolean;
  strategyType: 'positive_lag' | 'negative_corr' | null;
  reason?: string;
  leaderMove?: number;
  laggerMove?: number;
  expectedMove?: number;
}

/**
 * Entry Checker
 * Validates entry conditions for trading strategies
 *
 * Rules:
 * - Positive Lag: leader ≥5%, lagger <2%, expected move ≥ threshold
 * - Negative Correlation: strong negative correlation + high volume + expected move ≥ threshold
 */
export class EntryChecker {
  private readonly LEADER_MOVE_THRESHOLD = 0.05; // 5%
  private readonly LAGGER_MOVE_THRESHOLD = 0.02; // 2%
  private readonly HIGH_VOLUME_RATIO = 1.5; // 150% of average

  // Expected move threshold from config (percentage, e.g. 0.5 = 0.5%)
  private get EXPECTED_MOVE_THRESHOLD(): number {
    return config.trading.expectedMoveThreshold / 100;
  }

  /**
   * Check entry conditions for a trading signal
   */
  checkEntry(
    score: PairScore,
    leaderReturns: number[],
    laggerReturns: number[],
    expectedMove: number
  ): EntryCheckResult {
    if (!score.meetsThreshold) {
      return {
        canEnter: false,
        strategyType: null,
        reason: 'Score below threshold',
      };
    }

    // Check positive lag strategy
    if (score.isPositiveLag && score.leader && score.lagger) {
      return this.checkPositiveLagEntry(score, leaderReturns, laggerReturns, expectedMove);
    }

    // Check negative correlation strategy
    if (score.isNegativeCorr) {
      return this.checkNegativeCorrelationEntry(score, expectedMove);
    }

    return {
      canEnter: false,
      strategyType: null,
      reason: 'No valid strategy identified',
    };
  }

  /**
   * Check positive lag (lead-lag) entry conditions
   * Rules:
   * 1. Leader stock has moved ≥5%
   * 2. Lagger stock has moved <2%
   * 3. Expected volatility ≥5%
   */
  private checkPositiveLagEntry(
    score: PairScore,
    leaderReturns: number[],
    laggerReturns: number[],
    expectedMove: number
  ): EntryCheckResult {
    // Calculate total moves
    const leaderMove = leaderReturns.reduce((sum, r) => sum + r, 0);
    const laggerMove = laggerReturns.reduce((sum, r) => sum + r, 0);

    // Check leader move ≥5%
    if (leaderMove < this.LEADER_MOVE_THRESHOLD) {
      return {
        canEnter: false,
        strategyType: null,
        reason: `Leader move (${(leaderMove * 100).toFixed(2)}%) below threshold (${this.LEADER_MOVE_THRESHOLD * 100}%)`,
        leaderMove,
        laggerMove,
        expectedMove,
      };
    }

    // Check lagger move <2%
    if (laggerMove >= this.LAGGER_MOVE_THRESHOLD) {
      return {
        canEnter: false,
        strategyType: null,
        reason: `Lagger already moved (${(laggerMove * 100).toFixed(2)}%), needs to be below ${this.LAGGER_MOVE_THRESHOLD * 100}%`,
        leaderMove,
        laggerMove,
        expectedMove,
      };
    }

    // Check expected move ≥5%
    if (expectedMove < this.EXPECTED_MOVE_THRESHOLD) {
      return {
        canEnter: false,
        strategyType: null,
        reason: `Expected move (${(expectedMove * 100).toFixed(2)}%) below threshold (${this.EXPECTED_MOVE_THRESHOLD * 100}%)`,
        leaderMove,
        laggerMove,
        expectedMove,
      };
    }

    // All conditions met
    return {
      canEnter: true,
      strategyType: 'positive_lag',
      reason: 'All entry conditions met',
      leaderMove,
      laggerMove,
      expectedMove,
    };
  }

  /**
   * Check negative correlation entry conditions
   * Rules:
   * 1. Strong negative correlation (already filtered by score ≥87)
   * 2. High volume confirmation
   * 3. Expected volatility ≥5%
   */
  private checkNegativeCorrelationEntry(
    score: PairScore,
    expectedMove: number
  ): EntryCheckResult {
    // Check volume confirmation (at least one stock has elevated volume)
    const volumeConfirmed = score.volumeRatioA >= this.HIGH_VOLUME_RATIO ||
                            score.volumeRatioB >= this.HIGH_VOLUME_RATIO;

    if (!volumeConfirmed) {
      return {
        canEnter: false,
        strategyType: null,
        reason: `Volume not confirmed (A: ${(score.volumeRatioA * 100).toFixed(0)}%, B: ${(score.volumeRatioB * 100).toFixed(0)}%, need ≥${this.HIGH_VOLUME_RATIO * 100}%)`,
      };
    }

    // Check expected move ≥5%
    if (expectedMove < this.EXPECTED_MOVE_THRESHOLD) {
      return {
        canEnter: false,
        strategyType: null,
        reason: `Expected move (${(expectedMove * 100).toFixed(2)}%) below threshold (${this.EXPECTED_MOVE_THRESHOLD * 100}%)`,
      };
    }

    // All conditions met
    return {
      canEnter: true,
      strategyType: 'negative_corr',
      reason: 'All entry conditions met (negative correlation + volume + volatility)',
      expectedMove,
    };
  }

  /**
   * Calculate expected move based on historical volatility
   */
  calculateExpectedMove(returns: number[]): number {
    if (returns.length < 2) return 0;

    // Use standard deviation as proxy for expected move
    const avg = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);

    // Expected move = 2 * stdDev (covers ~95% of moves)
    return stdDev * 2;
  }
}

export default EntryChecker;
