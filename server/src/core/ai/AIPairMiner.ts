import axios from 'axios';
import { getDatabase } from '../../database/connection';
import { DatabentoHistorical } from '../../data/DatabentoHistorical';
import UnifiedDataFetcher from '../../data/UnifiedDataFetcher';
import config from '../../config';

const POOL_OF_TICKERS = [
  // Tech & Software
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'AVGO', 'CSCO', 'ADBE',
  'CRM', 'INTC', 'AMD', 'TXN', 'QCOM', 'NFLX', 'CMCSA', 'TMUS', 'VZ', 'T', 'ORCL',
  'IBM', 'NOW', 'UBER', 'INTU', 'AMAT', 'MU', 'LRCX', 'KLAC', 'SNPS', 'CDNS', 'PANW',
  'FTNT', 'CRWD', 'ZS', 'TEAM', 'NET', 'OKTA', 'DDOG', 'MDB', 'SNOW', 'PLTR', 'WDAY',
  'ROP', 'PTC', 'ADSK', 'ANSS', 'TYL', 'CDW', 'ZM', 'PINS', 'DOCU', 'DBX', 'SMAR',
  'RNG', 'ASAN', 'ESTC', 'DT', 'APP', 'MNDY', 'GTLB', 'IOT', 'CFLT', 'HPE', 'HPQ',
  'DELL', 'WDC', 'STX', 'NTAP', 'SWKS', 'TER', 'NXPI', 'MPWR', 'MRVL', 'ON', 'MCHP',
  
  // Financials & Payments
  'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'BLK', 'AXP', 'SPGI', 'SCHW', 'CB', 'MMC',
  'PGR', 'CME', 'ICE', 'AON', 'MCO', 'IT', 'FI', 'FIS', 'GPN', 'JKHY', 'BR', 'BRO',
  'WTW', 'TRV', 'AIG', 'ALL', 'PRU', 'DFS', 'CINF', 'COF', 'SYF', 'ALLY', 'CMA',
  'FITB', 'HBAN', 'KEY', 'MTB', 'RF', 'TFC', 'ZION', 'USB', 'PNC', 'V', 'MA', 'PYPL',
  
  // Healthcare & Biotech
  'JNJ', 'UNH', 'ABBV', 'LLY', 'MRK', 'PFE', 'TMO', 'DHR', 'ABT', 'SYK', 'ISRG',
  'ZTS', 'BSX', 'BDX', 'GILD', 'BMY', 'AMGN', 'REGN', 'VRTX', 'BIIB', 'ILMN', 'IDXX',
  'EW', 'A', 'ALGN', 'DXCM', 'RMD', 'STE', 'MCK', 'WST', 'HOLX', 'COO', 'PKI', 'XRAY',
  'WAT', 'MTD', 'CAH', 'CI', 'ELV', 'COR', 'LH', 'CNC', 'MOH', 'HUM', 'CVS', 'WBA',
  'ABC', 'HSIC', 'PODD', 'TNDM', 'MASI', 'PEN', 'GL',
  
  // Consumer Staples & Discretionary
  'WMT', 'COST', 'PG', 'KO', 'PEP', 'HD', 'LOW', 'MCD', 'SBUX', 'NKE', 'TGT', 'DG',
  'DLTR', 'ROST', 'BBY', 'KR', 'TSCO', 'TJX', 'ORLY', 'AZO', 'AAP', 'GPC', 'KMX',
  'CMG', 'YUM', 'DPZ', 'DRI', 'QSR', 'TXRH', 'ARCO', 'BLMN', 'WEN', 'EAT', 'PZZA',
  'PLAY', 'JACK', 'CAVA', 'SHAK', 'LVS', 'MGM', 'WYNN', 'CZR', 'PENN', 'MAR', 'HLT',
  'H', 'CHH', 'WH', 'BKNG', 'EXPE', 'ABNB', 'TRIP', 'CCL', 'RCL', 'NCLH', 'DAL',
  'UAL', 'AAL', 'LUV', 'ALK', 'JBLU', 'SAVE', 'HA', 'ALGT', 'F', 'GM', 'STLA', 'LCID',
  'RIVN', 'TM', 'HMC', 'CVNA', 'AN', 'LAD', 'PAG', 'ABG', 'SAH', 'GPI', 'M', 'DDS',
  'GPS', 'BKE', 'BURL', 'URBN', 'RL', 'PVH', 'TPR', 'CPRI', 'UAA', 'LULU', 'CROX',
  'DECK', 'ONON', 'SKX', 'WWW', 'FL', 'COLM', 'GCO', 'SHOO', 'BOOT',
  
  // Energy, Industrials & Materials
  'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY', 'MPC', 'VLO', 'PSX', 'HAL', 'BKR', 'HES',
  'PXD', 'FANG', 'DVN', 'CTRA', 'MRO', 'HON', 'GE', 'BA', 'CAT', 'LMT', 'DE', 'URI',
  'RTX', 'GD', 'NOC', 'TDG', 'LHX', 'TXT', 'HWM', 'LDOS', 'BWXT', 'WM', 'RSG', 'APD',
  'SHW', 'ECL', 'NEM', 'FCX', 'DD', 'DOW', 'CTVA', 'PPG', 'NUE', 'STLD', 'RS', 'CMC',
  'X', 'CLF', 'AA', 'MT', 'TECK', 'SCCO', 'VALE', 'BHP', 'RIO', 'ALB', 'SQM', 'LTHM',
  'FMC', 'CF', 'MOS', 'NTR', 'ICL', 'UAN', 'IPI', 'LXU'
];

