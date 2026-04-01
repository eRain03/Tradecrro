import config from '../config';
import ReturnCalculator from '../core/data/ReturnCalculator';
import ScoringEngine from '../core/scoring/ScoringEngine';
import EntryChecker from './EntryChecker';
import YahooFinanceClient, { HistoricalData } from '../data/YahooFinanceClient';

export interface BacktestSignalPoint {
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
  entryReason?: string;
}

export class SignalBacktester {
  private scoringEngine = new ScoringEngine();
  private entryChecker = new EntryChecker();
  private yahoo = new YahooFinanceClient();

  // Yahoo reliable intraday bar
  private readonly yahooInterval = '1m';
  private readonly intervalSeconds = 60;
  private readonly lookbackPoints = Math.max(
    2,
    Math.floor((config.trading.lookbackWindow * 60) / this.intervalSeconds)
  );

  async runForPair(
    stockA: string,
    stockB: string,
    startTime: Date,
    endTime: Date
  ): Promise<BacktestSignalPoint[]> {
    const [historyA, historyB] = await Promise.all([
      this.yahoo.getHistoricalRange(stockA, startTime, endTime, this.yahooInterval),
      this.yahoo.getHistoricalRange(stockB, startTime, endTime, this.yahooInterval),
    ]);

    const seriesA = this.toMap(historyA);
    const seriesB = this.toMap(historyB);
    const commonTimes = [...seriesA.keys()].filter((t) => seriesB.has(t)).sort((a, b) => a - b);

    if (commonTimes.length < this.lookbackPoints + 1) {
      return [];
    }

    const output: BacktestSignalPoint[] = [];

    for (let i = this.lookbackPoints; i < commonTimes.length; i++) {
      const windowTimes = commonTimes.slice(i - this.lookbackPoints, i + 1);

      const pricesA = windowTimes.map((t) => seriesA.get(t)!.close);
      const pricesB = windowTimes.map((t) => seriesB.get(t)!.close);
      const volumesA = windowTimes.slice(1).map((t) => seriesA.get(t)!.volume);
      const volumesB = windowTimes.slice(1).map((t) => seriesB.get(t)!.volume);

      const returnsA = ReturnCalculator.calculateReturns(pricesA);
      const returnsB = ReturnCalculator.calculateReturns(pricesB);

      const latestA = seriesA.get(commonTimes[i])!;
      const latestB = seriesB.get(commonTimes[i])!;
      let avgVolumeA = volumesA.reduce((s, v) => s + v, 0) / volumesA.length || 0;
      let avgVolumeB = volumesB.reduce((s, v) => s + v, 0) / volumesB.length || 0;
      let currentVolumeA = latestA.volume;
      let currentVolumeB = latestB.volume;

      // Yahoo forex historical candles often carry zero volume; use return activity fallback.
      if (avgVolumeA <= 0 || currentVolumeA <= 0) {
        const absReturnsA = returnsA.map(r => Math.abs(r));
        const avgAbsA = absReturnsA.reduce((sum, v) => sum + v, 0) / absReturnsA.length || 0;
        const currentAbsA = absReturnsA[absReturnsA.length - 1] || 0;
        avgVolumeA = avgAbsA * 1_000_000;
        currentVolumeA = currentAbsA * 1_000_000;
      }
      if (avgVolumeB <= 0 || currentVolumeB <= 0) {
        const absReturnsB = returnsB.map(r => Math.abs(r));
        const avgAbsB = absReturnsB.reduce((sum, v) => sum + v, 0) / absReturnsB.length || 0;
        const currentAbsB = absReturnsB[absReturnsB.length - 1] || 0;
        avgVolumeB = avgAbsB * 1_000_000;
        currentVolumeB = currentAbsB * 1_000_000;
      }

      const score = this.scoringEngine.calculatePairScore(
        stockA,
        stockB,
        returnsA,
        returnsB,
        currentVolumeA,
        avgVolumeA,
        currentVolumeB,
        avgVolumeB
      );

      const strategyType = this.scoringEngine.determineStrategy(score);
      const expectedMove = Math.max(
        this.entryChecker.calculateExpectedMove(returnsA),
        this.entryChecker.calculateExpectedMove(returnsB)
      );

      let entryConfirmed = false;
      let entryReason: string | undefined;
      let leaderMove: number | undefined;
      let laggerMove: number | undefined;

      if (strategyType === 'positive_lag' && score.leader && score.lagger) {
        const leaderReturns = score.leader === stockA ? returnsA : returnsB;
        const laggerReturns = score.lagger === stockA ? returnsA : returnsB;
        const entry = this.entryChecker.checkEntry(score, leaderReturns, laggerReturns, expectedMove);
        entryConfirmed = entry.canEnter;
        entryReason = entry.reason;
        leaderMove = entry.leaderMove;
        laggerMove = entry.laggerMove;
      } else if (strategyType === 'negative_corr') {
        const entry = this.entryChecker.checkEntry(score, returnsA, returnsB, expectedMove);
        entryConfirmed = entry.canEnter;
        entryReason = entry.reason;
      }

      output.push({
        timestamp: new Date(commonTimes[i]).toISOString(),
        stockA,
        stockB,
        strategyType,
        syncCorrelation: score.syncCorrelation,
        lagCorrelation: score.lagCorrelation,
        correlationScore: score.correlationScore,
        volumeScoreA: score.volumeScoreA,
        volumeScoreB: score.volumeScoreB,
        volumeScore: score.volumeScore,
        totalScore: score.totalScore,
        triggered: score.meetsThreshold,
        entryConfirmed,
        leader: score.leader,
        lagger: score.lagger,
        leaderMove,
        laggerMove,
        expectedMove,
        entryReason,
      });
    }

    return output;
  }

  private toMap(history: HistoricalData[]): Map<number, HistoricalData> {
    const map = new Map<number, HistoricalData>();
    for (const row of history) {
      if (!Number.isFinite(row.close) || row.close <= 0) continue;
      map.set(new Date(row.date).getTime(), row);
    }
    return map;
  }
}

export default SignalBacktester;
