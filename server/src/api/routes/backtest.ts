import { Router } from 'express';
import { getDatabase } from '../../database/connection';
import SignalBacktester from '../../strategy/SignalBacktester';

const router = Router();

interface BacktestRequest {
  startTime: string;
  endTime: string;
  pairs?: string[];
  mode?: 'db_signals' | 'yahoo_replay';
}

interface BacktestSignal {
  id: number;
  timestamp: string;
  stockA: string;
  stockB: string;
  strategyType: 'positive_lag' | 'negative_corr' | null;
  syncCorrelation: number;
  lagCorrelation: number;
  correlationScore: number;
  volumeScoreA: number;
  volumeScoreB: number;
  volumeScore: number;
  totalScore: number;
  triggered: boolean;
  entryConfirmed: boolean;
  leader?: string;
  lagger?: string;
  leaderMove?: number;
  laggerMove?: number;
  expectedMove?: number;
}

interface BacktestResult {
  summary: {
    startTime: string;
    endTime: string;
    totalSignals: number;
    triggeredSignals: number;
    confirmedSignals: number;
    positiveLagCount: number;
    negativeCorrCount: number;
    avgCorrelationScore: number;
    avgVolumeScore: number;
    avgTotalScore: number;
  };
  signals: BacktestSignal[];
}

// Run backtest - returns all signals within time range
router.post('/run', (req, res) => {
  try {
    const { startTime, endTime, pairs }: BacktestRequest = req.body;

    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'Start time and end time are required' });
    }

    const db = getDatabase();

    // Get signals within the time range
    let signalQuery = `
      SELECT
        s.id,
        s.timestamp,
        s.correlation_sync,
        s.correlation_lag,
        s.correlation_score,
        s.volume_ratio_a,
        s.volume_ratio_b,
        s.volume_score_a,
        s.volume_score_b,
        s.volume_score,
        s.total_score,
        s.triggered,
        s.strategy_used,
        s.strategy_type,
        s.entry_confirmed,
        s.leader_move,
        s.lagger_move,
        s.expected_move,
        s.leader,
        s.lagger,
        p.stock_a,
        p.stock_b
      FROM signals s
      JOIN stock_pairs p ON s.pair_id = p.id
      WHERE s.timestamp >= ? AND s.timestamp <= ?
    `;

    const params: any[] = [startTime, endTime];

    if (pairs && pairs.length > 0) {
      const pairPlaceholders = pairs.map(() => '?').join(',');
      signalQuery += ` AND (p.stock_a || '/' || p.stock_b) IN (${pairPlaceholders})`;
      params.push(...pairs);
    }

    signalQuery += ' ORDER BY s.timestamp DESC';

    const rows = db.prepare(signalQuery).all(...params) as any[];

    // Transform to signal objects
    const signals: BacktestSignal[] = rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      stockA: row.stock_a,
      stockB: row.stock_b,
      strategyType: row.strategy_used,
      syncCorrelation: row.correlation_sync,
      lagCorrelation: row.correlation_lag,
      correlationScore: row.correlation_score || 0,
      volumeScoreA: row.volume_score_a || 0,
      volumeScoreB: row.volume_score_b || 0,
      volumeScore: row.volume_score || 0,
      totalScore: row.total_score,
      triggered: row.triggered === 1,
      entryConfirmed: row.entry_confirmed === 1,
      leader: row.leader,
      lagger: row.lagger,
      leaderMove: row.leader_move,
      laggerMove: row.lagger_move,
      expectedMove: row.expected_move,
    }));

    // Calculate summary statistics
    const totalSignals = signals.length;
    const triggeredSignals = signals.filter(s => s.triggered).length;
    const confirmedSignals = signals.filter(s => s.entryConfirmed).length;
    const positiveLagCount = signals.filter(s => s.strategyType === 'positive_lag').length;
    const negativeCorrCount = signals.filter(s => s.strategyType === 'negative_corr').length;

    const avgCorrelationScore = totalSignals > 0
      ? signals.reduce((sum, s) => sum + s.correlationScore, 0) / totalSignals
      : 0;
    const avgVolumeScore = totalSignals > 0
      ? signals.reduce((sum, s) => sum + s.volumeScore, 0) / totalSignals
      : 0;
    const avgTotalScore = totalSignals > 0
      ? signals.reduce((sum, s) => sum + s.totalScore, 0) / totalSignals
      : 0;

    const result: BacktestResult = {
      summary: {
        startTime,
        endTime,
        totalSignals,
        triggeredSignals,
        confirmedSignals,
        positiveLagCount,
        negativeCorrCount,
        avgCorrelationScore,
        avgVolumeScore,
        avgTotalScore,
      },
      signals,
    };

    res.json(result);
  } catch (error: any) {
    console.error('Backtest error:', error);
    res.status(500).json({ error: error.message || 'Backtest failed' });
  }
});

