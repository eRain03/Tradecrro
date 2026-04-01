import config from '../config';

export interface ExitCondition {
  type: 'take_profit' | 'stop_loss' | 'trailing_stop' | 'time';
  threshold?: number;
  timeLimit?: number; // in minutes
}

export interface ExitResult {
  shouldExit: boolean;
  reason?: 'take_profit' | 'stop_loss' | 'manual';
  exitPrice?: number;
  pnlPct?: number;
}

/**
 * Exit Manager
 * Manages exit conditions and triggers
 */
export class ExitManager {
  private takeProfitPct: number;
  private stopLossPct: number;

  constructor() {
    this.takeProfitPct = config.trading.takeProfitPct;
    this.stopLossPct = config.trading.stopLossPct;
  }

  /**
   * Check if position should be exited
   * For positive lag strategy (single leg)
   */
  checkPositiveLagExit(
    entryPrice: number,
    currentBidPrice: number
  ): ExitResult {
    const pnlPct = ((currentBidPrice - entryPrice) / entryPrice) * 100;

    // Take profit: +200%
    if (pnlPct >= this.takeProfitPct) {
      return {
        shouldExit: true,
        reason: 'take_profit',
        exitPrice: currentBidPrice,
        pnlPct,
      };
    }

    // Stop loss: -50%
    if (pnlPct <= -this.stopLossPct) {
      return {
        shouldExit: true,
        reason: 'stop_loss',
        exitPrice: currentBidPrice,
        pnlPct,
      };
    }

    return { shouldExit: false };
  }

  /**
   * Check if position should be exited
   * For negative correlation strategy (dual leg)
   * No stop loss, exit when either leg hits +200%
   */
  checkNegativeCorrelationExit(
    legA: { entryPrice: number; currentBidPrice: number },
    legB: { entryPrice: number; currentBidPrice: number }
  ): { shouldExit: boolean; exitBoth: boolean; reason?: string } {
    const pnlPctA = ((legA.currentBidPrice - legA.entryPrice) / legA.entryPrice) * 100;
    const pnlPctB = ((legB.currentBidPrice - legB.entryPrice) / legB.entryPrice) * 100;

    // If either leg hits +200%, exit both
    if (pnlPctA >= this.takeProfitPct || pnlPctB >= this.takeProfitPct) {
      return {
        shouldExit: true,
        exitBoth: true,
        reason: `Profit target reached (Leg A: ${pnlPctA.toFixed(1)}%, Leg B: ${pnlPctB.toFixed(1)}%)`,
      };
    }

    return { shouldExit: false, exitBoth: false };
  }

  /**
   * Calculate exit price for a position
   */
  calculateExitPnl(
    entryPrice: number,
    exitPrice: number,
    positionSize: number
  ): { pnlAmount: number; pnlPct: number } {
    const pnlAmount = (exitPrice - entryPrice) * positionSize;
    const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

    return { pnlAmount, pnlPct };
  }

  /**
   * Get current exit thresholds
   */
  getThresholds(): {
    takeProfitPct: number;
    stopLossPct: number;
  } {
    return {
      takeProfitPct: this.takeProfitPct,
      stopLossPct: this.stopLossPct,
    };
  }

  /**
   * Update thresholds
   */
  setThresholds(
    takeProfitPct?: number,
    stopLossPct?: number
  ): void {
    if (takeProfitPct !== undefined) {
      this.takeProfitPct = takeProfitPct;
    }
    if (stopLossPct !== undefined) {
      this.stopLossPct = stopLossPct;
    }
  }
}

export default ExitManager;
