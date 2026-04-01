import config from '../config';
import { getDatabase } from '../database/connection';

export interface Position {
  id: number;
  optionEpic: string;
  stockSymbol: string;
  entryPrice: number;
  currentPrice: number;
  positionSize: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  entryTime: Date;
}

/**
 * Position Manager
 * Tracks and manages open positions
 */
export class PositionManager {
  private maxPositionPct: number;
  private totalPortfolioValue: number;

  constructor(totalPortfolioValue: number = 100000) {
    this.maxPositionPct = config.trading.maxPositionPct;
    this.totalPortfolioValue = totalPortfolioValue;
  }

  /**
   * Calculate maximum position value
   */
  getMaxPositionValue(): number {
    return this.totalPortfolioValue * (this.maxPositionPct / 100);
  }

  /**
   * Check if new position can be opened
   */
  canOpenPosition(entryPrice: number): boolean {
    const positionValue = this.getOpenPositionValue();
    const positionSize = this.calculatePositionSize(entryPrice);
    const newPositionValue = positionSize * entryPrice;

    return newPositionValue <= this.getMaxPositionValue() &&
           positionValue + newPositionValue <= this.totalPortfolioValue;
  }

  /**
   * Calculate position size
   */
  calculatePositionSize(entryPrice: number): number {
    const maxValue = this.getMaxPositionValue();
    return Math.floor(maxValue / entryPrice);
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): Position[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM trades WHERE status = 'open' AND is_simulated = 1
    `).all();

    return rows.map((row: any) => ({
      id: row.id,
      optionEpic: row.option_epic,
      stockSymbol: row.stock_symbol,
      entryPrice: row.entry_price,
      currentPrice: row.entry_price, // Updated by monitor
      positionSize: row.position_size,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      entryTime: new Date(row.entry_time),
    }));
  }

  /**
   * Get total value of open positions
   */
  getOpenPositionValue(): number {
    const positions = this.getOpenPositions();
    return positions.reduce((sum, pos) => {
      return sum + (pos.entryPrice * pos.positionSize);
    }, 0);
  }

  /**
   * Get position count
   */
  getPositionCount(): number {
    const db = getDatabase();
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM trades WHERE status = 'open' AND is_simulated = 1
    `).get() as { count: number };
    return result.count;
  }

  /**
   * Update portfolio value
   */
  setPortfolioValue(value: number): void {
    this.totalPortfolioValue = value;
  }

  /**
   * Get portfolio summary
   */
  getPortfolioSummary(): {
    totalValue: number;
    openPositionValue: number;
    availableCash: number;
    positionCount: number;
    maxPositionValue: number;
  } {
    const openValue = this.getOpenPositionValue();
    return {
      totalValue: this.totalPortfolioValue,
      openPositionValue: openValue,
      availableCash: this.totalPortfolioValue - openValue,
      positionCount: this.getPositionCount(),
      maxPositionValue: this.getMaxPositionValue(),
    };
  }
}

export default PositionManager;