// Replay backtest from Yahoo historical candles (signal-only, no trading execution)
router.post('/replay', async (req, res) => {
  try {
    const { startTime, endTime, pairs }: BacktestRequest = req.body;

    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'Start time and end time are required' });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      return res.status(400).json({ error: 'Invalid time range' });
    }

    const db = getDatabase();
    let pairRows: Array<{ stock_a: string; stock_b: string }> = [];

    if (pairs && pairs.length > 0) {
      const placeholders = pairs.map(() => '?').join(',');
      pairRows = db.prepare(`
        SELECT stock_a, stock_b
        FROM stock_pairs
        WHERE (stock_a || '/' || stock_b) IN (${placeholders}) AND is_active = 1
      `).all(...pairs) as Array<{ stock_a: string; stock_b: string }>;
    } else {
      pairRows = db.prepare(`
        SELECT stock_a, stock_b
        FROM stock_pairs
        WHERE is_active = 1
        LIMIT 20
      `).all() as Array<{ stock_a: string; stock_b: string }>;
    }

    const backtester = new SignalBacktester();
    const allSignals: BacktestSignal[] = [];

    for (const pair of pairRows) {
      const points = await backtester.runForPair(pair.stock_a, pair.stock_b, start, end);
      allSignals.push(
        ...points.map((p, idx) => ({
          id: allSignals.length + idx + 1,
          timestamp: p.timestamp,
          stockA: p.stockA,
          stockB: p.stockB,
          strategyType: p.strategyType,
          syncCorrelation: p.syncCorrelation,
          lagCorrelation: p.lagCorrelation,
          correlationScore: p.correlationScore,
          volumeScoreA: p.volumeScoreA,
          volumeScoreB: p.volumeScoreB,
          volumeScore: p.volumeScore,
          totalScore: p.totalScore,
          triggered: p.triggered,
          entryConfirmed: p.entryConfirmed,
          leader: p.leader,
          lagger: p.lagger,
          leaderMove: p.leaderMove,
          laggerMove: p.laggerMove,
          expectedMove: p.expectedMove,
        }))
      );
    }

    allSignals.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const totalSignals = allSignals.length;
    const triggeredSignals = allSignals.filter(s => s.triggered).length;
    const confirmedSignals = allSignals.filter(s => s.entryConfirmed).length;
    const positiveLagCount = allSignals.filter(s => s.strategyType === 'positive_lag').length;
    const negativeCorrCount = allSignals.filter(s => s.strategyType === 'negative_corr').length;
    const avgCorrelationScore = totalSignals > 0
      ? allSignals.reduce((sum, s) => sum + s.correlationScore, 0) / totalSignals
      : 0;
    const avgVolumeScore = totalSignals > 0
      ? allSignals.reduce((sum, s) => sum + s.volumeScore, 0) / totalSignals
      : 0;
    const avgTotalScore = totalSignals > 0
      ? allSignals.reduce((sum, s) => sum + s.totalScore, 0) / totalSignals
      : 0;

    const result: BacktestResult = {
      summary: {
        startTime,
        endTime,
        totalSignals,
        triggeredSignals,
        confirmedSignals,
        positiveLagCount,
        negativeCorrCount,
        avgCorrelationScore,
        avgVolumeScore,
        avgTotalScore,
      },
      signals: allSignals,
    };

    res.json(result);
  } catch (error: any) {
    console.error('Replay backtest error:', error);
    res.status(500).json({ error: error.message || 'Replay backtest failed' });
  }
});

export default router;
