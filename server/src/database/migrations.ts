import { getDatabase } from './connection';

const MIGRATIONS = [
  // Stock pair table
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
  // Price data table
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
  // Price data index
  `
  CREATE INDEX IF NOT EXISTS idx_price_symbol_time ON price_data(symbol, timestamp);
  `,
  // Signal table
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
  // Trade table
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
  // System log table
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
  // Settings table
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