export class AIPairMiner {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private databentoClient = new DatabentoHistorical();
  private dataFetcher: UnifiedDataFetcher;
  private maxPairs: number;

  // Liquidity cache: symbol -> daily traded value (from historical data)
  private liquidityCache = new Map<string, number>();
  private liquidityCacheDate: string | null = null;

  constructor(dataFetcher: UnifiedDataFetcher) {
    this.dataFetcher = dataFetcher;
    this.maxPairs = config.trading.maxPairs;
  }

  /**
   * Get current max pairs limit
   */
  public getMaxPairs(): number {
    return this.maxPairs;
  }

  /**
   * Update max pairs limit
   */
  public setMaxPairs(limit: number): void {
    this.maxPairs = limit;
    console.log(`[AIPairMiner] 交易对上限已更新为 ${limit}`);
  }

  /**
   * Get the most recent trading day (skip weekends and holidays)
   * Returns a date that is N days before today, adjusting for non-trading days
   */
  private getRecentTradingDay(daysBack: number = 2): { start: Date; end: Date } {
    const now = new Date();
    let targetDate = new Date(now);
    let count = 0;

    // Walk back daysBack trading days (skip weekends)
    while (count < daysBack) {
      targetDate.setDate(targetDate.getDate() - 1);
      const dayOfWeek = targetDate.getDay();
      // Skip Saturday (6) and Sunday (0)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        count++;
      }
    }

    // Set to market hours in UTC
    // US Market: 9:30 AM - 4:00 PM ET = 14:30 - 21:00 UTC
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const day = targetDate.getDate();

    const start = new Date(Date.UTC(year, month, day, 14, 30, 0)); // 14:30 UTC = 9:30 AM ET
    const end = new Date(Date.UTC(year, month, day, 21, 0, 0)); // 21:00 UTC = 4:00 PM ET

