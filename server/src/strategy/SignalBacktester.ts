import config from '../config';
import ReturnCalculator from '../core/data/ReturnCalculator';
import ScoringEngine from '../core/scoring/ScoringEngine';
import EntryChecker from './EntryChecker';
import DatabentoHistorical from '../data/DatabentoHistorical';
import YahooFinanceClient, { HistoricalData } from '../data/YahooFinanceClient';
import type { HistoricalRangeSource } from '../data/historicalProvider';

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

export interface RunForPairProgressEvent {
  kind: 'symbol_start' | 'symbol_done' | 'compute' | 'heartbeat' | 'prefetch';
  stockA: string;
  stockB: string;
  symbol?: string;
  barCount?: number;
  prefetchProgress?: { completed: number; total: number };
}

export interface BacktestConfig {
  concurrency?: number;  // Max concurrent symbol fetches (default: 5)
  prefetch?: boolean;    // Prefetch all symbols before computing (default: true)
}

/**
 * OPTIMIZED Signal Backtester
 *
 * Performance improvements:
 * 1. Concurrent symbol prefetching (5x faster)
 * 2. Batch data fetching with controlled concurrency
 * 3. Reusable Databento client with caching
 */
export class SignalBacktester {
  private scoringEngine = new ScoringEngine();
  private entryChecker = new EntryChecker();

  // Reusable clients
  private databentoClient: DatabentoHistorical | null = null;
  private yahooClient: YahooFinanceClient | null = null;
  private dataSource: 'databento' | 'yahoo' = 'databento';

  // Yahoo reliable intraday bar (5m for better correlation stability)
  private readonly yahooInterval = '5m';
  private readonly intervalSeconds = 300;
  private readonly lookbackPoints = Math.max(
    2,
    Math.floor((config.trading.lookbackWindow * 60) / this.intervalSeconds)
  );

  // Concurrency settings
  private concurrency: number;
  private prefetchEnabled: boolean;

  constructor(backtestConfig?: BacktestConfig) {
    this.concurrency = backtestConfig?.concurrency ?? 5;
    this.prefetchEnabled = backtestConfig?.prefetch ?? true;
  }

  /**
   * Initialize with specific data source
   */
  useDataSource(source: 'databento' | 'yahoo'): this {
    this.dataSource = source;
    if (source === 'databento' && !this.databentoClient) {
      this.databentoClient = new DatabentoHistorical(this.concurrency);
    }
    if (source === 'yahoo' && !this.yahooClient) {
      this.yahooClient = new YahooFinanceClient();
    }
    return this;
  }

  /**
   * Clear internal cache (call before new backtest session)
   */
  clearCache(): void {
    this.databentoClient?.clearCache();
  }

