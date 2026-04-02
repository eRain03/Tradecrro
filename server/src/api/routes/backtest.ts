import { Router, type Response } from 'express';
import { getDatabase } from '../../database/connection';
import SignalBacktester, { type RunForPairProgressEvent } from '../../strategy/SignalBacktester';

const router = Router();

function getReplayPairRows(
  db: ReturnType<typeof getDatabase>,
  pairs: string[] | undefined
): Array<{ stock_a: string; stock_b: string }> {
  if (pairs && pairs.length > 0) {
    const placeholders = pairs.map(() => '?').join(',');
    return db.prepare(`
      SELECT stock_a, stock_b
      FROM stock_pairs
      WHERE (stock_a || '/' || stock_b) IN (${placeholders}) AND is_active = 1
    `).all(...pairs) as Array<{ stock_a: string; stock_b: string }>;
  }
  return db.prepare(`
    SELECT stock_a, stock_b
    FROM stock_pairs
    WHERE is_active = 1
  `).all() as Array<{ stock_a: string; stock_b: string }>;
}

function ndjsonWrite(res: Response, obj: object): void {
  res.write(`${JSON.stringify(obj)}\n`);
  const flush = (res as Response & { flush?: () => void }).flush;
  if (typeof flush === 'function') {
    flush.call(res);
  }
}

