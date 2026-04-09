import TigerTradeClient from './TigerTradeClient';
import TigerClient from '../data/TigerClient';
import { TradingSignal } from '../strategy/SignalGenerator';
import { getDatabase } from '../database/connection';
import config from '../config';

export interface TradeExecution {
  id?: number;
  signalId: number;
  symbol: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  orderId?: string;
  entryPrice?: number;
  status: 'pending' | 'filled' | 'failed' | 'closed';
  entryTime: Date;
  exitTime?: Date;
  exitPrice?: number;
  pnlPct?: number;
  pnlAmount?: number;
  exitReason?: 'take_profit' | 'stop_loss' | 'signal_exit' | 'manual';
}

export interface AutoTradeConfig {
  enabled: boolean;
  maxPositionSize: number;      // Max shares per position
  maxPositionValue: number;     // Max $ value per position
  takeProfitPct: number;        // Take profit percentage
  stopLossPct: number;          // Stop loss percentage
  dryRun: boolean;              // If true, don't execute real trades
}

/**
 * Tiger Auto Trader
 * Automatically executes trades when signals are triggered
 *
 * Strategy:
 * - When signal triggered with entry_confirmed=true:
 *   - If positive_lag: Buy the lagger stock
 *   - If negative_corr: Buy both stocks (pairs trading)
 *
 * Exit conditions:
 * - Take profit: +200%
 * - Stop loss: -50%
 * - Signal exits: When correlation breaks down
 */
export class TigerAutoTrader {
  private tradeClient: TigerTradeClient;
  private quoteClient: TigerClient;
  private config: AutoTradeConfig;
  private activeTrades: Map<string, TradeExecution> = new Map();
  private monitors: Map<string, NodeJS.Timeout> = new Map();

  constructor(tradeConfig?: Partial<AutoTradeConfig>) {
    this.tradeClient = new TigerTradeClient();
    this.quoteClient = new TigerClient();

    this.config = {
      enabled: tradeConfig?.enabled ?? false,
      maxPositionSize: tradeConfig?.maxPositionSize ?? 100,
      maxPositionValue: tradeConfig?.maxPositionValue ?? 10000,
      takeProfitPct: tradeConfig?.takeProfitPct ?? config.trading.takeProfitPct,
      stopLossPct: tradeConfig?.stopLossPct ?? config.trading.stopLossPct,
      dryRun: tradeConfig?.dryRun ?? false,
    };

    if (this.config.enabled && !this.config.dryRun) {
      this.tradeClient.enable();
    }

    this.logConfig();
  }

  private logConfig(): void {
    console.log('');
    console.log('='.repeat(50));
    console.log('🤖 Tiger Auto Trader Configuration');
    console.log('='.repeat(50));
    console.log(`   Enabled: ${this.config.enabled}`);
    console.log(`   Dry Run: ${this.config.dryRun}`);
    console.log(`   Max Position Size: ${this.config.maxPositionSize} shares`);
    console.log(`   Max Position Value: $${this.config.maxPositionValue}`);
    console.log(`   Take Profit: +${this.config.takeProfitPct}%`);
    console.log(`   Stop Loss: -${this.config.stopLossPct}%`);
    console.log('='.repeat(50));
    console.log('');
  }

  /**
   * Enable auto trading
   */
  enable(): void {
    this.config.enabled = true;
    if (!this.config.dryRun) {
      this.tradeClient.enable();
    }
    console.log('✅ Auto-trading ENABLED');
  }

  /**
   * Disable auto trading
   */
  disable(): void {
    this.config.enabled = false;
    this.tradeClient.disable();
    console.log('🛑 Auto-trading DISABLED');
  }

