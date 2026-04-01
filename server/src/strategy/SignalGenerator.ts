import ScoringEngine, { PairScore } from '../core/scoring/ScoringEngine';
import UnifiedDataFetcher from '../data/UnifiedDataFetcher';
import EntryChecker from './EntryChecker';
import { getDatabase } from '../database/connection';

export interface TradingSignal {
  id?: number;
  timestamp: Date;
  pairId: number;
  stockA: string;
  stockB: string;
  score: PairScore;
  strategyType: 'positive_lag' | 'negative_corr' | null;
  triggered: boolean;
  entryConfirmed: boolean; // New: whether entry conditions are met
  leaderPrice?: number;
  laggerPrice?: number;
  leaderMove?: number;
  laggerMove?: number;
  expectedMove?: number;
  entryReason?: string;
}

export class SignalGenerator {
  private scoringEngine: ScoringEngine;
  private entryChecker: EntryChecker;
  private dataService: UnifiedDataFetcher;

  constructor(dataService: UnifiedDataFetcher) {
    this.scoringEngine = new ScoringEngine();
    this.entryChecker = new EntryChecker();
    this.dataService = dataService;
  }

  /**
   * Generate signal for a stock pair
   */
  async generateSignal(
    pairId: number,
    stockA: string,
    stockB: string
  ): Promise<TradingSignal | null> {
    // Validate: prevent self-matching (same stock paired with itself)
    if (stockA === stockB) {
      console.warn(`⚠️ Skipping invalid pair: ${stockA}/${stockB} - same stock paired with itself`);
      return null;
    }

    // Get price histories
    const historyA = this.dataService.getPriceHistory(stockA);
    const historyB = this.dataService.getPriceHistory(stockB);

    if (historyA.length < 10 || historyB.length < 10) {
      return null; // Not enough data
    }

    // Get latest prices
    const latestA = this.dataService.getLatestPrice(stockA);
    const latestB = this.dataService.getLatestPrice(stockB);

    if (!latestA || !latestB) {
      return null;
    }

    // Calculate returns
    const pricesA = historyA.map(h => h.price);
    const pricesB = historyB.map(h => h.price);
    const returnsA = this.calculateReturns(pricesA);
    const returnsB = this.calculateReturns(pricesB);

    // Calculate average volumes
    const volumesA = historyA.map(h => h.volume);
    const volumesB = historyB.map(h => h.volume);
    const avgVolumeA = volumesA.reduce((a, b) => a + b, 0) / volumesA.length || 1;
    const avgVolumeB = volumesB.reduce((a, b) => a + b, 0) / volumesB.length || 1;

    // Calculate score
    const score = this.scoringEngine.calculatePairScore(
      stockA,
      stockB,
      returnsA,
      returnsB,
      latestA.volume,
      avgVolumeA,
      latestB.volume,
      avgVolumeB
    );

    // Determine strategy
    const strategyType = this.scoringEngine.determineStrategy(score);

    // Check entry conditions
    const expectedMoveA = this.entryChecker.calculateExpectedMove(returnsA);
    const expectedMoveB = this.entryChecker.calculateExpectedMove(returnsB);
    const expectedMove = Math.max(expectedMoveA, expectedMoveB);

    let entryConfirmed = false;
    let entryReason: string | undefined;
    let leaderMove: number | undefined;
    let laggerMove: number | undefined;

    if (strategyType === 'positive_lag' && score.leader && score.lagger) {
      // Get leader and lagger returns
      const leaderReturns = score.leader === stockA ? returnsA : returnsB;
      const laggerReturns = score.lagger === stockA ? returnsA : returnsB;

      const entryCheck = this.entryChecker.checkEntry(score, leaderReturns, laggerReturns, expectedMove);
      entryConfirmed = entryCheck.canEnter;
      entryReason = entryCheck.reason;
      leaderMove = entryCheck.leaderMove;
      laggerMove = entryCheck.laggerMove;
    } else if (strategyType === 'negative_corr') {
      const entryCheck = this.entryChecker.checkEntry(score, returnsA, returnsB, expectedMove);
      entryConfirmed = entryCheck.canEnter;
      entryReason = entryCheck.reason;
    }

    // Create signal
    const signal: TradingSignal = {
      timestamp: new Date(),
      pairId,
      stockA,
      stockB,
      score,
      strategyType,
      triggered: score.meetsThreshold,
      entryConfirmed,
      entryReason,
      leaderMove,
      laggerMove,
      expectedMove,
      leaderPrice: score.leader === stockA ? latestA.price : latestB.price,
      laggerPrice: score.lagger === stockA ? latestA.price : latestB.price,
    };

    // Save to database
    const savedId = this.saveSignal(signal);
    signal.id = savedId;

    if (signal.triggered) {
      console.log(`🚨 TRADING SIGNAL: ${stockA}/${stockB} - Score: ${score.totalScore}`);
      console.log(`   Strategy: ${strategyType}, Leader: ${score.leader}, Lagger: ${score.lagger}`);
      console.log(`   Entry Confirmed: ${entryConfirmed ? 'YES' : 'NO'}`);
      if (entryReason) console.log(`   Reason: ${entryReason}`);
    }

    return signal;
  }

