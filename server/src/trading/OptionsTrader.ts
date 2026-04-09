/**
 * Options Trader
 * 期权交易执行器
 *
 * 执行流程：
 * 1. 策略路由 - 确定执行单腿还是双腿
 * 2. 获取期权链 - 从 Tiger API 获取 Option Chain
 * 3. 期权筛选 - 使用 OptionsScoringEngine 选择最佳合约
 * 4. 仓位计算 - 基于账户净值 10% 分配资金
 * 5. 下单执行 - 发送 Limit Order
 * 6. 退出监控 - 监控 BID 价，触发止盈/止损
 */

import TigerTradeClient from './TigerTradeClient';
import TigerClient from '../data/TigerClient';
import OptionsScoringEngine, { OptionContract, ContractScore } from './OptionsScoringEngine';
import { TradingSignal } from '../strategy/SignalGenerator';
import { getDatabase } from '../database/connection';
import config from '../config';

export interface OptionsTradeExecution {
  id?: number;
  signalId: number;
  strategyType: 'positive_lag' | 'negative_corr';

  // 腿 A (正股A对应的期权)
  legA?: {
    underlyingSymbol: string;       // 正股代码
    contractSymbol: string;         // 期权合约代码
    action: 'BUY';                  // 总是买入开仓
    quantity: number;               // 手数
    entryAsk: number;               // 建仓时的 ASK 价
    currentBid?: number;            // 当前 BID 价
    status: 'pending' | 'filled' | 'closed';
  };

  // 腿 B (正股B对应的期权)
  legB?: {
    underlyingSymbol: string;
    contractSymbol: string;
    action: 'BUY';
    quantity: number;
    entryAsk: number;
    currentBid?: number;
    status: 'pending' | 'filled' | 'closed';
  };

  // 资金信息
  allocatedCapital: number;        // 分配的总资金
  accountNetValue: number;         // 账户净值

  // 交易状态
  status: 'pending' | 'partial' | 'filled' | 'closed';
  entryTime: Date;
  exitTime?: Date;
  exitReason?: 'take_profit' | 'stop_loss' | 'manual';

  // 盈亏
  pnlPct?: number;
  pnlAmount?: number;
}

export interface OptionsTradeConfig {
  enabled: boolean;
  dryRun: boolean;
  maxCapitalPct: number;           // 最大资金百分比 (默认 10%)
  takeProfitPct: number;           // 止盈百分比 (默认 200%)
  stopLossPct: number;             // 止损百分比 (默认 50%)
}

export class OptionsTrader {
  private tradeClient: TigerTradeClient;
  private quoteClient: TigerClient;
  private scoringEngine: OptionsScoringEngine;
  private config: OptionsTradeConfig;
  private activeTrades: Map<string, OptionsTradeExecution> = new Map();
  private monitors: Map<string, NodeJS.Timeout> = new Map();

  constructor(tradeConfig?: Partial<OptionsTradeConfig>) {
    this.tradeClient = new TigerTradeClient();
    this.quoteClient = new TigerClient();
    this.scoringEngine = new OptionsScoringEngine();

    this.config = {
      enabled: tradeConfig?.enabled ?? false,
      dryRun: tradeConfig?.dryRun ?? true,
      maxCapitalPct: tradeConfig?.maxCapitalPct ?? config.trading.maxPositionPct,
      takeProfitPct: tradeConfig?.takeProfitPct ?? config.trading.takeProfitPct,
      stopLossPct: tradeConfig?.stopLossPct ?? config.trading.stopLossPct,
    };

    this.logConfig();
  }

  private logConfig(): void {
    console.log('');
    console.log('='.repeat(50));
    console.log('📈 Options Trader Configuration');
    console.log('='.repeat(50));
    console.log(`   Enabled: ${this.config.enabled}`);
    console.log(`   Dry Run: ${this.config.dryRun}`);
    console.log(`   Max Capital: ${this.config.maxCapitalPct}% of Net Value`);
    console.log(`   Take Profit: +${this.config.takeProfitPct}%`);
    console.log(`   Stop Loss: -${this.config.stopLossPct}%`);
    console.log('='.repeat(50));
    console.log('');
  }

  /**
   * Enable options trading
   */
  enable(): void {
    this.config.enabled = true;
    console.log('✅ Options trading ENABLED');
  }

