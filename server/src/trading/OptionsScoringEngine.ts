/**
 * Options Scoring Engine
 * 规则化期权筛选引擎
 *
 * 筛选流程：
 * 1. 行权价过滤 - 只保留 ATM 或轻度 OTM 的 CALL 合约
 * 2. 三维打分 - 流动性、敏感度、溢价效率
 * 3. 锁定最高分合约
 */

import config from '../config';

export interface OptionContract {
  symbol: string;              // 正股代码
  contractSymbol: string;      // 期权合约代码 (如: AAPL240417C00180000)
  strike: number;              // 行权价
  expiration: Date;            // 到期日
  optionType: 'CALL' | 'PUT';  // 期权类型

  // 价格数据
  bid: number;                 // 买一价
  ask: number;                 // 卖一价
  lastPrice: number;           // 最新成交价

  // 希腊字母
  delta: number;               // Delta
  gamma: number;               // Gamma
  theta: number;               // Theta
  vega: number;                // Vega
  impliedVolatility: number;   // 隐含波动率

  // 流动性指标
  volume: number;              // 成交量
  openInterest: number;        // 持仓量

  // 正股价格
  underlyingPrice?: number;     // 正股当前价格 (可选，由调用者传入)
}

export interface ContractScore {
  contract: OptionContract;
  liquidityScore: number;      // 流动性分数 (0-100)
  responsivenessScore: number; // 敏感度分数 (0-100)
  efficiencyScore: number;     // 溢价效率分数 (0-100)
  totalScore: number;          // 总分 (0-100)
}

export class OptionsScoringEngine {
  // 配置参数 - 从 config 读取或使用默认值
  private get STRIKE_DISTANCE_PCT(): number {
    // 行权价距离阈值：只选择距离正股价 X% 以内的行权价
    return config.trading.optionsStrikeDistancePct ?? 0.05; // 默认 5%
  }

  private get MIN_OPEN_INTEREST(): number {
    // 最小持仓量
    return config.trading.optionsMinOpenInterest ?? 100;
  }

  private get MAX_SPREAD_PCT(): number {
    // 最大 Bid/Ask Spread 百分比
    return config.trading.optionsMaxSpreadPct ?? 0.10; // 默认 10%
  }

  private get MIN_DELTA(): number {
    // 最小 Delta (敏感度要求)
    return config.trading.optionsMinDelta ?? 0.30;
  }

  private get MAX_PREMIUM_PCT(): number {
    // 最大权利金占正股价百分比
    return config.trading.optionsMaxPremiumPct ?? 0.05; // 默认 5%
  }

