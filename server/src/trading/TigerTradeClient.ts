import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import config from '../config';

const execFileAsync = promisify(execFile);

/**
 * Tiger Trading Client
 * Executes real trades via Tiger Open API
 *
 * ⚠️ WARNING: THIS EXECUTES REAL TRADES WITH REAL MONEY! ⚠️
 */
export interface TradeResult {
  ok: boolean;
  orderId?: string;
  symbol?: string;
  action?: string;
  quantity?: number;
  orderType?: string;
  limitPrice?: number;
  error?: string;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgCost: number;
  marketValue: number;
  unrealizedPnl: number;
}

export interface Order {
  orderId: string;
  symbol: string;
  action: string;
  quantity: number;
  filledQuantity: number;
  orderType: string;
  status: string;
  limitPrice: number;
}

export interface AccountInfo {
  ok: boolean;
  accountId?: string;
  accountType?: string;
  netLiquidation?: number;
  cash?: number;
  buyingPower?: number;
  error?: string;
}

export class TigerTradeClient {
  private pythonBin: string;
  private scriptPath: string;
  private configPath: string;

  // Safety: require explicit enable
  private enabled: boolean = false;

  constructor() {
    this.pythonBin = config.tiger.python;
    this.scriptPath = path.join(__dirname, '../../scripts/tiger_trade.py');
    this.configPath = config.tiger.configPath || path.join(__dirname, '../../config/tiger_openapi_config.properties');

    console.log('');
    console.log('⚠️  Tiger Trading Client Initialized');
    console.log('⚠️  AUTO-TRADING IS DISABLED BY DEFAULT');
    console.log('⚠️  Call enable() to enable real trading');
    console.log('');
  }

  /**
   * Enable trading (must be called explicitly)
   */
  enable(): void {
    this.enabled = true;
    console.log('✅ Tiger AUTO-TRADING ENABLED');
    console.log('⚠️  REAL TRADES WILL BE EXECUTED!');
  }

  /**
   * Disable trading
   */
  disable(): void {
    this.enabled = false;
    console.log('🛑 Tiger AUTO-TRADING DISABLED');
  }

  /**
   * Check if trading is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Execute market buy order
   */
  async marketBuy(symbol: string, quantity: number): Promise<TradeResult> {
    this.guardEnabled();
    console.log(`📈 [Tiger] MARKET BUY: ${symbol} x ${quantity}`);

    return this.callPython('buy', symbol, String(quantity));
  }

  /**
   * Execute market sell order
   */
  async marketSell(symbol: string, quantity: number): Promise<TradeResult> {
    this.guardEnabled();
    console.log(`📉 [Tiger] MARKET SELL: ${symbol} x ${quantity}`);

    return this.callPython('sell', symbol, String(quantity));
  }

  /**
   * Execute limit buy order
   */
  async limitBuy(symbol: string, quantity: number, price: number): Promise<TradeResult> {
    this.guardEnabled();
    console.log(`📈 [Tiger] LIMIT BUY: ${symbol} x ${quantity} @ $${price.toFixed(2)}`);

    return this.callPython('limit_buy', symbol, String(quantity), price.toFixed(2));
  }

  /**
   * Execute limit sell order
   */
  async limitSell(symbol: string, quantity: number, price: number): Promise<TradeResult> {
    this.guardEnabled();
    console.log(`📉 [Tiger] LIMIT SELL: ${symbol} x ${quantity} @ $${price.toFixed(2)}`);

    return this.callPython('limit_sell', symbol, String(quantity), price.toFixed(2));
  }

  /**
   * Get current positions
   */
  async getPositions(): Promise<Position[]> {
    const result = await this.callPython('positions');

    if (Array.isArray(result)) {
      return result as Position[];
    }

    return [];
  }

  /**
   * Get open orders
   */
  async getOpenOrders(): Promise<Order[]> {
    const result = await this.callPython('orders');

    if (Array.isArray(result)) {
      return result as Order[];
    }

    return [];
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<TradeResult> {
    return this.callPython('cancel', orderId);
  }

  /**
   * Get account info
   */
  async getAccountInfo(): Promise<AccountInfo> {
    const result = await this.callPython('account');
    return result as AccountInfo;
  }

  /**
   * Check if we have a position in a symbol
   */
  async hasPosition(symbol: string): Promise<boolean> {
    const positions = await this.getPositions();
    return positions.some(p => p.symbol.toUpperCase() === symbol.toUpperCase());
  }

  /**
   * Get position quantity for a symbol
   */
  async getPositionQuantity(symbol: string): Promise<number> {
    const positions = await this.getPositions();
    const pos = positions.find(p => p.symbol.toUpperCase() === symbol.toUpperCase());
    return pos?.quantity || 0;
  }

  // ============ Private Methods ============

  private guardEnabled(): void {
    if (!this.enabled) {
      throw new Error('Tiger auto-trading is disabled. Call enable() first.');
    }
  }

  private async callPython(action: string, ...args: string[]): Promise<any> {
    const env = {
      ...process.env,
      TIGER_CONFIG_PATH: this.configPath,
      PYTHONUNBUFFERED: '1',
    };

    try {
      const { stdout, stderr } = await execFileAsync(
        this.pythonBin,
        [this.scriptPath, action, ...args],
        { env, maxBuffer: 10 * 1024 * 1024, timeout: 30_000 }
      );

      // Check for errors in stderr
      if (stderr) {
        console.warn('[Tiger Trade] stderr:', stderr.trim());
      }

      // Parse result
      try {
        return JSON.parse(stdout);
      } catch {
        console.error('[Tiger Trade] Failed to parse output:', stdout.slice(0, 200));
        return { ok: false, error: 'Failed to parse response' };
      }
    } catch (error: any) {
      const errorMsg = error.stderr || error.message || String(error);
      console.error('[Tiger Trade] Error:', errorMsg);

      return { ok: false, error: errorMsg };
    }
  }
}

export default TigerTradeClient;