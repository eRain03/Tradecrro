import { getDatabase } from './connection';

/**
 * Legacy placeholder kept for compatibility.
 */
async function syncForexPairsFromIG(): Promise<void> {
  console.log('⚠️ IG API has been removed, using default stock pairs');
  throw new Error('IG API not available');
}

/**
 * Main seed function
 */
export function seedData(): void {
  const db = getDatabase();

  console.log('🌱 Seeding database...');

  // Insert default settings only if not exists (preserve user settings)
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);

  const defaultSettings = [
    ['score_threshold', '87'],
    ['max_position_pct', '10'],
    ['take_profit_pct', '200'],
    ['stop_loss_pct', '50'],
    ['sampling_interval', '30'],
    ['lookback_window', '30'],
    ['lag_intervals', '2'],
    ['max_pairs', '400'],
    ['is_simulated', '1'],
  ];

  for (const [key, value] of defaultSettings) {
    insertSetting.run(key, value);
  }

  console.log('✅ Default settings ensured (preserved existing values)');

  // Use the built-in US stock universe
  console.log('⚠️ Using built-in US stock pairs...');
  seedDefaultStockPairs();
}

/**
 * Seed the default US stock pair list
 */
function seedDefaultStockPairs(): void {
  const db = getDatabase();

  const stockGroups: Record<string, string[]> = {
    mega_cap_tech: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA'],
    semiconductors: ['NVDA', 'AMD', 'AVGO', 'QCOM', 'INTC', 'MU'],
    banks: ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS'],
    payment_networks: ['V', 'MA', 'AXP', 'PYPL'],
    consumer_retail: ['AMZN', 'WMT', 'COST', 'TGT', 'HD', 'LOW'],
    travel_leisure: ['BKNG', 'ABNB', 'RCL', 'CCL', 'MAR', 'HLT'],
    energy: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY'],
    healthcare: ['UNH', 'JNJ', 'PFE', 'MRK', 'ABBV', 'LLY'],
    telecom_media: ['T', 'VZ', 'TMUS', 'NFLX', 'DIS', 'CMCSA'],
  };

  const pairsToInsert: Array<[string, string, string, number]> = [];
  const pairSet = new Set<string>();

  // NOTE: Don't reset is_active for existing pairs - preserve AI-mined pairs
  // Only ensure default pairs are active

  for (const symbols of Object.values(stockGroups)) {
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const key = `${symbols[i]}-${symbols[j]}`;
        if (!pairSet.has(key)) {
          pairSet.add(key);
          pairsToInsert.push([symbols[i], symbols[j], 'correlation', 1]);
        }
      }
    }
  }

  // Bulk insert (only activate default pairs, don't deactivate others)
  const findPair = db.prepare(`
    SELECT id
    FROM stock_pairs
    WHERE stock_a = ? AND stock_b = ?
    LIMIT 1
  `);
  const insertPair = db.prepare(`
    INSERT INTO stock_pairs (stock_a, stock_b, strategy_type, is_active)
    VALUES (?, ?, ?, ?)
  `);
  const updatePair = db.prepare(`
    UPDATE stock_pairs
    SET strategy_type = ?, is_active = 1
    WHERE id = ?
  `);

  const insertMany = db.transaction((pairs: Array<[string, string, string, number]>) => {
    for (const pair of pairs) {
      const existing = findPair.get(pair[0], pair[1]) as { id: number } | undefined;
      if (existing) {
        // Only update if not already active (preserve existing active pairs)
        updatePair.run(pair[2], existing.id);
      } else {
        insertPair.run(...pair);
      }
    }
  });

  insertMany(pairsToInsert);

  const count = db.prepare('SELECT COUNT(*) as count FROM stock_pairs WHERE is_active = 1').get() as { count: number };
  console.log(`✅ Default stock pairs ensured (${count.count} active pairs total)`);
}

if (require.main === module) {
  seedData();
}