  private toFinite(value: unknown, fallback: number = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  /**
   * Fetch historical data for a single symbol
   */
  private async fetchHistorical(
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<HistoricalData[]> {
    if (this.dataSource === 'databento' && this.databentoClient) {
      return this.databentoClient.getHistoricalRange(symbol, startTime, endTime, '1m');
    }
    if (this.yahooClient) {
      return this.yahooClient.getHistoricalData(symbol, '1d', this.yahooInterval);
    }
    throw new Error('No data source configured');
  }

  /**
   * Prefetch all unique symbols from pairs for faster processing
   */
  async prefetchSymbols(
    pairs: Array<{ stockA: string; stockB: string }>,
    startTime: Date,
    endTime: Date,
    onProgress?: (completed: number, total: number, symbol: string) => void
  ): Promise<void> {
    if (this.dataSource !== 'databento' || !this.databentoClient) {
      return; // Yahoo doesn't support batch prefetch
    }

    // Get unique symbols
    const symbols = new Set<string>();
    for (const pair of pairs) {
      symbols.add(pair.stockA);
      symbols.add(pair.stockB);
    }

    const symbolList = Array.from(symbols);
    console.log(`[Backtester] Prefetching ${symbolList.length} unique symbols...`);

    await this.databentoClient.prefetchSymbols(symbolList, startTime, endTime, onProgress);
  }

  /**
   * Run backtest for multiple pairs with OPTIMIZED concurrent fetching
   */
  async runForPairs(
    pairs: Array<{ stockA: string; stockB: string }>,
    startTime: Date,
    endTime: Date,
    options?: {
      onProgress?: (e: RunForPairProgressEvent) => void;
      onPairComplete?: (pair: { stockA: string; stockB: string }, signals: BacktestSignalPoint[]) => void;
    }
  ): Promise<Map<string, BacktestSignalPoint[]>> {
    const onProgress = options?.onProgress;
    const onPairComplete = options?.onPairComplete;

    // Step 1: Prefetch all symbols if enabled
    if (this.prefetchEnabled && this.dataSource === 'databento') {
      onProgress?.({ kind: 'prefetch', stockA: '', stockB: '', prefetchProgress: { completed: 0, total: 0 } });

      await this.prefetchSymbols(pairs, startTime, endTime, (completed, total, symbol) => {
        onProgress?.({
          kind: 'prefetch',
          stockA: '',
          stockB: '',
          symbol,
          prefetchProgress: { completed, total },
        });
      });
    }

    // Step 2: Process all pairs (data should be cached now)
    const results = new Map<string, BacktestSignalPoint[]>();

    for (const pair of pairs) {
      try {
        const signals = await this.runForPair(pair.stockA, pair.stockB, startTime, endTime, {
          onProgress,
        });

        results.set(`${pair.stockA}/${pair.stockB}`, signals);

        if (onPairComplete) {
          onPairComplete(pair, signals);
        }
      } catch (error: any) {
        console.error(`[Backtester] Failed ${pair.stockA}/${pair.stockB}:`, error.message);
        results.set(`${pair.stockA}/${pair.stockB}`, []);
      }
    }

    return results;
  }

  async runForPair(
    stockA: string,
    stockB: string,
    startTime: Date,
    endTime: Date,
    options?: { onProgress?: (e: RunForPairProgressEvent) => void }
  ): Promise<BacktestSignalPoint[]> {
    const onProgress = options?.onProgress;

    onProgress?.({ kind: 'symbol_start', stockA, stockB, symbol: stockA });
    onProgress?.({ kind: 'symbol_start', stockA, stockB, symbol: stockB });

    // Heartbeat mechanism: send heartbeat every 5 seconds while waiting for data
    let heartbeatTimer: NodeJS.Timeout | null = null;
    if (onProgress) {
      heartbeatTimer = setInterval(() => {
        onProgress({ kind: 'heartbeat', stockA, stockB });
      }, 5000);
    }

    try {
      // Fetch both symbols concurrently (even if not prefetched)
      const [historyA, historyB] = await Promise.all([
        this.fetchHistorical(stockA, startTime, endTime),
        this.fetchHistorical(stockB, startTime, endTime),
      ]);

      // Stop heartbeat timer
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      onProgress?.({
        kind: 'symbol_done',
        stockA,
        stockB,
        symbol: stockA,
        barCount: historyA.length,
      });
      onProgress?.({
        kind: 'symbol_done',
        stockA,
        stockB,
        symbol: stockB,
        barCount: historyB.length,
      });

      onProgress?.({ kind: 'compute', stockA, stockB });

      return this.computeSignals(stockA, stockB, historyA, historyB);
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  }

  /**
   * Compute signals from historical data (CPU-bound, no I/O)
   */
  private computeSignals(
    stockA: string,
    stockB: string,
    historyA: HistoricalData[],
    historyB: HistoricalData[]
  ): BacktestSignalPoint[] {
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
      const volumesA = windowTimes.slice(1).map((t) => this.toFinite(seriesA.get(t)!.volume));
      const volumesB = windowTimes.slice(1).map((t) => this.toFinite(seriesB.get(t)!.volume));

      const returnsA = ReturnCalculator.calculateReturns(pricesA);
      const returnsB = ReturnCalculator.calculateReturns(pricesB);

      const latestA = seriesA.get(commonTimes[i])!;
      const latestB = seriesB.get(commonTimes[i])!;
      const avgVolumeA = volumesA.reduce((s, v) => s + v, 0) / volumesA.length || 1;
      const avgVolumeB = volumesB.reduce((s, v) => s + v, 0) / volumesB.length || 1;

      const score = this.scoringEngine.calculatePairScore(
        stockA,
        stockB,
        returnsA,
        returnsB,
        this.toFinite(latestA.volume),
        avgVolumeA,
        this.toFinite(latestB.volume),
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