  /**
   * Disable options trading
   */
  disable(): void {
    this.config.enabled = false;
    console.log('🛑 Options trading DISABLED');
  }

  /**
   * Process a trading signal
   */
  async processSignal(signal: TradingSignal): Promise<OptionsTradeExecution | null> {
    // 检查是否启用
    if (!this.config.enabled) {
      return null;
    }

    // 只处理已触发且确认入场的信号
    if (!signal.triggered || !signal.entryConfirmed) {
      return null;
    }

    console.log('');
    console.log('🚀 [OptionsTrader] Processing signal #' + signal.id);
    console.log(`   Pair: ${signal.stockA}/${signal.stockB}`);
    console.log(`   Strategy: ${signal.strategyType}`);

    try {
      // 第一阶段：策略路由
      if (signal.strategyType === 'positive_lag' && signal.score.lagger) {
        // 路由 A：单腿执行 - 仅锁定 Lagger
        return await this.executeSingleLegTrade(signal);
      } else if (signal.strategyType === 'negative_corr') {
        // 路由 B：双腿执行 - 同时锁定 A 和 B
        return await this.executeDoubleLegTrade(signal);
      } else {
        console.log('⚠️ [OptionsTrader] Unknown strategy type, skipping');
        return null;
      }
    } catch (error: any) {
      console.error(`❌ [OptionsTrader] Failed to process signal: ${error.message}`);
      return null;
    }
  }

  /**
   * 路由 A：单腿执行 (Positive Lag Strategy)
   */
  private async executeSingleLegTrade(signal: TradingSignal): Promise<OptionsTradeExecution | null> {
    const laggerSymbol = signal.score.lagger!;
    const leaderSymbol = signal.score.leader!;

    console.log(`📊 [Route A] Single Leg: Lagger = ${laggerSymbol}`);

    // 获取账户净值
    const accountInfo = await this.tradeClient.getAccountInfo();
    const netValue = accountInfo.netLiquidation || accountInfo.cash || 10000;

    // 计算可用资金 (账户净值的 10%)
    const availableCapital = netValue * (this.config.maxCapitalPct / 100);

    // 获取期权链并选择最佳合约
    const bestContract = await this.selectBestOptionContract(laggerSymbol);

    if (!bestContract) {
      console.log(`❌ [OptionsTrader] No suitable option contract for ${laggerSymbol}`);
      return null;
    }

    // 计算手数
    const quantity = this.calculateQuantity(bestContract.ask, availableCapital);

    if (quantity <= 0) {
      console.log(`❌ [OptionsTrader] Invalid quantity for ${laggerSymbol}`);
      return null;
    }

    // 创建交易记录
    const trade: OptionsTradeExecution = {
      signalId: signal.id!,
      strategyType: 'positive_lag',
      legA: {
        underlyingSymbol: laggerSymbol,
        contractSymbol: bestContract.contractSymbol,
        action: 'BUY',
        quantity,
        entryAsk: bestContract.ask,
        status: 'pending',
      },
      allocatedCapital: availableCapital,
      accountNetValue: netValue,
      status: 'pending',
      entryTime: new Date(),
    };

    // 执行交易
    const success = await this.executeOptionsOrder(trade, bestContract, quantity);

    if (!success) {
      return null;
    }

    // 保存并开始监控
    trade.id = this.saveTrade(trade);
    this.activeTrades.set(bestContract.contractSymbol, trade);
    this.startMonitoring(trade);

    return trade;
  }

