import { getDatabase } from './connection';

const MIGRATIONS = [
  // 股票配对表
  `
  CREATE TABLE IF NOT EXISTS stock_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_a TEXT NOT NULL,
      stock_b TEXT NOT NULL,
      strategy_type TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  `,
  // 价格数据表
  `
  CREATE TABLE IF NOT EXISTS price_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      price REAL NOT NULL,
      volume INTEGER,
      return_pct REAL,
      UNIQUE(symbol, timestamp)
  );
  `,
  // 价格数据索引
  `
  CREATE INDEX IF NOT EXISTS idx_price_symbol_time ON price_data(symbol, timestamp);
  `,
  // 信号记录表
  `
  CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair_id INTEGER REFERENCES stock_pairs(id),
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      correlation_sync REAL,
      correlation_lag REAL,
      correlation_score REAL,
      volume_ratio_a REAL,
      volume_ratio_b REAL,
      volume_score_a REAL,
      volume_score_b REAL,
      volume_score REAL,
      total_score INTEGER,
      triggered INTEGER DEFAULT 0,
      strategy_used TEXT,
      strategy_type TEXT,
      entry_confirmed INTEGER DEFAULT 0,
      entry_reason TEXT,
      leader_move REAL,
      lagger_move REAL,
      expected_move REAL,
      leader TEXT,
      lagger TEXT
  );
  `,
  // 交易记录表
  `
  CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id INTEGER REFERENCES signals(id),
      stock_symbol TEXT,
      option_epic TEXT,
      strike_price REAL,
      expiry_date TEXT,
      entry_price REAL,
      exit_price REAL,
      position_size INTEGER,
      entry_time DATETIME,
      exit_time DATETIME,
      pnl_pct REAL,
      pnl_amount REAL,
      status TEXT,
      is_simulated INTEGER DEFAULT 1
  );
  `,
  // 系统日志表
  `
  CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT,
      component TEXT,
      message TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  `,
  // 配置表
  `
  CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  `,
];

export function runMigrations(): void {
  const db = getDatabase();

  console.log('Running database migrations...');

  for (const migration of MIGRATIONS) {
    try {
      db.exec(migration);
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }

  console.log('Migrations completed successfully');
}

if (require.main === module) {
  runMigrations();
}
