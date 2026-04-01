import { getDatabase } from './connection';

/**
 * Forex pair database module
 *
 * Manage storage, retrieval, and updates of forex pairs
 * Store forex pair data in the existing stock_pairs table
 */

export interface ForexPairRecord {
  id: number;
  epic: string;           // Unique IG market identifier
  pairName: string;       // Normalized name, e.g. EUR/USD
  instrumentName: string; // Full name returned by IG
  is_active: number;      // Active flag (1=yes, 0=no)
  created_at: string;
}

/**
 * Raw forex pair data retrieved from IG
 */
export interface RawForexPair {
  epic: string;
  pairName: string;
  instrumentName: string;
  instrumentType: string;
  marketStatus: string;
}

/**
 * Persist forex pairs into database
 * Using stock_pairs table, where:
 * - stock_a = pairName (e.g. "EUR/USD")
 * - stock_b = Paired symbol for correlation strategy
 * - strategy_type = 'correlation' (default)
 */

/**
 * Sync forex pairs to database
 *
 * @param pairs Forex pairs retrieved from IG
 * @returns Number of forex pairs written to DB
 */
export function syncForexPairs(pairs: RawForexPair[]): number {
  const db = getDatabase();

  console.log('💾 Starting forex pair sync to database...');

  // Prepare insert statement
  const insertPair = db.prepare(`
    INSERT OR IGNORE INTO stock_pairs (stock_a, stock_b, strategy_type, is_active)
    VALUES (?, ?, ?, 1)
  `);

  // Prepare update statement (update status if epic exists)
  const updatePair = db.prepare(`
    UPDATE stock_pairs SET is_active = 1 WHERE stock_a = ?
  `);

  let insertedCount = 0;
  let updatedCount = 0;

  for (const pair of pairs) {
    try {
      // First try inserting a new record
      const result = insertPair.run(pair.pairName, pair.pairName, 'correlation');

      if (result.changes === 0) {
        // If insert fails (already exists), update status
        updatePair.run(pair.pairName);
        updatedCount++;
      } else {
        insertedCount++;
      }
    } catch (error) {
      console.error(`  ❌ Insert failed ${pair.pairName}:`, error);
    }
  }

  console.log(`✅ Sync completed! inserted ${insertedCount}  updated  ${updatedCount}  forex pairs`);

  return insertedCount + updatedCount;
}

/**
 * Get all active forex pairs from database
 *
 * @returns Forex pair list
 */
export function getActiveForexPairs(): string[] {
  const db = getDatabase();

  const pairs = db.prepare(`
    SELECT DISTINCT stock_a as pair_name
    FROM stock_pairs
    WHERE is_active = 1
    AND stock_a LIKE '%/%'  -- Return only rows containing / (forex format)
    ORDER BY stock_a
  `).all() as { pair_name: string }[];

  return pairs.map(p => p.pair_name);
}

/**
 * Get all forex pairs (including inactive)
 *
 * @returns Forex pair list (with details)
 */
export function getAllForexPairs(): ForexPairRecord[] {
  const db = getDatabase();

  const pairs = db.prepare(`
    SELECT id, epic, stock_a as pairName, stock_b, strategy_type, is_active, created_at
    FROM stock_pairs
    WHERE stock_a LIKE '%/%'
    ORDER BY is_active DESC, stock_a
  `).all() as ForexPairRecord[];

  return pairs;
}

/**
 * Activate or deactivate forex pair
 *
 * @param pairName Forex pair name (e.g. EUR/USD)
 * @param isActive Whether active
 */
export function setForexPairActive(pairName: string, isActive: boolean): void {
  const db = getDatabase();

  db.prepare(`
    UPDATE stock_pairs
    SET is_active = ?
    WHERE stock_a = ?
  `).run(isActive ? 1 : 0, pairName);
}

/**
 * Delete forex pair
 *
 * @param pairName Forex pair name
 */
export function deleteForexPair(pairName: string): void {
  const db = getDatabase();

  db.prepare(`
    DELETE FROM stock_pairs
    WHERE stock_a = ? OR stock_b = ?
  `).run(pairName, pairName);
}

/**
 * Get forex pair count statistics
 */
export function getForexPairsStats(): { total: number; active: number; inactive: number } {
  const db = getDatabase();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive
    FROM stock_pairs
    WHERE stock_a LIKE '%/%'
  `).get() as { total: number; active: number; inactive: number };

  return {
    total: stats.total || 0,
    active: stats.active || 0,
    inactive: stats.inactive || 0,
  };
}