const toFinite = (value: unknown, fallback: number = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

interface BacktestRequest {
  startTime: string;
  endTime: string;
  pairs?: string[];
  mode?: 'db_signals' | 'yahoo_replay';
}

interface BacktestRunRequest extends BacktestRequest {
  /** 1-based，默认 1 */
  page?: number;
  /** 每页条数，默认 100，最大 100 */
  pageSize?: number;
  /** 为 true 时只分页「已触发」信号 */
  triggeredOnly?: boolean;
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
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

function mapSignalRow(row: any): BacktestSignal {
  return {
    id: row.id,
    timestamp: row.timestamp,
    stockA: row.stock_a,
    stockB: row.stock_b,
    strategyType: row.strategy_used || row.strategy_type,
    syncCorrelation: toFinite(row.correlation_sync),
    lagCorrelation: toFinite(row.correlation_lag),
    correlationScore: toFinite(row.correlation_score),
    volumeScoreA: toFinite(row.volume_score_a),
    volumeScoreB: toFinite(row.volume_score_b),
    volumeScore: toFinite(row.volume_score),
    totalScore: toFinite(row.total_score),
    triggered: row.triggered === 1,
    entryConfirmed: row.entry_confirmed === 1,
    leader: row.leader,
    lagger: row.lagger,
    leaderMove: row.leader_move,
    laggerMove: row.lagger_move,
    expectedMove: row.expected_move,
  };
}

// Run backtest — 从数据库 signals 分页查询（每页最多 100 条）
router.post('/run', (req, res) => {
  try {
    const {
      startTime,
      endTime,
      pairs,
      page: rawPage,
      pageSize: rawPageSize,
      triggeredOnly,
    }: BacktestRunRequest = req.body;

    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'Start time and end time are required' });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      return res.status(400).json({ error: 'Invalid time range' });
    }

    const normalizedStart = start.toISOString();
    const normalizedEnd = end.toISOString();

    const page = Math.max(1, Math.floor(Number(rawPage) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(rawPageSize) || 100)));

    const db = getDatabase();

    const baseFrom = `
      FROM signals s
      JOIN stock_pairs p ON s.pair_id = p.id
      WHERE s.timestamp >= ? AND s.timestamp <= ?
    `;
    const baseParams: any[] = [normalizedStart, normalizedEnd];

    let pairFilter = '';
    if (pairs && pairs.length > 0) {
      const pairPlaceholders = pairs.map(() => '?').join(',');
      pairFilter = ` AND (p.stock_a || '/' || p.stock_b) IN (${pairPlaceholders})`;
      baseParams.push(...pairs);
    }

    const triggeredFilter = triggeredOnly ? ' AND s.triggered = 1' : '';

    const aggRow = db.prepare(`
      SELECT
        COUNT(*) AS total_signals,
        SUM(CASE WHEN s.triggered = 1 THEN 1 ELSE 0 END) AS triggered_signals,
        SUM(CASE WHEN s.entry_confirmed = 1 THEN 1 ELSE 0 END) AS confirmed_signals,
        SUM(CASE WHEN COALESCE(s.strategy_used, s.strategy_type) = 'positive_lag' THEN 1 ELSE 0 END) AS positive_lag_count,
        SUM(CASE WHEN COALESCE(s.strategy_used, s.strategy_type) = 'negative_corr' THEN 1 ELSE 0 END) AS negative_corr_count,
        AVG(s.correlation_score) AS avg_correlation_score,
        AVG(s.volume_score) AS avg_volume_score,
        AVG(s.total_score) AS avg_total_score
      ${baseFrom}
      ${pairFilter}
    `).get(...baseParams) as {
      total_signals: number;
      triggered_signals: number | null;
      confirmed_signals: number | null;
      positive_lag_count: number | null;
      negative_corr_count: number | null;
      avg_correlation_score: number | null;
      avg_volume_score: number | null;
      avg_total_score: number | null;
    };

    const totalSignals = Number(aggRow.total_signals) || 0;
    const triggeredSignals = Number(aggRow.triggered_signals) || 0;
    const confirmedSignals = Number(aggRow.confirmed_signals) || 0;
    const positiveLagCount = Number(aggRow.positive_lag_count) || 0;
    const negativeCorrCount = Number(aggRow.negative_corr_count) || 0;

    const avgCorrelationScore = toFinite(aggRow.avg_correlation_score);
    const avgVolumeScore = toFinite(aggRow.avg_volume_score);
    const avgTotalScore = toFinite(aggRow.avg_total_score);

    const countQuery = `SELECT COUNT(*) AS c ${baseFrom} ${pairFilter} ${triggeredFilter}`;
    const countParams = [...baseParams];
    const totalForPage = (db.prepare(countQuery).get(...countParams) as { c: number }).c;
    const totalPages = totalForPage > 0 ? Math.ceil(totalForPage / pageSize) : 0;
    const safePage = totalPages > 0 ? Math.min(page, totalPages) : 1;
    const offset = (safePage - 1) * pageSize;

    const listQuery = `
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
      ${baseFrom}
      ${pairFilter}
      ${triggeredFilter}
      ORDER BY s.timestamp DESC
      LIMIT ? OFFSET ?
    `;
    const listParams = [...baseParams, pageSize, offset];
    const rows = db.prepare(listQuery).all(...listParams) as any[];

    const signals: BacktestSignal[] = rows.map(mapSignalRow);

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
      pagination: {
        page: safePage,
        pageSize,
        total: totalForPage,
        totalPages,
      },
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
    const pairRows = getReplayPairRows(db, pairs);

    const backtester = new SignalBacktester();
    const allSignals: BacktestSignal[] = [];
    let nextSignalId = 1;

    const promises = pairRows.map(pair =>
      backtester.runForPair(pair.stock_a, pair.stock_b, start, end)
    );

    const results = await Promise.all(promises);

    for (const points of results) {
      for (const p of points) {
        allSignals.push({
          id: nextSignalId++,
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
        });
      }
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

/** 行情重放 NDJSON 流：按交易对推送进度，最后一行 type=complete */
router.post('/replay-stream', async (req, res) => {
  const { startTime, endTime, pairs }: BacktestRequest = req.body;

  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'Start time and end time are required' });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return res.status(400).json({ error: 'Invalid time range' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');

  const write = (obj: object) => ndjsonWrite(res, obj);

  try {
    const db = getDatabase();
    const pairRows = getReplayPairRows(db, pairs);
    const t0 = Date.now();

    write({
      type: 'start',
      totalPairs: pairRows.length,
      startTime,
      endTime,
    });

    if (pairRows.length === 0) {
      write({ type: 'error', message: '没有可回测的交易对（请检查时间与筛选）' });
      res.end();
      return;
    }

    const backtester = new SignalBacktester();
    const allSignals: BacktestSignal[] = [];

    const pairSubProgress = (
      pairIndex: number,
      pair: { stock_a: string; stock_b: string },
      totalPairs: number,
      e: RunForPairProgressEvent
    ): number => {
      let sub = 0.02;
      if (e.kind === 'symbol_start') {
        sub = e.symbol === pair.stock_a ? 0.08 : 0.22;
      } else if (e.kind === 'symbol_done') {
        sub = e.symbol === pair.stock_a ? 0.18 : 0.38;
      } else if (e.kind === 'compute') {
        sub = 0.48;
      }
      return Math.min(99, Math.round(((pairIndex + sub) / totalPairs) * 100));
    };

    const promises = pairRows.map((pair, i) => (async () => {
      const pairStartPct = Math.max(
        1,
        Math.min(99, Math.round((i / pairRows.length) * 100))
      );
      write({
        type: 'progress',
        step: 'pair_start',
        current: i + 1,
        total: pairRows.length,
        stockA: pair.stock_a,
        stockB: pair.stock_b,
        cumulativeSignals: allSignals.length,
        elapsedSec: Math.round((Date.now() - t0) / 1000),
        percentApprox: pairStartPct,
      });
      console.log(
        `[replay-stream] 交易对 ${i + 1}/${pairRows.length} 开始 ${pair.stock_a}/${pair.stock_b}`
      );

      const points = await backtester.runForPair(pair.stock_a, pair.stock_b, start, end, {
        onProgress: (e) => {
          const pct = pairSubProgress(i, pair, pairRows.length, e);
          write({
            type: 'progress',
            step: 'symbol',
            subStep: e.kind,
            symbol: e.symbol,
            barCount: e.barCount,
            current: i + 1,
            total: pairRows.length,
            stockA: pair.stock_a,
            stockB: pair.stock_b,
            cumulativeSignals: allSignals.length,
            elapsedSec: Math.round((Date.now() - t0) / 1000),
            percentApprox: pct,
          });
          console.log(
            `[replay-stream]   ${pair.stock_a}/${pair.stock_b} → ${e.kind}` +
              (e.symbol ? ` ${e.symbol}` : '') +
              (e.barCount != null ? ` bars=${e.barCount}` : '')
          );
        },
      });

      write({
        type: 'progress',
        step: 'pair_done',
        current: i + 1,
        total: pairRows.length,
        stockA: pair.stock_a,
        stockB: pair.stock_b,
        cumulativeSignals: allSignals.length,
        lastPairSignalCount: points.length,
        elapsedSec: Math.round((Date.now() - t0) / 1000),
        percentApprox: Math.round(((i + 1) / pairRows.length) * 100),
      });

      return points;
    })());

    const results = await Promise.all(promises);
    let nextSignalId = 1;
    for (const points of results) {
      for (const p of points) {
        allSignals.push({
          id: nextSignalId++,
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
        });
      }
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

    write({ type: 'complete', result });
    res.end();
  } catch (error: any) {
    console.error('Replay stream error:', error);
    try {
      write({ type: 'error', message: error.message || 'Replay stream failed' });
    } catch {
      // ignore
    }
    try {
      res.end();
    } catch {
      // ignore
    }
  }
});

export default router;