  /**
   * Generate signals for all active pairs
   */
  async generateAllSignals(): Promise<TradingSignal[]> {
    const db = getDatabase();
    const pairs = db.prepare('SELECT * FROM stock_pairs WHERE is_active = 1').all();

    const signals: TradingSignal[] = [];

    for (const pair of pairs as any[]) {
      const signal = await this.generateSignal(
        pair.id,
        pair.stock_a,
        pair.stock_b
      );
      if (signal) {
        signals.push(signal);
      }
    }

    return signals;
  }

  /**
   * Get recent signals from database
   */
  getRecentSignals(limit: number = 100): TradingSignal[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT s.*, p.stock_a, p.stock_b
      FROM signals s
      JOIN stock_pairs p ON s.pair_id = p.id
      ORDER BY s.timestamp DESC
      LIMIT ?
    `).all(limit);

    return rows.map(this.rowToSignal);
  }

  /**
   * Get triggered signals
   */
  getTriggeredSignals(limit: number = 50): TradingSignal[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT s.*, p.stock_a, p.stock_b
      FROM signals s
      JOIN stock_pairs p ON s.pair_id = p.id
      WHERE s.triggered = 1
      ORDER BY s.timestamp DESC
      LIMIT ?
    `).all(limit);

    return rows.map(this.rowToSignal);
  }

  private calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
  }

  private saveSignal(signal: TradingSignal): number {
    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO signals (
        pair_id, timestamp, correlation_sync, correlation_lag, correlation_score,
        volume_ratio_a, volume_ratio_b, volume_score_a, volume_score_b, volume_score,
        total_score, triggered, strategy_used, strategy_type,
        entry_confirmed, entry_reason, leader_move, lagger_move, expected_move,
        leader, lagger
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      signal.pairId,
      signal.timestamp.toISOString(),
      signal.score.syncCorrelation,
      signal.score.lagCorrelation,
      signal.score.correlationScore,
      signal.score.volumeRatioA,
      signal.score.volumeRatioB,
      signal.score.volumeScoreA,
      signal.score.volumeScoreB,
      signal.score.volumeScore,
      signal.score.totalScore,
      signal.triggered ? 1 : 0,
      signal.strategyType,
      signal.strategyType,
      signal.entryConfirmed ? 1 : 0,
      signal.entryReason || null,
      signal.leaderMove || null,
      signal.laggerMove || null,
      signal.expectedMove || null,
      signal.score.leader || null,
      signal.score.lagger || null
    );

    return result.lastInsertRowid as number;
  }

  private rowToSignal(row: any): TradingSignal {
    return {
      id: row.id,
      timestamp: new Date(row.timestamp),
      pairId: row.pair_id,
      stockA: row.stock_a,
      stockB: row.stock_b,
      score: {
        stockA: row.stock_a,
        stockB: row.stock_b,
        syncCorrelation: row.correlation_sync,
        lagCorrelation: row.correlation_lag,
        correlationScore: row.correlation_score || 0,
        volumeRatioA: row.volume_ratio_a,
        volumeRatioB: row.volume_ratio_b,
        volumeScoreA: row.volume_score_a || 0,
        volumeScoreB: row.volume_score_b || 0,
        volumeScore: row.volume_score || 0,
        totalScore: row.total_score,
        isNegativeCorr: row.correlation_sync < -0.5,
        isPositiveLag: row.correlation_lag > 0.5,
        meetsThreshold: row.triggered === 1,
        leader: row.leader,
        lagger: row.lagger,
      } as PairScore,
      strategyType: row.strategy_used || row.strategy_type,
      triggered: row.triggered === 1,
      entryConfirmed: row.entry_confirmed === 1,
      entryReason: row.entry_reason,
      leaderMove: row.leader_move,
      laggerMove: row.lagger_move,
      expectedMove: row.expected_move,
    };
  }
}

export default SignalGenerator;