    return { start, end };
  }

  /**
   * Fetch historical data for a symbol and calculate daily traded value
   * Uses cache to avoid repeated API calls
   */
  private async getDailyTradedValue(symbol: string): Promise<number | null> {
    // Check cache freshness (same trading day)
    const todayKey = new Date().toISOString().slice(0, 10);
    if (this.liquidityCacheDate !== todayKey) {
      this.liquidityCache.clear();
      this.liquidityCacheDate = todayKey;
    }

    // Return cached value if available
    if (this.liquidityCache.has(symbol)) {
      return this.liquidityCache.get(symbol)!;
    }

    try {
      // Get data from 2 trading days ago
      const { start, end } = this.getRecentTradingDay(2);

      // Try multiple days if the first one returns no data (holiday)
      let historicalData: any[] = [];
      let attemptDays = 2;

      while (historicalData.length === 0 && attemptDays <= 7) {
        const range = this.getRecentTradingDay(attemptDays);
        try {
          historicalData = await this.databentoClient.getHistoricalRange(
            symbol,
            range.start,
            range.end,
            '1m'
          );
          if (historicalData.length > 0) break;
        } catch {
          // Try next day
        }
        attemptDays++;
      }

      if (historicalData.length === 0) {
        console.warn(`[AIPairMiner] ${symbol} 无历史数据`);
        return null;
      }

      // Calculate total daily volume and average price
      const totalVolume = historicalData.reduce((sum, bar) => sum + (bar.volume || 0), 0);
      const avgPrice = historicalData.reduce((sum, bar) => sum + (bar.close || 0), 0) / historicalData.length;
      const dailyValue = totalVolume * avgPrice;

      // Cache the result
      this.liquidityCache.set(symbol, dailyValue);

      console.log(`[AIPairMiner] ${symbol} 日交易额: $${(dailyValue/1000000).toFixed(1)}M (from ${attemptDays} days ago)`);
      return dailyValue;
    } catch (err: any) {
      console.warn(`[AIPairMiner] 获取 ${symbol} 历史数据失败:`, err.message);
      return null;
    }
  }

  // API settings
  private API_URL = 'https://apis.iflow.cn/v1/chat/completions';
  private API_KEY = 'sk-20a0d310c1a0fc3f53f65d5da9b42280';
  private MODEL = 'qwen3-max';

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[AIPairMiner] 启动后台 AI 交易对挖掘引擎...');

    // Initial run after 5 seconds
    this.timer = setTimeout(() => {
      this.runMinerCycle();
    }, 5 * 1000);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[AIPairMiner] 停止 AI 交易对挖掘引擎.');
  }

  /**
   * Trim pairs to maxPairs by deleting oldest pairs (lowest id)
   */
  public trimPairsToLimit(): number {
    const db = getDatabase();
    const countRow = db.prepare('SELECT COUNT(*) as count FROM stock_pairs WHERE is_active = 1').get() as { count: number };
    const currentCount = countRow.count;

    if (currentCount <= this.maxPairs) {
      console.log(`[AIPairMiner] 当前交易对数量 ${currentCount}，未超过上限 ${this.maxPairs}`);
      return 0;
    }

    const toDelete = currentCount - this.maxPairs;
    console.log(`[AIPairMiner] 交易对数量 ${currentCount} 超过上限 ${this.maxPairs}，删除 ${toDelete} 个最旧的交易对...`);

    // Get IDs to delete
    const idsToDelete = db.prepare(`
      SELECT id FROM stock_pairs WHERE is_active = 1 ORDER BY id ASC LIMIT ?
    `).all(toDelete) as Array<{ id: number }>;

    const idList = idsToDelete.map(r => r.id);
    const placeholders = idList.map(() => '?').join(',');

    // Delete related signals first (foreign key constraint)
    db.prepare(`DELETE FROM signals WHERE pair_id IN (${placeholders})`).run(...idList);

    // Delete the pairs
    const result = db.prepare(`DELETE FROM stock_pairs WHERE id IN (${placeholders})`).run(...idList);

    console.log(`[AIPairMiner] 已删除 ${result.changes} 个交易对`);
    return result.changes;
  }

  /**
   * Clean up pairs with low liquidity (daily traded value < $10M)
   * Uses Databento historical data from recent trading days
   */
  public async cleanupLowLiquidityPairs(): Promise<number> {
    const db = getDatabase();
    const pairs = db.prepare(`
      SELECT id, stock_a, stock_b FROM stock_pairs WHERE is_active = 1
    `).all() as Array<{ id: number; stock_a: string; stock_b: string }>;

    console.log(`[AIPairMiner] 检查 ${pairs.length} 个活跃交易对的流动性 (使用 Databento 历史数据)...`);
    let deactivatedCount = 0;
    const MIN_VALUE = 10_000_000;

    for (const pair of pairs) {
      try {
        const valueA = await this.getDailyTradedValue(pair.stock_a);
        const valueB = await this.getDailyTradedValue(pair.stock_b);

        if (valueA === null || valueA < MIN_VALUE) {
          db.prepare(`UPDATE stock_pairs SET is_active = 0 WHERE id = ?`).run(pair.id);
          deactivatedCount++;
          console.log(
            `[AIPairMiner] 停用低流动性交易对 ${pair.stock_a}/${pair.stock_b}: ` +
            `${pair.stock_a} $${valueA ? (valueA/1000000).toFixed(1) : 'N/A'}M < $10M`
          );
          continue;
        }

        if (valueB === null || valueB < MIN_VALUE) {
          db.prepare(`UPDATE stock_pairs SET is_active = 0 WHERE id = ?`).run(pair.id);
          deactivatedCount++;
          console.log(
            `[AIPairMiner] 停用低流动性交易对 ${pair.stock_a}/${pair.stock_b}: ` +
            `${pair.stock_b} $${valueB ? (valueB/1000000).toFixed(1) : 'N/A'}M < $10M`
          );
        }
      } catch (err: any) {
        // If we can't get data, deactivate the pair
        db.prepare(`UPDATE stock_pairs SET is_active = 0 WHERE id = ?`).run(pair.id);
        deactivatedCount++;
        console.log(`[AIPairMiner] 停用无法验证的交易对 ${pair.stock_a}/${pair.stock_b}: ${err.message}`);
      }
    }

    console.log(`[AIPairMiner] 清理完成，停用了 ${deactivatedCount} 个低流动性交易对`);
    return deactivatedCount;
  }

  private async runMinerCycle() {
    if (!this.isRunning) return;

    try {
      // Check if we've reached the max pairs limit
      const db = getDatabase();
      const countRow = db.prepare('SELECT COUNT(*) as count FROM stock_pairs WHERE is_active = 1').get() as { count: number };
      if (countRow.count >= this.maxPairs) {
        console.log(`[AIPairMiner] 已达到交易对上限 (${countRow.count}/${this.maxPairs})，跳过本轮挖掘`);
        return;
      }

      console.log('[AIPairMiner] 开始新一轮挖掘...');
      console.log(`[AIPairMiner] 当前交易对数量: ${countRow.count}/${this.maxPairs}`);

      // 1. Pick a random batch of 100 symbols
      const batch = this.getRandomBatch(POOL_OF_TICKERS, 100);
      console.log(`[AIPairMiner] 选中用于挖掘的股票池 (${batch.length} 只)`);

      // 2. Call AI
      const pairs = await this.askAIToPair(batch);
      console.log(`[AIPairMiner] AI 推荐了 ${pairs.length} 个对子.`);

      // 3. Verify liquidity & insert
      let addedCount = 0;
      const newSymbols = new Set<string>();

      for (const [stockA, stockB] of pairs) {
        const isValid = await this.verifyLiquidity(stockA, stockB);
        if (isValid) {
          const inserted = this.insertPairToDB(stockA, stockB);
          if (inserted) {
            addedCount++;
            newSymbols.add(stockA);
            newSymbols.add(stockB);
          }
        }
      }

      if (newSymbols.size > 0) {
        console.log(`[AIPairMiner] Notifying DataFetcher to track ${newSymbols.size} new symbols...`);
        await this.dataFetcher.addSymbols(Array.from(newSymbols));
      }

      console.log(`[AIPairMiner] 本轮挖掘完成，成功添加了 ${addedCount} 个高质量交易对.`);

    } catch (err: any) {
      console.error('[AIPairMiner] 挖掘周期发生错误:', err.message);
    } finally {
      // Schedule next run in 30 seconds
      if (this.isRunning) {
        this.timer = setTimeout(() => {
          this.runMinerCycle();
        }, 30 * 1000);
      }
    }
  }

  private getRandomBatch(pool: string[], size: number): string[] {
    const uniquePool = Array.from(new Set(pool)); // Ensure uniqueness
    const shuffled = [...uniquePool].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, size);
  }

  private async askAIToPair(tickers: string[]): Promise<[string, string][]> {
    const prompt = `
你是一个华尔街顶级量化分析师。我现在给你一批美股代码：
[${tickers.join(', ')}]

任务 1：踢出里面流动性差、或者基本面极不稳定的股票。
任务 2：将剩下的股票，严格按照同行业、同赛道、或者强上下游供应链关系，两两配对，寻找适合做统计套利（Pairs Trading）的组合。
任务 3：大胆组合！尽可能多地找出逻辑合理的对子，你可以返回 10 个甚至 30 个对子，只要它们属于同一赛道。
任务 4：务必以严格的 JSON 格式返回一个二维数组，不要包含任何 markdown 标记（如 \`\`\`json ），直接输出纯 JSON。例如：
[["AAPL", "MSFT"], ["AMD", "NVDA"], ["WMT", "TGT"]]
`;

    try {
      const response = await axios.post(
        this.API_URL,
        {
          model: this.MODEL,
          messages: [
            { role: 'system', content: 'You are a helpful assistant that only outputs valid JSON arrays.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1
        },
        {
          headers: {
            'Authorization': `Bearer ${this.API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60s timeout
        }
      );

      let content = response.data?.choices?.[0]?.message?.content || '';
      content = content.trim();
      
      // Clean up markdown block if AI still outputs it
      if (content.startsWith('```json')) {
        content = content.replace(/^```json/, '');
      }
      if (content.startsWith('```')) {
        content = content.replace(/^```/, '');
      }
      if (content.endsWith('```')) {
        content = content.replace(/```$/, '');
      }
      content = content.trim();

      const parsed = JSON.parse(content);
      
      if (Array.isArray(parsed) && parsed.every(item => Array.isArray(item) && item.length === 2)) {
        return parsed as [string, string][];
      } else {
        console.warn('[AIPairMiner] AI 返回的 JSON 格式不符合预期');
        return [];
      }
    } catch (err: any) {
      console.error('[AIPairMiner] 请求 AI 接口失败:', err?.response?.data || err.message);
      return [];
    }
  }

  private async verifyLiquidity(stockA: string, stockB: string): Promise<boolean> {
    const MIN_VALUE = 10_000_000;

    try {
      const valueA = await this.getDailyTradedValue(stockA);
      const valueB = await this.getDailyTradedValue(stockB);

      if (valueA === null || valueA < MIN_VALUE) {
        console.log(`[AIPairMiner] 剔除对子 ${stockA}/${stockB}: ${stockA} 流动性不足 ($${valueA ? (valueA/1000000).toFixed(1) : 'N/A'}M < $10M)`);
        return false;
      }

      if (valueB === null || valueB < MIN_VALUE) {
        console.log(`[AIPairMiner] 剔除对子 ${stockA}/${stockB}: ${stockB} 流动性不足 ($${valueB ? (valueB/1000000).toFixed(1) : 'N/A'}M < $10M)`);
        return false;
      }

      return true;
    } catch (err: any) {
      console.warn(`[AIPairMiner] 无法获取 ${stockA}/${stockB} 的流动性数据:`, err.message);
      return false;
    }
  }

  private insertPairToDB(stockA: string, stockB: string): boolean {
    const db = getDatabase();
    
    // Sort to avoid duplicates like AAPL/MSFT and MSFT/AAPL
    const [a, b] = [stockA, stockB].sort();

    try {
      const existing = db.prepare(`
        SELECT id FROM stock_pairs
        WHERE stock_a = ? AND stock_b = ?
      `).get(a, b);

      if (existing) {
        // Just make sure it's active
        db.prepare(`UPDATE stock_pairs SET is_active = 1 WHERE stock_a = ? AND stock_b = ?`).run(a, b);
        return false; // Not newly added
      } else {
        db.prepare(`
          INSERT INTO stock_pairs (stock_a, stock_b, strategy_type, is_active)
          VALUES (?, ?, ?, ?)
        `).run(a, b, 'correlation', 1);
        console.log(`[AIPairMiner] ✨ 新增交易对: ${a}/${b}`);
        return true;
      }
    } catch (err: any) {
      console.error(`[AIPairMiner] 插入数据库失败 ${a}/${b}:`, err.message);
      return false;
    }
  }
}