  /**
   * 路由 B：双腿执行 (Negative Correlation Strategy)
   */
  private async executeDoubleLegTrade(signal: TradingSignal): Promise<OptionsTradeExecution | null> {
    const symbolA = signal.stockA;
    const symbolB = signal.stockB;

    console.log(`📊 [Route B] Double Leg: A = ${symbolA}, B = ${symbolB}`);

    // 获取账户净值
    const accountInfo = await this.tradeClient.getAccountInfo();
    const netValue = accountInfo.netLiquidation || accountInfo.cash || 10000;

    // 计算可用资金 (账户净值的 10%，双腿各 5%)
    const totalCapital = netValue * (this.config.maxCapitalPct / 100);
    const capitalPerLeg = totalCapital / 2;

    // 并发获取两边的最佳合约
    const [contractA, contractB] = await Promise.all([
      this.selectBestOptionContract(symbolA),
      this.selectBestOptionContract(symbolB),
    ]);

    if (!contractA || !contractB) {
      console.log(`❌ [OptionsTrader] Missing option contracts for ${symbolA}/${symbolB}`);
      return null;
    }

    // 计算各腿手数
    const qtyA = this.calculateQuantity(contractA.ask, capitalPerLeg);
    const qtyB = this.calculateQuantity(contractB.ask, capitalPerLeg);

    if (qtyA <= 0 || qtyB <= 0) {
      console.log(`❌ [OptionsTrader] Invalid quantities`);
      return null;
    }

    // 创建交易记录
    const trade: OptionsTradeExecution = {
      signalId: signal.id!,
      strategyType: 'negative_corr',
      legA: {
        underlyingSymbol: symbolA,
        contractSymbol: contractA.contractSymbol,
        action: 'BUY',
        quantity: qtyA,
        entryAsk: contractA.ask,
        status: 'pending',
      },
      legB: {
        underlyingSymbol: symbolB,
        contractSymbol: contractB.contractSymbol,
        action: 'BUY',
        quantity: qtyB,
        entryAsk: contractB.ask,
        status: 'pending',
      },
      allocatedCapital: totalCapital,
      accountNetValue: netValue,
      status: 'pending',
      entryTime: new Date(),
    };

    // 并发执行两腿订单
    const [successA, successB] = await Promise.all([
      this.executeOptionsOrder(trade, contractA, qtyA, 'A'),
      this.executeOptionsOrder(trade, contractB, qtyB, 'B'),
    ]);

    if (!successA && !successB) {
      console.log(`❌ [OptionsTrader] Both legs failed`);
      return null;
    }

    // 更新状态
    trade.status = successA && successB ? 'filled' : 'partial';

    // 保存并开始监控
    trade.id = this.saveTrade(trade);
    const key = `${contractA.contractSymbol}|${contractB.contractSymbol}`;
    this.activeTrades.set(key, trade);
    this.startMonitoring(trade);

    return trade;
  }

