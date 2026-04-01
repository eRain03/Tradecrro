import { Router } from 'express';
import { getDatabase } from '../../database/connection';

const router = Router();

// Get all signals
router.get('/', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const db = getDatabase();
    const signals = db.prepare(`
      SELECT s.id, s.timestamp,
             s.correlation_sync as syncCorrelation,
             s.correlation_lag as lagCorrelation,
             s.correlation_score as correlationScore,
             s.volume_ratio_a as volumeRatioA,
             s.volume_ratio_b as volumeRatioB,
             s.volume_score_a as volumeScoreA,
             s.volume_score_b as volumeScoreB,
             s.volume_score as volumeScore,
             s.total_score as totalScore,
             s.triggered, s.strategy_used as strategyUsed,
             s.strategy_type as strategyType,
             s.entry_confirmed as entryConfirmed, s.entry_reason as entryReason,
             s.leader_move as leaderMove, s.lagger_move as laggerMove,
             s.expected_move as expectedMove,
             s.leader, s.lagger,
             p.stock_a as stockA, p.stock_b as stockB
      FROM signals s
      JOIN stock_pairs p ON s.pair_id = p.id
      ORDER BY s.timestamp DESC
      LIMIT ?
    `).all(limit);

    // Transform signals to include computed fields
    const transformedSignals = signals.map((s: any) => ({
      ...s,
      zScore: s.syncCorrelation || s.lagCorrelation || 0,
      spreadPct: Math.abs((s.syncCorrelation || 0) - (s.lagCorrelation || 0)) * 100,
      score: {
        syncCorrelation: s.syncCorrelation,
        lagCorrelation: s.lagCorrelation,
        correlationScore: s.correlationScore,
        volumeRatioA: s.volumeRatioA,
        volumeRatioB: s.volumeRatioB,
        volumeScoreA: s.volumeScoreA,
        volumeScoreB: s.volumeScoreB,
        volumeScore: s.volumeScore,
        leader: s.leader,
        lagger: s.lagger,
      },
    }));

    res.json(transformedSignals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

// Get triggered signals
router.get('/triggered', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const db = getDatabase();
    const signals = db.prepare(`
      SELECT s.id, s.timestamp,
             s.correlation_sync as syncCorrelation,
             s.correlation_lag as lagCorrelation,
             s.correlation_score as correlationScore,
             s.volume_ratio_a as volumeRatioA,
             s.volume_ratio_b as volumeRatioB,
             s.volume_score_a as volumeScoreA,
             s.volume_score_b as volumeScoreB,
             s.volume_score as volumeScore,
             s.total_score as totalScore,
             s.triggered, s.strategy_used as strategyUsed, s.strategy_type as strategyType,
             s.entry_confirmed as entryConfirmed, s.entry_reason as entryReason,
             s.leader_move as leaderMove, s.lagger_move as laggerMove,
             s.expected_move as expectedMove,
             s.leader, s.lagger,
             p.stock_a as stockA, p.stock_b as stockB
      FROM signals s
      JOIN stock_pairs p ON s.pair_id = p.id
      WHERE s.triggered = 1
      ORDER BY s.timestamp DESC
      LIMIT ?
    `).all(limit);

    // Transform signals to include computed fields
    const transformedSignals = signals.map((s: any) => ({
      ...s,
      zScore: s.syncCorrelation || s.lagCorrelation || 0,
      spreadPct: Math.abs((s.syncCorrelation || 0) - (s.lagCorrelation || 0)) * 100,
      score: {
        syncCorrelation: s.syncCorrelation,
        lagCorrelation: s.lagCorrelation,
        correlationScore: s.correlationScore,
        volumeRatioA: s.volumeRatioA,
        volumeRatioB: s.volumeRatioB,
        volumeScoreA: s.volumeScoreA,
        volumeScoreB: s.volumeScoreB,
        volumeScore: s.volumeScore,
        leader: s.leader,
        lagger: s.lagger,
      },
    }));

    res.json(transformedSignals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch triggered signals' });
  }
});

export default router;