  /**
   * Process a trading signal
   * Returns the executed trades
   */
  async processSignal(signal: TradingSignal): Promise<TradeExecution[]> {
    const trades: TradeExecution[] = [];

    // Check if auto trading is enabled
    if (!this.config.enabled) {
      return trades;
    }

    // Only process triggered signals with entry confirmation
    if (!signal.triggered || !signal.entryConfirmed) {
      return trades;
    }

    // Only process positive_lag strategy (stock trading)
    // negative_corr strategy should be handled by options trader
    if (signal.strategyType !== 'positive_lag') {
      console.log(`⏭️ [AutoTrader] Skipping ${signal.strategyType} signal (handled by options trader)`);
      return trades;
    }

    console.log(`🚀 [AutoTrader] Processing signal #${signal.id}: ${signal.stockA}/${signal.stockB}`);
    console.log(`   Strategy: ${signal.strategyType}, Leader: ${signal.score.leader}, Lagger: ${signal.score.lagger}`);

    try {
      if (signal.score.lagger) {
        // Positive Lag Strategy: Buy the lagger
        const trade = await this.executeLaggerTrade(signal);
        if (trade) {
          trades.push(trade);
        }
      }
    } catch (error: any) {
      console.error(`❌ [AutoTrader] Failed to process signal: ${error.message}`);
    }

    return trades;
  }

  /**
   * Execute trade for lagger stock (positive lag strategy)
   */
  private async executeLaggerTrade(signal: TradingSignal): Promise<TradeExecution | null> {
    const symbol = signal.score.lagger!;
    const leaderSymbol = signal.score.leader!;

    // Check if we already have a position
    if (this.activeTrades.has(symbol)) {
      console.log(`⚠️ [AutoTrader] Already have active trade for ${symbol}, skipping`);
      return null;
    }

    // Check existing position
    const existingQty = await this.tradeClient.getPositionQuantity(symbol);
    if (existingQty > 0) {
      console.log(`⚠️ [AutoTrader] Already have position in ${symbol} (${existingQty} shares), skipping`);
      return null;
    }

    // Get current price
    const quote = await this.quoteClient.getQuote(symbol);
    const price = quote.price;

    // Calculate position size
    const quantity = this.calculatePositionSize(price);

    if (quantity <= 0) {
      console.log(`⚠️ [AutoTrader] Invalid position size for ${symbol}`);
      return null;
    }

    // Create trade record
    const trade: TradeExecution = {
      signalId: signal.id!,
      symbol,
      action: 'BUY',
      quantity,
      entryPrice: price,
      status: 'pending',
      entryTime: new Date(),
    };

    // Execute trade
    if (this.config.dryRun) {
      console.log(`🧪 [DRY RUN] Would BUY ${symbol} x ${quantity} @ $${price.toFixed(2)}`);
      trade.status = 'filled';
      trade.orderId = 'DRY_RUN';
    } else {
      const result = await this.tradeClient.marketBuy(symbol, quantity);

      if (result.ok) {
        trade.status = 'filled';
        trade.orderId = result.orderId;
        console.log(`✅ [AutoTrader] BOUGHT ${symbol} x ${quantity} @ $${price.toFixed(2)}`);
        console.log(`   Order ID: ${result.orderId}`);
      } else {
        trade.status = 'failed';
        console.error(`❌ [AutoTrader] Failed to buy ${symbol}: ${result.error}`);
        return null;
      }
    }

    // Save to database
    trade.id = this.saveTrade(trade);

    // Track active trade
    this.activeTrades.set(symbol, trade);

    // Start monitoring
    this.startMonitoring(trade, signal);

    return trade;
  }