  /**
   * 筛选并评分期权合约
   * @param contracts 期权合约列表
   * @param underlyingPrice 正股当前价格
   * @returns 评分后的合约列表（按分数降序）
   */
  scoreContracts(
    contracts: OptionContract[],
    underlyingPrice: number
  ): ContractScore[] {
    // 第一阶段：行权价过滤
    const filteredContracts = this.filterByStrike(contracts, underlyingPrice);

    // 第二阶段：三维打分
    const scoredContracts = filteredContracts.map(contract =>
      this.scoreContract(contract, underlyingPrice)
    );

    // 第三阶段：按总分排序
    return scoredContracts.sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * 选择最佳合约
   * @param contracts 期权合约列表
   * @param underlyingPrice 正股当前价格
   * @returns 最佳合约，如果没有合格的返回 null
   */
  selectBestContract(
    contracts: OptionContract[],
    underlyingPrice: number
  ): OptionContract | null {
    const scored = this.scoreContracts(contracts, underlyingPrice);

    if (scored.length === 0) {
      console.log('[OptionsEngine] No qualified contracts found');
      return null;
    }

    const best = scored[0];
    console.log(`[OptionsEngine] Best contract: ${best.contract.contractSymbol}`);
    console.log(`   Score: ${best.totalScore.toFixed(1)} (L:${best.liquidityScore.toFixed(0)} R:${best.responsivenessScore.toFixed(0)} E:${best.efficiencyScore.toFixed(0)})`);
    console.log(`   Strike: $${best.contract.strike}, Ask: $${best.contract.ask.toFixed(2)}, Delta: ${best.contract.delta.toFixed(2)}`);

    return best.contract;
  }

  /**
   * 行权价过滤
   * 只保留 ATM 或轻度 OTM 的 CALL 合约
   */
  private filterByStrike(
    contracts: OptionContract[],
    underlyingPrice: number
  ): OptionContract[] {
    return contracts.filter(contract => {
      // 只选择 CALL
      if (contract.optionType !== 'CALL') {
        return false;
      }

      // 计算行权价距离
      const strikeDistancePct = Math.abs(contract.strike - underlyingPrice) / underlyingPrice;

      // 只保留距离在阈值内的
      if (strikeDistancePct > this.STRIKE_DISTANCE_PCT) {
        return false;
      }

      // 剔除深度 ITM (行权价远低于正股价)
      if (contract.strike < underlyingPrice * 0.90) {
        return false;
      }

      // 剔除深度 OTM (行权价远高于正股价)
      if (contract.strike > underlyingPrice * 1.10) {
        return false;
      }

      return true;
    });
  }

  /**
   * 三维打分
   */
  private scoreContract(
    contract: OptionContract,
    underlyingPrice: number
  ): ContractScore {
    const liquidityScore = this.calculateLiquidityScore(contract);
    const responsivenessScore = this.calculateResponsivenessScore(contract);
    const efficiencyScore = this.calculateEfficiencyScore(contract, underlyingPrice);

    // 总分 = 加权平均
    const totalScore =
      liquidityScore * 0.40 +      // 流动性权重 40%
      responsivenessScore * 0.35 + // 敏感度权重 35%
      efficiencyScore * 0.25;      // 效率权重 25%

    return {
      contract,
      liquidityScore,
      responsivenessScore,
      efficiencyScore,
      totalScore,
    };
  }

  /**
   * 流动性评分 (0-100)
   * 要求极窄的 Bid/Ask Spread 和足够的 Open Interest/Volume
   */
  private calculateLiquidityScore(contract: OptionContract): number {
    let score = 100;

    // 1. Bid/Ask Spread 评分
    if (contract.ask > 0 && contract.bid >= 0) {
      const spread = contract.ask - contract.bid;
      const spreadPct = spread / contract.ask;

      if (spreadPct > this.MAX_SPREAD_PCT) {
        // Spread 过大，严重扣分
        score -= 50;
      } else {
        // Spread 越小分数越高
        score -= spreadPct / this.MAX_SPREAD_PCT * 30;
      }
    } else {
      // 没有 bid/ask 数据，扣分
      score -= 40;
    }

    // 2. Open Interest 评分
    if (contract.openInterest < this.MIN_OPEN_INTEREST) {
      score -= 30;
    } else {
      // OI 越高越好
      score += Math.min(contract.openInterest / 1000, 10);
    }

    // 3. Volume 评分
    if (contract.volume < 10) {
      score -= 20;
    } else {
      score += Math.min(contract.volume / 100, 10);
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 敏感度评分 (0-100)
   * 评估 Delta 和 Gamma，确认期权能跟上正股波动
   */
  private calculateResponsivenessScore(contract: OptionContract): number {
    let score = 100;

    // 1. Delta 评分
    const delta = Math.abs(contract.delta);

    if (delta < this.MIN_DELTA) {
      // Delta 过低，对正股变动不敏感
      score -= 40;
    } else {
      // Delta 在合理范围内加分
      score += (delta - this.MIN_DELTA) * 50;
    }

    // 2. Gamma 评分
    if (contract.gamma < 0.01) {
      score -= 20;
    } else if (contract.gamma > 0.05) {
      // Gamma 很高，对变动非常敏感
      score += 15;
    }

    // 3. 隐含波动率评分
    // IV 适中最好，太高说明权利金昂贵
    if (contract.impliedVolatility > 0.80) {
      score -= 25;
    } else if (contract.impliedVolatility < 0.20) {
      score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 溢价效率评分 (0-100)
   * 计算投入产出比，确保权利金没有贵到无法实现 +200% 目标
   */
  private calculateEfficiencyScore(
    contract: OptionContract,
    underlyingPrice: number
  ): number {
    let score = 100;

    // 1. 权利金占正股价比例
    const premiumPct = contract.ask / underlyingPrice;

    if (premiumPct > this.MAX_PREMIUM_PCT) {
      // 权利金太贵
      score -= 50;
    } else {
      // 权利金越便宜分数越高
      score += (this.MAX_PREMIUM_PCT - premiumPct) / this.MAX_PREMIUM_PCT * 30;
    }

    // 2. 杠杆率评估
    // 权利金收益率目标: +200%
    // 需要正股上涨多少才能达到？
    const targetGainPct = config.trading.takeProfitPct / 100; // 例如 200% = 2.0

    // 简化计算：Delta * 正股涨幅 = 期权涨幅
    // 需要 正股涨幅 = targetGainPct / delta
    const requiredStockMove = targetGainPct / Math.abs(contract.delta);

    if (requiredStockMove > 0.20) {
      // 需要正股涨超 20% 才能达到目标，不太现实
      score -= 30;
    } else if (requiredStockMove > 0.10) {
      score -= 15;
    }

    // 3. 时间价值损耗 (Theta)
    if (contract.theta < -0.10) {
      // 每天损耗超过 10%，太快
      score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  }
}

export default OptionsScoringEngine;