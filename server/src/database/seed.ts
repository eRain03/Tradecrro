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
    ['expected_move_threshold', '0.5'], // 0.5% default
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
 * DISABLED: Pairs are now managed manually via UI
 */
function seedDefaultStockPairs(): void {
  // Pairs are managed manually via UI - don't auto-seed
  const db = getDatabase();
  const count = db.prepare('SELECT COUNT(*) as count FROM stock_pairs WHERE is_active = 1').get() as { count: number };
  console.log(`📊 Stock pairs: ${count.count} active (manual management)`);
}

if (require.main === module) {
  seedData();
}
