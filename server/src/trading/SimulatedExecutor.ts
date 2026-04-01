import IGClient from '../ig/IGClient';
import { OptionContract } from '../ig/OptionChainFetcher';
import { TradingSignal } from '../strategy/SignalGenerator';
import { getDatabase } from '../database/connection';
import config from '../config';

export interface SimulatedTrade {
  id?: number;
  signalId: number;
  stockSymbol: string;
  optionEpic: string;
  strikePrice: number;
  expiryDate: string;
  entryPrice: number; // Ask price
  exitPrice?: number; // Bid price
  positionSize: number;
  entryTime: Date;
  exitTime?: Date;
  pnlPct?: number;
  pnlAmount?: number;
  status: 'open' | 'closed' | 'partial';
  exitReason?: 'take_profit' | 'stop_loss' | 'manual';
  isSimulated: boolean;
}

/**
 * Simulated Trade Executor
 * Simulates order execution using market prices (Ask for entry, Bid for exit)
 */
export class SimulatedExecutor {
  private igClient: IGClient | null = null;
  private priceFetcher: { getLatestPrice: (symbol: string) => Promise<{ price: number; bid: number; ask: number } | null> } | null = null;
  private activeTrades: Map<string, SimulatedTrade> = new Map();
  private monitors: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    priceSource: IGClient | { getLatestPrice: (symbol: string) => Promise<{ price: number; bid: number; ask: number } | null> }
  ) {
    if (priceSource instanceof IGClient) {
      this.igClient = priceSource;
    } else {
      this.priceFetcher = priceSource;
    }
  }

  /**
   * Execute simulated buy order
   * Uses Ask price for entry
   */
  async executeBuy(
    signal: TradingSignal,
    option: OptionContract
  ): Promise<SimulatedTrade> {
    // Use ask price for entry (worst case)
    const entryPrice = option.ask;

    // Calculate position size (10% of simulated portfolio)
    const positionSize = this.calculatePositionSize(entryPrice);

    const trade: SimulatedTrade = {
      signalId: signal.id!,
      stockSymbol: signal.score.lagger || signal.stockA,
      optionEpic: option.epic,
      strikePrice: option.strike,
      expiryDate: option.expiry.toISOString().split('T')[0],
      entryPrice,
      positionSize,
      entryTime: new Date(),
      status: 'open',
      isSimulated: true,
    };

    // Save to database
    const savedId = this.saveTrade(trade);
    trade.id = savedId;

    // Track active trade
    this.activeTrades.set(option.epic, trade);

    // Start monitoring
    this.startMonitoring(trade);

    console.log(`📈 SIMULATED BUY: ${option.epic}`);
    console.log(`   Entry: $${entryPrice.toFixed(2)} | Size: ${positionSize}`);

    return trade;
  }

  /**
   * Execute simulated sell order
   * Uses Bid price for exit
   */
  async executeSell(
    tradeId: number,
    reason: 'take_profit' | 'stop_loss' | 'manual' = 'manual'
  ): Promise<SimulatedTrade | null> {
    const trade = this.getTradeById(tradeId);
    if (!trade || trade.status !== 'open') {
      return null;
    }

    // Get current option price
    try {
      let exitPrice: number;

      if (this.igClient) {
        const market = await this.igClient.getMarketData(trade.optionEpic);
        const snapshot = market.snapshot || market as any;
        exitPrice = (snapshot as any).bid || trade.entryPrice;
      } else if (this.priceFetcher) {
        const price = await this.priceFetcher.getLatestPrice(trade.optionEpic);
        exitPrice = price?.bid || trade.entryPrice;
      } else {
        throw new Error('No price source available');
      }

      return this.closeTrade(trade, exitPrice, reason);
    } catch (error) {
      console.error(`Failed to get exit price for ${trade.optionEpic}:`, error);
      return null;
    }
  }

  /**
   * Close a trade
   */
  private async closeTrade(
    trade: SimulatedTrade,
    exitPrice: number,
    reason: 'take_profit' | 'stop_loss' | 'manual'
  ): Promise<SimulatedTrade> {
    // Calculate P&L
    const pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
    const pnlAmount = (exitPrice - trade.entryPrice) * trade.positionSize;

    trade.exitPrice = exitPrice;
    trade.exitTime = new Date();
    trade.pnlPct = pnlPct;
    trade.pnlAmount = pnlAmount;
    trade.status = 'closed';
    trade.exitReason = reason;

    // Update database
    this.updateTrade(trade);

    // Stop monitoring
    this.stopMonitoring(trade.optionEpic);
    this.activeTrades.delete(trade.optionEpic);

    // Log
    const emoji = pnlPct >= 0 ? '🟢' : '🔴';
    console.log(`${emoji} SIMULATED SELL: ${trade.optionEpic}`);
    console.log(`   Exit: $${exitPrice.toFixed(2)} | P&L: ${pnlPct.toFixed(2)}%`);

    return trade;
  }

  /**
   * Start monitoring a trade for exit conditions
   */
  private startMonitoring(trade: SimulatedTrade): void {
    const interval = setInterval(async () => {
      try {
        let bidPrice: number;

        if (this.igClient) {
          const market = await this.igClient.getMarketData(trade.optionEpic);
          const snapshot = market.snapshot || market as any;
          bidPrice = (snapshot as any).bid || trade.entryPrice;
        } else if (this.priceFetcher) {
          const price = await this.priceFetcher.getLatestPrice(trade.optionEpic);
          bidPrice = price?.bid || trade.entryPrice;
        } else {
          throw new Error('No price source available');
        }

        // Calculate current P&L
        const pnlPct = ((bidPrice - trade.entryPrice) / trade.entryPrice) * 100;

        // Check take profit (+200%)
        if (pnlPct >= config.trading.takeProfitPct) {
          await this.closeTrade(trade, bidPrice, 'take_profit');
          return;
        }

        // Check stop loss (-50%)
        if (pnlPct <= -config.trading.stopLossPct) {
          await this.closeTrade(trade, bidPrice, 'stop_loss');
          return;
        }
      } catch (error) {
        console.error(`Monitor error for ${trade.optionEpic}:`, error);
      }
    }, 5000); // Check every 5 seconds

    this.monitors.set(trade.optionEpic, interval);
  }

  /**
   * Stop monitoring a trade
   */
  private stopMonitoring(optionEpic: string): void {
    const interval = this.monitors.get(optionEpic);
    if (interval) {
      clearInterval(interval);
      this.monitors.delete(optionEpic);
    }
  }

  /**
   * Calculate position size based on 10% rule
   */
  private calculatePositionSize(entryPrice: number): number {
    // Simulated portfolio value (in real system, fetch from account)
    const simulatedPortfolioValue = 100000;
    const maxPositionValue = simulatedPortfolioValue * (config.trading.maxPositionPct / 100);

    return Math.floor(maxPositionValue / entryPrice);
  }

  /**
   * Save trade to database
   */
  private saveTrade(trade: SimulatedTrade): number {
    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO trades (
        signal_id, stock_symbol, option_epic, strike_price, expiry_date,
        entry_price, position_size, entry_time, status, is_simulated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.signalId,
      trade.stockSymbol,
      trade.optionEpic,
      trade.strikePrice,
      trade.expiryDate,
      trade.entryPrice,
      trade.positionSize,
      trade.entryTime.toISOString(),
      trade.status,
      trade.isSimulated ? 1 : 0
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Update trade in database
   */
  private updateTrade(trade: SimulatedTrade): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE trades SET
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

  /**
   * Get trade by ID
   */
  private getTradeById(id: number): SimulatedTrade | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    return row ? this.rowToTrade(row) : null;
  }

  /**
   * Get all open trades
   */
  getOpenTrades(): SimulatedTrade[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM trades WHERE status = 'open' AND is_simulated = 1
    `).all();
    return rows.map(this.rowToTrade);
  }

  /**
   * Get all closed trades
   */
  getClosedTrades(limit: number = 100): SimulatedTrade[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM trades WHERE status = 'closed' AND is_simulated = 1
      ORDER BY exit_time DESC LIMIT ?
    `).all(limit);
    return rows.map(this.rowToTrade);
  }

  private rowToTrade(row: any): SimulatedTrade {
    return {
      id: row.id,
      signalId: row.signal_id,
      stockSymbol: row.stock_symbol,
      optionEpic: row.option_epic,
      strikePrice: row.strike_price,
      expiryDate: row.expiry_date,
      entryPrice: row.entry_price,
      exitPrice: row.exit_price,
      positionSize: row.position_size,
      entryTime: new Date(row.entry_time),
      exitTime: row.exit_time ? new Date(row.exit_time) : undefined,
      pnlPct: row.pnl_pct,
      pnlAmount: row.pnl_amount,
      status: row.status,
      exitReason: row.exit_reason,
      isSimulated: row.is_simulated === 1,
    };
  }
}

export default SimulatedExecutor;