  /**
   * Execute trade for negative correlation strategy
   * For pairs like SPY/SH or QQQ/PSQ, buy the inverse ETF (stockB)
   */
  private async executeNegativeCorrTrade(signal: TradingSignal): Promise<TradeExecution | null> {
    // For negative correlation pairs, buy stockB (usually the inverse ETF)
    // e.g., SPY/SH -> buy SH, QQQ/PSQ -> buy PSQ
    const symbol = signal.stockB;
    const hedgeSymbol = signal.stockA;

    // Check if we already have a position
    if (this.activeTrades.has(symbol)) {
      console.log(`⚠️ [AutoTrader] Already have active trade for ${symbol}, skipping`);
      return null;
    }

    // Check existing position
    const existingQty = await this.tradeClient.getPositionQuantity(symbol);
    if (existingQty > 0) {
      console.log(`⚠️ [AutoTrader] Already have position in ${symbol} (${existingQty} shares), skipping`);
      return null;
    }

    // Get current price
    const quote = await this.quoteClient.getQuote(symbol);
    const price = quote.price;

    // Calculate position size
    const quantity = this.calculatePositionSize(price);

    if (quantity <= 0) {
      console.log(`⚠️ [AutoTrader] Invalid position size for ${symbol}`);
      return null;
    }

    // Create trade record
    const trade: TradeExecution = {
      signalId: signal.id!,
      symbol,
      action: 'BUY',
      quantity,
      entryPrice: price,
      status: 'pending',
      entryTime: new Date(),
    };

    // Execute trade
    if (this.config.dryRun) {
      console.log(`🧪 [DRY RUN] Would BUY ${symbol} (hedge vs ${hedgeSymbol}) x ${quantity} @ $${price.toFixed(2)}`);
      trade.status = 'filled';
      trade.orderId = 'DRY_RUN';
    } else {
      const result = await this.tradeClient.marketBuy(symbol, quantity);

      if (result.ok) {
        trade.status = 'filled';
        trade.orderId = result.orderId;
        console.log(`✅ [AutoTrader] BOUGHT ${symbol} (hedge vs ${hedgeSymbol}) x ${quantity} @ $${price.toFixed(2)}`);
        console.log(`   Order ID: ${result.orderId}`);
      } else {
        trade.status = 'failed';
        console.error(`❌ [AutoTrader] Failed to buy ${symbol}: ${result.error}`);
        return null;
      }
    }

    // Save to database
    trade.id = this.saveTrade(trade);

    // Track active trade
    this.activeTrades.set(symbol, trade);

    // Start monitoring
    this.startMonitoring(trade, signal);

    return trade;
  }

  /**
   * Calculate position size based on config limits
   */
  private calculatePositionSize(price: number): number {
    // Calculate based on max value
    const sizeByValue = Math.floor(this.config.maxPositionValue / price);

    // Take the smaller of the two limits
    return Math.min(sizeByValue, this.config.maxPositionSize);
  }

  /**
   * Start monitoring a trade for exit conditions
   */
  private startMonitoring(trade: TradeExecution, signal: TradingSignal): void {
    const interval = setInterval(async () => {
      try {
        await this.checkExitConditions(trade, signal);
      } catch (error: any) {
        console.error(`[AutoTrader] Monitor error for ${trade.symbol}: ${error.message}`);
      }
    }, 10_000); // Check every 10 seconds

    this.monitors.set(trade.symbol, interval);
  }

  /**
   * Check exit conditions for a trade
   */
  private async checkExitConditions(trade: TradeExecution, signal: TradingSignal): Promise<void> {
    if (trade.status !== 'filled') {
      return;
    }

    // Get current price
    const quote = await this.quoteClient.getQuote(trade.symbol);
    const currentPrice = quote.price;

    // Calculate P&L
    const pnlPct = ((currentPrice - trade.entryPrice!) / trade.entryPrice!) * 100;

    // Check take profit
    if (pnlPct >= this.config.takeProfitPct) {
      console.log(`🎯 [AutoTrader] TAKE PROFIT: ${trade.symbol} +${pnlPct.toFixed(2)}%`);
      await this.closeTrade(trade, currentPrice, 'take_profit');
      return;
    }

    // Check stop loss
    if (pnlPct <= -this.config.stopLossPct) {
      console.log(`🛑 [AutoTrader] STOP LOSS: ${trade.symbol} ${pnlPct.toFixed(2)}%`);
      await this.closeTrade(trade, currentPrice, 'stop_loss');
      return;
    }

    // Log current status periodically
    console.log(`📊 [AutoTrader] ${trade.symbol}: $${currentPrice.toFixed(2)} | P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`);
  }

