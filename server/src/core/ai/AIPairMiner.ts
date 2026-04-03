import axios from 'axios';
import { getDatabase } from '../../database/connection';
import { YahooFinanceClient } from '../../data/YahooFinanceClient';
import UnifiedDataFetcher from '../../data/UnifiedDataFetcher';

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
  private yahooClient = new YahooFinanceClient();
  private dataFetcher: UnifiedDataFetcher;
  private readonly MAX_PAIRS = 400;

  constructor(dataFetcher: UnifiedDataFetcher) {
    this.dataFetcher = dataFetcher;
  }

  // API settings
  private API_URL = 'https://apis.iflow.cn/v1/chat/completions';
  private API_KEY = 'sk-b9473bb7ea43b38d86c20816f6ce1d68';
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
   * Trim pairs to MAX_PAIRS by deleting oldest pairs (lowest id)
   */
  public trimPairsToLimit(): number {
    const db = getDatabase();
    const countRow = db.prepare('SELECT COUNT(*) as count FROM stock_pairs WHERE is_active = 1').get() as { count: number };
    const currentCount = countRow.count;

    if (currentCount <= this.MAX_PAIRS) {
      console.log(`[AIPairMiner] 当前交易对数量 ${currentCount}，未超过上限 ${this.MAX_PAIRS}`);
      return 0;
    }

    const toDelete = currentCount - this.MAX_PAIRS;
    console.log(`[AIPairMiner] 交易对数量 ${currentCount} 超过上限 ${this.MAX_PAIRS}，删除 ${toDelete} 个最旧的交易对...`);

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
   */
  public async cleanupLowLiquidityPairs(): Promise<number> {
    const db = getDatabase();
    const pairs = db.prepare(`
      SELECT id, stock_a, stock_b FROM stock_pairs WHERE is_active = 1
    `).all() as Array<{ id: number; stock_a: string; stock_b: string }>;

    console.log(`[AIPairMiner] 检查 ${pairs.length} 个活跃交易对的流动性...`);
    let deactivatedCount = 0;
    const MIN_VALUE = 10_000_000;

    for (const pair of pairs) {
      try {
        const quoteA = await this.yahooClient.getQuote(pair.stock_a);
        const quoteB = await this.yahooClient.getQuote(pair.stock_b);
        const valueA = quoteA.price * quoteA.volume;
        const valueB = quoteB.price * quoteB.volume;

        if (valueA < MIN_VALUE || valueB < MIN_VALUE) {
          db.prepare(`UPDATE stock_pairs SET is_active = 0 WHERE id = ?`).run(pair.id);
          deactivatedCount++;
          console.log(
            `[AIPairMiner] 停用低流动性交易对 ${pair.stock_a}/${pair.stock_b}: ` +
            `$${(valueA/1000000).toFixed(1)}M / $${(valueB/1000000).toFixed(1)}M`
          );
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err: any) {
        // If we can't get quotes, deactivate the pair
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
      if (countRow.count >= this.MAX_PAIRS) {
        console.log(`[AIPairMiner] 已达到交易对上限 (${countRow.count}/${this.MAX_PAIRS})，跳过本轮挖掘`);
        return;
      }

      console.log('[AIPairMiner] 开始新一轮挖掘...');
      console.log(`[AIPairMiner] 当前交易对数量: ${countRow.count}/${this.MAX_PAIRS}`);

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
      // Schedule next run in 1 minute to avoid API concurrency but keep it very fast
      if (this.isRunning) {
        this.timer = setTimeout(() => {
          this.runMinerCycle();
        }, 60 * 1000);
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
    try {
      const quoteA = await this.yahooClient.getQuote(stockA);
      const quoteB = await this.yahooClient.getQuote(stockB);

      // Check daily traded value (Price * Volume). Minimum $10,000,000
      const valueA = quoteA.price * quoteA.volume;
      const valueB = quoteB.price * quoteB.volume;
      const MIN_VALUE = 10_000_000;

      if (valueA < MIN_VALUE) {
        console.log(`[AIPairMiner] 剔除对子 ${stockA}/${stockB}: ${stockA} 流动性不足 ($${(valueA/1000000).toFixed(1)}M < $10M)`);
        return false;
      }
      if (valueB < MIN_VALUE) {
        console.log(`[AIPairMiner] 剔除对子 ${stockA}/${stockB}: ${stockB} 流动性不足 ($${(valueB/1000000).toFixed(1)}M < $10M)`);
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
