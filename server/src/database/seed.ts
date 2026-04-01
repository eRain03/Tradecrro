import { getDatabase } from './connection';

/**
 * 从 IG API 同步外汇对到数据库
 * IG has been removed - this function now uses default forex pairs
 */
async function syncForexPairsFromIG(): Promise<void> {
  // IG API has been removed, use default forex pairs instead
  console.log('⚠️ IG API has been removed, using default forex pairs');
  throw new Error('IG API not available');
}

/**
 * 主种子函数
 */
export function seedData(): void {
  const db = getDatabase();

  console.log('🌱 开始初始化数据库...');

  // 插入默认配置
  const insertSetting = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);

  const defaultSettings = [
    ['score_threshold', '87'],
    ['max_position_pct', '10'],
    ['take_profit_pct', '200'],
    ['stop_loss_pct', '50'],
    ['sampling_interval', '30'],
    ['lookback_window', '30'],
    ['lag_intervals', '10'],
    ['is_simulated', '1'],
  ];

  for (const [key, value] of defaultSettings) {
    insertSetting.run(key, value);
  }

  console.log('✅ 默认配置已插入');

  // 使用默认外汇对列表
  console.log('⚠️ 使用默认外汇对列表...');
  seedDefaultForexPairs();
}

/**
 * 种入默认外汇对列表（备用方案）
 */
function seedDefaultForexPairs(): void {
  const db = getDatabase();

  const defaultPairs = [
    // 主要货币对
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF',
    'AUD/USD', 'USD/CAD', 'NZD/USD',

    // EUR 交叉
    'EUR/GBP', 'EUR/JPY', 'EUR/CHF', 'EUR/AUD', 'EUR/CAD', 'EUR/NZD',

    // GBP 交叉
    'GBP/JPY', 'GBP/CHF', 'GBP/AUD', 'GBP/CAD', 'GBP/NZD',

    // AUD 交叉
    'AUD/JPY', 'AUD/CAD', 'AUD/CHF', 'AUD/NZD',

    // CAD, CHF, NZD 交叉
    'CAD/JPY', 'CHF/JPY', 'NZD/JPY', 'NZD/CAD', 'NZD/CHF',
  ];

  // 收集配对
  const pairsToInsert: Array<[string, string, string, number]> = [];
  const pairSet = new Set<string>();

  for (let i = 0; i < defaultPairs.length; i++) {
    for (let j = i + 1; j < defaultPairs.length; j++) {
      const [base1] = defaultPairs[i].split('/');
      const [base2] = defaultPairs[j].split('/');

      // 同一基础货币的配对
      if (base1 === base2) {
        const key = `${defaultPairs[i]}-${defaultPairs[j]}`;
        if (!pairSet.has(key)) {
          pairSet.add(key);
          pairsToInsert.push([defaultPairs[i], defaultPairs[j], 'correlation', 1]);
        }
      }
    }
  }

  // 批量插入
  const insertPair = db.prepare(`
    INSERT OR IGNORE INTO stock_pairs (stock_a, stock_b, strategy_type, is_active)
    VALUES (?, ?, ?, ?)
  `);

  const insertMany = db.transaction((pairs: Array<[string, string, string, number]>) => {
    for (const pair of pairs) {
      insertPair.run(...pair);
    }
  });

  insertMany(pairsToInsert);

  const count = db.prepare('SELECT COUNT(*) as count FROM stock_pairs').get() as { count: number };
  console.log(`✅ 已插入 ${count.count} 个默认外汇对配对`);
}

if (require.main === module) {
  seedData();
}
