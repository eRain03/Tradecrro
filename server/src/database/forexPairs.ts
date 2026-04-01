import { getDatabase } from './connection';

/**
 * 外汇对数据库管理模块
 *
 * 管理外汇交易对的存储、检索和更新
 * 使用现有的 stock_pairs 表存储外汇对数据
 */

export interface ForexPairRecord {
  id: number;
  epic: string;           // IG 市场的唯一标识符
  pairName: string;       // 标准化名称，如 EUR/USD
  instrumentName: string; // IG 返回的完整名称
  is_active: number;      // 是否激活 (1=是，0=否)
  created_at: string;
}

/**
 * 从 IG 检索到的原始外汇对数据
 */
export interface RawForexPair {
  epic: string;
  pairName: string;
  instrumentName: string;
  instrumentType: string;
  marketStatus: string;
}

/**
 * 将外汇对存入数据库
 * 使用 stock_pairs 表，其中：
 * - stock_a = pairName (如 "EUR/USD")
 * - stock_b = 配对的另一个货币对（用于相关性交易）
 * - strategy_type = 'correlation' (默认)
 */

/**
 * 同步外汇对到数据库
 *
 * @param pairs 从 IG 检索到的外汇对列表
 * @returns 存入数据库的外汇对数量
 */
export function syncForexPairs(pairs: RawForexPair[]): number {
  const db = getDatabase();

  console.log('💾 开始同步外汇对到数据库...');

  // 准备插入语句
  const insertPair = db.prepare(`
    INSERT OR IGNORE INTO stock_pairs (stock_a, stock_b, strategy_type, is_active)
    VALUES (?, ?, ?, 1)
  `);

  // 准备更新语句（如果 epic 已存在，更新状态）
  const updatePair = db.prepare(`
    UPDATE stock_pairs SET is_active = 1 WHERE stock_a = ?
  `);

  let insertedCount = 0;
  let updatedCount = 0;

  for (const pair of pairs) {
    try {
      // 首先尝试插入新记录
      const result = insertPair.run(pair.pairName, pair.pairName, 'correlation');

      if (result.changes === 0) {
        // 如果插入失败（已存在），更新状态
        updatePair.run(pair.pairName);
        updatedCount++;
      } else {
        insertedCount++;
      }
    } catch (error) {
      console.error(`  ❌ 插入失败 ${pair.pairName}:`, error);
    }
  }

  console.log(`✅ 同步完成！新增 ${insertedCount} 个，更新 ${updatedCount} 个外汇对`);

  return insertedCount + updatedCount;
}

/**
 * 从数据库获取所有活跃的外汇对
 *
 * @returns 外汇对列表
 */
export function getActiveForexPairs(): string[] {
  const db = getDatabase();

  const pairs = db.prepare(`
    SELECT DISTINCT stock_a as pair_name
    FROM stock_pairs
    WHERE is_active = 1
    AND stock_a LIKE '%/%'  -- 只返回包含 / 的，即外汇对格式
    ORDER BY stock_a
  `).all() as { pair_name: string }[];

  return pairs.map(p => p.pair_name);
}

/**
 * 获取所有外汇对（包括非活跃）
 *
 * @returns 外汇对列表（包含详细信息）
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
 * 激活或停用外汇对
 *
 * @param pairName 外汇对名称（如 EUR/USD）
 * @param isActive 是否激活
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
 * 删除外汇对
 *
 * @param pairName 外汇对名称
 */
export function deleteForexPair(pairName: string): void {
  const db = getDatabase();

  db.prepare(`
    DELETE FROM stock_pairs
    WHERE stock_a = ? OR stock_b = ?
  `).run(pairName, pairName);
}

/**
 * 获取外汇对数量统计
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
