import { OptionContract } from '../ig/OptionChainFetcher';

export interface OptionScore {
  contract: OptionContract;
  liquidityScore: number;
  responsivenessScore: number;
  efficiencyScore: number;
  totalScore: number;
  rank: number;
}

export interface SelectionCriteria {
  minVolume?: number;
  maxSpread?: number;
  minDelta?: number;
  preferredMoneyness?: 'ATM' | 'ITM' | 'OTM';
}

/**
 * Option Selection Algorithm
 * Scores options based on: Liquidity + Responsiveness + Premium Efficiency
 */
export class OptionSelector {
  /**
   * Score a single option
   */
  static scoreOption(
    contract: OptionContract,
    stockPrice: number,
    criteria?: SelectionCriteria
  ): OptionScore {
    // 1. Liquidity Score (0-10)
    const liquidityScore = this.calculateLiquidityScore(contract, criteria);

    // 2. Responsiveness Score (0-10)
    const responsivenessScore = this.calculateResponsivenessScore(contract);

    // 3. Efficiency Score (0-10)
    const efficiencyScore = this.calculateEfficiencyScore(contract, stockPrice, criteria);

    return {
      contract,
      liquidityScore,
      responsivenessScore,
      efficiencyScore,
      totalScore: liquidityScore + responsivenessScore + efficiencyScore,
      rank: 0,
    };
  }

  /**
   * Select best option from a list
   */
  static selectBest(
    contracts: OptionContract[],
    stockPrice: number,
    criteria?: SelectionCriteria,
    topN: number = 1
  ): OptionScore[] {
    // Score all contracts
    const scored = contracts.map(c => this.scoreOption(c, stockPrice, criteria));

    // Filter out invalid options
    const valid = scored.filter(s => this.isValid(s, criteria));

    // Sort by total score
    valid.sort((a, b) => b.totalScore - a.totalScore);

    // Assign ranks
    valid.forEach((s, i) => s.rank = i + 1);

    // Return top N
    return valid.slice(0, topN);
  }

  /**
   * Select ATM or slightly OTM call
   */
  static selectATMCall(
    calls: OptionContract[],
    stockPrice: number
  ): OptionScore | null {
    // Filter for near-the-money options
    const nearATM = calls.filter(c => {
      const moneyness = c.strike / stockPrice;
      return moneyness >= 0.95 && moneyness <= 1.05;
    });

    if (nearATM.length === 0) {
      // Fallback to closest to ATM
      calls.sort((a, b) =>
        Math.abs(a.strike - stockPrice) - Math.abs(b.strike - stockPrice)
      );
      return this.scoreOption(calls[0], stockPrice);
    }

    return this.selectBest(nearATM, stockPrice, undefined, 1)[0] || null;
  }

  /**
   * Calculate liquidity score
   * Based on: spread tightness + volume
   */
  private static calculateLiquidityScore(
    contract: OptionContract,
    criteria?: SelectionCriteria
  ): number {
    const spread = contract.ask - contract.bid;
    const midPrice = (contract.ask + contract.bid) / 2;
    const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    // Spread score (tighter = higher)
    let spreadScore = Math.max(0, 5 - spreadPct * 2);

    // Volume score
    const volumeScore = Math.min(contract.volume / 20, 5);

    return spreadScore + volumeScore;
  }

  /**
   * Calculate responsiveness score
   * Based on: Delta (price sensitivity to underlying)
   * ATM options have delta ~0.5, ITM higher, OTM lower
   */
  private static calculateResponsivenessScore(contract: OptionContract): number {
    if (contract.delta) {
      // Use provided delta
      return Math.abs(contract.delta) * 10;
    }

    // Estimate based on moneyness (simplified)
    // ATM options are most responsive
    return 5; // Default mid-score
  }

  /**
   * Calculate efficiency score
   * Based on: premium cost vs expected move
   */
  private static calculateEfficiencyScore(
    contract: OptionContract,
    stockPrice: number,
    criteria?: SelectionCriteria
  ): number {
    const moneyness = contract.strike / stockPrice;

    // Preferred: ATM or slightly OTM
    if (criteria?.preferredMoneyness === 'ATM') {
      if (moneyness >= 0.98 && moneyness <= 1.02) return 10;
      if (moneyness >= 0.95 && moneyness <= 1.05) return 8;
    } else if (criteria?.preferredMoneyness === 'OTM') {
      if (moneyness >= 1.0 && moneyness <= 1.05) return 10;
      if (moneyness >= 0.95 && moneyness < 1.0) return 7;
    }

    // Default: prefer ATM
    if (moneyness >= 0.95 && moneyness <= 1.05) {
      return 10;
    } else if (moneyness >= 0.90 && moneyness <= 1.10) {
      return 7;
    } else {
      return 4;
    }
  }

  /**
   * Check if option meets validity criteria
   */
  private static isValid(score: OptionScore, criteria?: SelectionCriteria): boolean {
    if (criteria?.minVolume && score.contract.volume < criteria.minVolume) {
      return false;
    }

    if (criteria?.maxSpread) {
      const spread = score.contract.ask - score.contract.bid;
      const midPrice = (score.contract.ask + score.contract.bid) / 2;
      const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;
      if (spreadPct > criteria.maxSpread) {
        return false;
      }
    }

    // Must have valid prices
    if (score.contract.ask <= 0 || score.contract.bid <= 0) {
      return false;
    }

    return true;
  }
}

export default OptionSelector;