  /**
   * Close a trade
   */
  async closeTrade(trade: TradeExecution, exitPrice: number, reason: TradeExecution['exitReason']): Promise<void> {
    // Stop monitoring
    const monitor = this.monitors.get(trade.symbol);
    if (monitor) {
      clearInterval(monitor);
      this.monitors.delete(trade.symbol);
    }

    // Execute sell
    if (this.config.dryRun) {
      console.log(`🧪 [DRY RUN] Would SELL ${trade.symbol} x ${trade.quantity} @ $${exitPrice.toFixed(2)}`);
    } else {
      const result = await this.tradeClient.marketSell(trade.symbol, trade.quantity);
      if (!result.ok) {
        console.error(`❌ [AutoTrader] Failed to sell ${trade.symbol}: ${result.error}`);
        return;
      }
    }

    // Calculate final P&L
    const pnlPct = ((exitPrice - trade.entryPrice!) / trade.entryPrice!) * 100;
    const pnlAmount = (exitPrice - trade.entryPrice!) * trade.quantity;

    // Update trade
    trade.exitPrice = exitPrice;
    trade.exitTime = new Date();
    trade.pnlPct = pnlPct;
    trade.pnlAmount = pnlAmount;
    trade.status = 'closed';
    trade.exitReason = reason;

    // Update database
    this.updateTrade(trade);

    // Remove from active trades
    this.activeTrades.delete(trade.symbol);

    // Log result
    const emoji = pnlPct >= 0 ? '🟢' : '🔴';
    console.log(`${emoji} [AutoTrader] CLOSED ${trade.symbol}`);
    console.log(`   Entry: $${trade.entryPrice?.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}`);
    console.log(`   P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% ($${pnlAmount.toFixed(2)})`);
    console.log(`   Reason: ${reason}`);
  }

  /**
   * Close all active trades
   */
  async closeAllTrades(reason: TradeExecution['exitReason'] = 'manual'): Promise<void> {
    const trades = Array.from(this.activeTrades.values());

    for (const trade of trades) {
      try {
        const quote = await this.quoteClient.getQuote(trade.symbol);
        await this.closeTrade(trade, quote.price, reason);
      } catch (error: any) {
        console.error(`[AutoTrader] Failed to close ${trade.symbol}: ${error.message}`);
      }
    }
  }

  /**
   * Get all active trades
   */
  getActiveTrades(): TradeExecution[] {
    return Array.from(this.activeTrades.values());
  }

  /**
   * Get trade history
   */
  getTradeHistory(limit: number = 100): TradeExecution[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM tiger_trades
      ORDER BY entry_time DESC
      LIMIT ?
    `).all(limit);

    return rows.map(this.rowToTrade);
  }

  // ============ Database Methods ============

  private saveTrade(trade: TradeExecution): number {
    const db = getDatabase();

    // Ensure table exists
    this.ensureTable();

    const result = db.prepare(`
      INSERT INTO tiger_trades (
        signal_id, symbol, action, quantity, order_id, entry_price,
        status, entry_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.signalId,
      trade.symbol,
      trade.action,
      trade.quantity,
      trade.orderId,
      trade.entryPrice,
      trade.status,
      trade.entryTime.toISOString()
    );

    return result.lastInsertRowid as number;
  }

  private updateTrade(trade: TradeExecution): void {
    const db = getDatabase();

    db.prepare(`
      UPDATE tiger_trades SET
        exit_price = ?,
        exit_time = ?,
        pnl_pct = ?,
        pnl_amount = ?,
        status = ?,
        exit_reason = ?
      WHERE id = ?
    `).run(
      trade.exitPrice,
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
      CREATE TABLE IF NOT EXISTS tiger_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        action TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        order_id TEXT,
        entry_price REAL,
        exit_price REAL,
        entry_time TEXT NOT NULL,
        exit_time TEXT,
        pnl_pct REAL,
        pnl_amount REAL,
        status TEXT NOT NULL,
        exit_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  }

  private rowToTrade(row: any): TradeExecution {
    return {
      id: row.id,
      signalId: row.signal_id,
      symbol: row.symbol,
      action: row.action,
      quantity: row.quantity,
      orderId: row.order_id,
      entryPrice: row.entry_price,
      exitPrice: row.exit_price,
      entryTime: new Date(row.entry_time),
      exitTime: row.exit_time ? new Date(row.exit_time) : undefined,
      pnlPct: row.pnl_pct,
      pnlAmount: row.pnl_amount,
      status: row.status,
      exitReason: row.exit_reason,
    };
  }
}

export default TigerAutoTrader;