  /**
   * 获取最佳期权合约
   */
  private async selectBestOptionContract(symbol: string): Promise<OptionContract | null> {
    try {
      // 获取期权链
      const optionChain = await this.getOptionChain(symbol);

      if (!optionChain || optionChain.length === 0) {
        console.log(`⚠️ [OptionsTrader] No option chain for ${symbol}`);
        return null;
      }

      // 获取正股当前价格
      const quote = await this.quoteClient.getQuote(symbol);
      const underlyingPrice = quote.price;

      // 使用评分引擎选择最佳合约
      return this.scoringEngine.selectBestContract(optionChain, underlyingPrice);
    } catch (error: any) {
      console.error(`[OptionsTrader] Failed to get option chain for ${symbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * 获取期权链
   * TODO: 实现 Tiger API 期权链获取
   */
  private async getOptionChain(symbol: string): Promise<OptionContract[]> {
    // 暂时返回空数组，需要实现 Tiger API 调用
    // Tiger Open API 支持 get_option_chain 或类似接口

    console.log(`[OptionsTrader] Fetching option chain for ${symbol}...`);

    // 这里需要调用 Tiger Python 脚本或 Tiger Open API
    // 返回格式化的 OptionContract 数组

    return [];
  }

  /**
   * 计算手数
   * Quantity = Floor(分配资金 / (ASK * 100))
   */
  private calculateQuantity(askPrice: number, allocatedCapital: number): number {
    if (askPrice <= 0) return 0;

    // 每手期权成本 = ASK * 100 (每手 100 张)
    const costPerContract = askPrice * 100;

    // 向下取整
    return Math.floor(allocatedCapital / costPerContract);
  }

  /**
   * 执行期权订单
   * 使用 Limit Order，价格为 ASK 价
   */
  private async executeOptionsOrder(
    trade: OptionsTradeExecution,
    contract: OptionContract,
    quantity: number,
    legLabel?: string
  ): Promise<boolean> {
    const label = legLabel ? `Leg ${legLabel}` : 'Single Leg';

    if (this.config.dryRun) {
      console.log(`🧪 [DRY RUN] ${label}: BUY ${contract.contractSymbol} x ${quantity} @ $${contract.ask.toFixed(2)}`);
      return true;
    }

    // 真实交易：发送 Limit Order
    try {
      const result = await this.tradeClient.limitBuyOption(
        contract.contractSymbol,
        quantity,
        contract.ask
      );

      if (result.ok) {
        console.log(`✅ [OptionsTrader] ${label}: BUY ${contract.contractSymbol} x ${quantity} @ $${contract.ask.toFixed(2)}`);
        console.log(`   Order ID: ${result.orderId}`);
        return true;
      } else {
        console.error(`❌ [OptionsTrader] ${label}: Order failed - ${result.error}`);
        return false;
      }
    } catch (error: any) {
      console.error(`❌ [OptionsTrader] ${label}: Exception - ${error.message}`);
      return false;
    }
  }

  /**
   * 开始监控
   * 监控 BID 价，触发止盈/止损
   */
  private startMonitoring(trade: OptionsTradeExecution): void {
    const interval = setInterval(async () => {
      try {
        await this.checkExitConditions(trade);
      } catch (error: any) {
        console.error(`[OptionsTrader] Monitor error: ${error.message}`);
      }
    }, 10_000); // 每 10 秒检查一次

    const key = this.getTradeKey(trade);
    this.monitors.set(key, interval);
  }

  /**
   * 检查退出条件
   * 止盈: BID >= ASK * (1 + takeProfitPct/100)
   * 止损: BID <= ASK * (1 - stopLossPct/100)
   */
  private async checkExitConditions(trade: OptionsTradeExecution): Promise<void> {
    if (trade.status === 'closed') {
      return;
    }

    // 获取当前 BID 价
    const currentBids = await this.getCurrentBids(trade);

    // 检查各腿的退出条件
    let shouldExit = false;
    let exitReason: 'take_profit' | 'stop_loss' = 'take_profit';

    if (trade.legA) {
      const { shouldExit: exitA, reason: reasonA } = this.checkLegExit(
        trade.legA,
        currentBids.legA,
        trade.strategyType
      );
      if (exitA) {
        shouldExit = true;
        exitReason = reasonA;
      }
    }

    if (trade.legB) {
      const { shouldExit: exitB, reason: reasonB } = this.checkLegExit(
        trade.legB,
        currentBids.legB,
        trade.strategyType
      );
      if (exitB) {
        shouldExit = true;
        exitReason = reasonB;
      }
    }

    if (shouldExit) {
      await this.closeTrade(trade, currentBids, exitReason);
    }
  }

  /**
   * 检查单腿退出条件
   */
  private checkLegExit(
    leg: NonNullable<OptionsTradeExecution['legA']>,
    currentBid: number | undefined,
    strategyType: 'positive_lag' | 'negative_corr'
  ): { shouldExit: boolean; reason: 'take_profit' | 'stop_loss' } {
    if (!currentBid || currentBid <= 0) {
      return { shouldExit: false, reason: 'take_profit' };
    }

    const pnlPct = ((currentBid - leg.entryAsk) / leg.entryAsk) * 100;

    // 止盈检查
    if (pnlPct >= this.config.takeProfitPct) {
      console.log(`🎯 [OptionsTrader] TAKE PROFIT: ${leg.contractSymbol} +${pnlPct.toFixed(1)}%`);
      return { shouldExit: true, reason: 'take_profit' };
    }

    // 止损检查
    if (pnlPct <= -this.config.stopLossPct) {
      console.log(`🛑 [OptionsTrader] STOP LOSS: ${leg.contractSymbol} ${pnlPct.toFixed(1)}%`);
      return { shouldExit: true, reason: 'stop_loss' };
    }

    // 策略 B 特殊逻辑：只要任意一条腿达到止盈，就平掉两腿
    // 因为爆发腿的利润可以 Cover 另一腿的亏损

    return { shouldExit: false, reason: 'take_profit' };
  }

  /**
   * 获取当前 BID 价
   */
  private async getCurrentBids(trade: OptionsTradeExecution): Promise<{
    legA?: number;
    legB?: number;
  }> {
    const result: { legA?: number; legB?: number } = {};

    // TODO: 调用 Tiger API 获取期权当前 BID 价

    return result;
  }

  /**
   * 关闭交易
   */
  private async closeTrade(
    trade: OptionsTradeExecution,
    currentBids: { legA?: number; legB?: number },
    reason: 'take_profit' | 'stop_loss' | 'manual'
  ): Promise<void> {
    console.log(`[OptionsTrader] Closing trade #${trade.id}, reason: ${reason}`);

    // 停止监控
    const key = this.getTradeKey(trade);
    const monitor = this.monitors.get(key);
    if (monitor) {
      clearInterval(monitor);
      this.monitors.delete(key);
    }

    // 执行平仓
    if (!this.config.dryRun) {
      // TODO: 调用 Tiger API 发送 Sell to Close 订单
    }

    // 计算最终盈亏
    let totalPnl = 0;
    if (trade.legA && currentBids.legA) {
      totalPnl += (currentBids.legA - trade.legA.entryAsk) * trade.legA.quantity * 100;
    }
    if (trade.legB && currentBids.legB) {
      totalPnl += (currentBids.legB - trade.legB.entryAsk) * trade.legB.quantity * 100;
    }

    trade.exitTime = new Date();
    trade.pnlAmount = totalPnl;
    trade.pnlPct = (totalPnl / trade.allocatedCapital) * 100;
    trade.status = 'closed';
    trade.exitReason = reason;

    // 更新数据库
    this.updateTrade(trade);

    // 从活跃交易中移除
    this.activeTrades.delete(key);

    const emoji = totalPnl >= 0 ? '🟢' : '🔴';
    console.log(`${emoji} [OptionsTrader] Closed: P&L = ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`);
  }

  private getTradeKey(trade: OptionsTradeExecution): string {
    if (trade.legA && trade.legB) {
      return `${trade.legA.contractSymbol}|${trade.legB.contractSymbol}`;
    }
    return trade.legA?.contractSymbol || '';
  }

  // ============ Database Methods ============

  private saveTrade(trade: OptionsTradeExecution): number {
    const db = getDatabase();
    this.ensureTable();

    const result = db.prepare(`
      INSERT INTO options_trades (
        signal_id, strategy_type,
        leg_a_symbol, leg_a_contract, leg_a_quantity, leg_a_entry_ask,
        leg_b_symbol, leg_b_contract, leg_b_quantity, leg_b_entry_ask,
        allocated_capital, account_net_value, status, entry_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.signalId,
      trade.strategyType,
      trade.legA?.underlyingSymbol,
      trade.legA?.contractSymbol,
      trade.legA?.quantity,
      trade.legA?.entryAsk,
      trade.legB?.underlyingSymbol,
      trade.legB?.contractSymbol,
      trade.legB?.quantity,
      trade.legB?.entryAsk,
      trade.allocatedCapital,
      trade.accountNetValue,
      trade.status,
      trade.entryTime.toISOString()
    );

    return result.lastInsertRowid as number;
  }

  private updateTrade(trade: OptionsTradeExecution): void {
    const db = getDatabase();

    db.prepare(`
      UPDATE options_trades SET
        exit_time = ?,
        pnl_pct = ?,
        pnl_amount = ?,
        status = ?,
        exit_reason = ?
      WHERE id = ?
    `).run(
      trade.exitTime?.toISOString(),
      trade.pnlPct,
      trade.pnlAmount,
      trade.status,
      trade.exitReason,
      trade.id
    );
  }

  private ensureTable(): void {
    const db = getDatabase();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS options_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id INTEGER NOT NULL,
        strategy_type TEXT NOT NULL,

        leg_a_symbol TEXT,
        leg_a_contract TEXT,
        leg_a_quantity INTEGER,
        leg_a_entry_ask REAL,

        leg_b_symbol TEXT,
        leg_b_contract TEXT,
        leg_b_quantity INTEGER,
        leg_b_entry_ask REAL,

        allocated_capital REAL,
        account_net_value REAL,
        pnl_pct REAL,
        pnl_amount REAL,

        status TEXT NOT NULL,
        entry_time TEXT NOT NULL,
        exit_time TEXT,
        exit_reason TEXT,

        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  }

  /**
   * Get all active trades
   */
  getActiveTrades(): OptionsTradeExecution[] {
    return Array.from(this.activeTrades.values());
  }
}

export default OptionsTrader;