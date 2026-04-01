import { getDatabase } from './connection';

/**
 * Sync forex pairs from IG API to database
 * IG has been removed - this function now uses default forex pairs
 */
async function syncForexPairsFromIG(): Promise<void> {
  // IG API has been removed, use default forex pairs instead
  console.log('⚠️ IG API has been removed, using default forex pairs');
  throw new Error('IG API not available');
}

/**
 * Main seed function
 */
export function seedData(): void {
  const db = getDatabase();

  console.log('🌱 Starting database initialization...');

  // Insert default settings
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

  console.log('✅ Default settings inserted');

  // Using default forex pair list
  console.log('⚠️ Using default forex pair list...');
  seedDefaultForexPairs();
}

/**
 * Seed default forex pairs (fallback)
 */
function seedDefaultForexPairs(): void {
  const db = getDatabase();

  const defaultPairs = [
    // Major currency pairs
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF',
    'AUD/USD', 'USD/CAD', 'NZD/USD',

    // EUR Crosses
    'EUR/GBP', 'EUR/JPY', 'EUR/CHF', 'EUR/AUD', 'EUR/CAD', 'EUR/NZD',

    // GBP Crosses
    'GBP/JPY', 'GBP/CHF', 'GBP/AUD', 'GBP/CAD', 'GBP/NZD',

    // AUD Crosses
    'AUD/JPY', 'AUD/CAD', 'AUD/CHF', 'AUD/NZD',

    // CAD, CHF, NZD Crosses
    'CAD/JPY', 'CHF/JPY', 'NZD/JPY', 'NZD/CAD', 'NZD/CHF',
  ];

  // Collect pairs
  const pairsToInsert: Array<[string, string, string, number]> = [];
  const pairSet = new Set<string>();

  for (let i = 0; i < defaultPairs.length; i++) {
    for (let j = i + 1; j < defaultPairs.length; j++) {
      const [base1] = defaultPairs[i].split('/');
      const [base2] = defaultPairs[j].split('/');

      // Pair with same base currency
      if (base1 === base2) {
        const key = `${defaultPairs[i]}-${defaultPairs[j]}`;
        if (!pairSet.has(key)) {
          pairSet.add(key);
          pairsToInsert.push([defaultPairs[i], defaultPairs[j], 'correlation', 1]);
        }
      }
    }
  }

  // Batch insert
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
  console.log(`✅ Inserted ${count.count} default forex pair combinations`);
}

if (require.main === module) {
  seedData();
}
