import { Router } from 'express';
import { DatabentoHistorical } from '../../data/DatabentoHistorical';
import { ScoringEngine, PairScore } from '../../core/scoring/ScoringEngine';
import { CorrelationCalculator } from '../../core/correlation/CorrelationCalculator';
import ReturnCalculator from '../../core/data/ReturnCalculator';
import VolumeAnalyzer from '../../core/data/VolumeAnalyzer';
import type { HistoricalData } from '../../data/YahooFinanceClient';

const router = Router();
const historicalProvider = new DatabentoHistorical();
const scoringEngine = new ScoringEngine();

interface TestPairRequest {
  stockA: string;
  stockB: string;
  date: string; // YYYY-MM-DD format
  samplingInterval?: number; // seconds, default 30
  lookbackWindow?: number; // minutes, default 30
  lagIntervals?: number; // number of intervals, default 2 (1 minute)
}

interface PricePoint {
  time: string;
  price: number;
}

interface CorrelationPoint {
  time: string;
  syncCorrelation: number;
  lagCorrelation: number;
  correlationScore: number;
  volumeScore: number;
  totalScore: number;
  meetsThreshold: boolean;
}

interface TestPairResponse {
  stockA: string;
  stockB: string;
  date: string;
  finalSyncCorrelation: number;
  finalLagCorrelation: number;
  correlationType: 'positive_lag' | 'negative_sync' | 'none';
  finalScore: number;
  finalCorrelationScore: number;
  finalVolumeScore: number;
  finalMeetsThreshold: boolean;
  rollingCorrelations: CorrelationPoint[];
  priceDataA: PricePoint[];
  priceDataB: PricePoint[];
  normalizedA: PricePoint[];
  normalizedB: PricePoint[];
  volumeDataA: number[];
  volumeDataB: number[];
  thresholdCrossings: number;
  maxScore: number;
  avgScore: number;
  leader?: string;
  lagger?: string;
  error?: string;
}

/**
 * POST /api/test/pair
 * Test a trading pair on a specific date with rolling correlation
 */
router.post('/pair', async (req, res) => {
  const { stockA, stockB, date, samplingInterval, lookbackWindow, lagIntervals } = req.body as TestPairRequest;

  // Parameters with defaults
  const samplingSec = samplingInterval || 30;
  const lookbackMin = lookbackWindow || 30;
  const maxLag = lagIntervals || 2;

  // Validate input
  if (!stockA || !stockB || !date) {
    return res.status(400).json({
      error: 'Missing required fields: stockA, stockB, date',
    });
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({
      error: 'Invalid date format. Use YYYY-MM-DD',
    });
  }

  try {
    // Parse date and create time range for US market hours (14:30 - 21:00 UTC)
    const [year, month, day] = date.split('-').map(Number);
    const startTime = new Date(Date.UTC(year, month - 1, day, 14, 30, 0));
    const endTime = new Date(Date.UTC(year, month - 1, day, 21, 0, 0));

    // Check if it's a weekend
    const dayOfWeek = startTime.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return res.status(400).json({
        error: 'Selected date is a weekend. US markets are closed.',
      });
    }

    console.log(`[Test] Fetching data for ${stockA}/${stockB} on ${date}`);
    console.log(`[Test] Params: sampling=${samplingSec}s, lookback=${lookbackMin}min, lag=${maxLag}`);

    // Clear cache for fresh data
    historicalProvider.clearCache();

    // Fetch historical data for both stocks in parallel
    const [dataA, dataB] = await Promise.all([
      historicalProvider.getHistoricalRange(stockA.toUpperCase(), startTime, endTime, '1m'),
      historicalProvider.getHistoricalRange(stockB.toUpperCase(), startTime, endTime, '1m'),
    ]);

    if (dataA.length === 0 || dataB.length === 0) {
      return res.status(404).json({
        error: `No data found for ${dataA.length === 0 ? stockA : stockB} on ${date}`,
      });
    }

    // Align data by timestamp
    const minLength = Math.min(dataA.length, dataB.length);
    const alignedDataA = dataA.slice(0, minLength);
    const alignedDataB = dataB.slice(0, minLength);

    // Sample data according to sampling interval
    const samplingRatio = Math.max(1, Math.round(samplingSec / 60));
    const sampledDataA: HistoricalData[] = [];
    const sampledDataB: HistoricalData[] = [];

    for (let i = 0; i < minLength; i += samplingRatio) {
      sampledDataA.push(alignedDataA[i]);
      sampledDataB.push(alignedDataB[i]);
    }

    console.log(`[Test] Sampled data: ${sampledDataA.length} points`);

    // Calculate window size in data points
    const windowSize = Math.floor((lookbackMin * 60) / samplingSec);
    console.log(`[Test] Window size: ${windowSize} points (${lookbackMin} minutes)`);

    // Prepare price data for charts
    const priceDataA: PricePoint[] = sampledDataA.map((d: HistoricalData) => ({
      time: d.date.toISOString(),
      price: d.close,
    }));

    const priceDataB: PricePoint[] = sampledDataB.map((d: HistoricalData) => ({
      time: d.date.toISOString(),
      price: d.close,
    }));

    // Calculate normalized prices
    const firstPriceA = sampledDataA[0].close;
    const firstPriceB = sampledDataB[0].close;

    const normalizedA: PricePoint[] = sampledDataA.map((d: HistoricalData) => ({
      time: d.date.toISOString(),
      price: ((d.close - firstPriceA) / firstPriceA) * 100,
    }));

    const normalizedB: PricePoint[] = sampledDataB.map((d: HistoricalData) => ({
      time: d.date.toISOString(),
      price: ((d.close - firstPriceB) / firstPriceB) * 100,
    }));

    // Calculate rolling correlations
    const rollingCorrelations: CorrelationPoint[] = [];
    let thresholdCrossings = 0;
    let maxScore = 0;
    let totalScore = 0;
    let lastMeetsThreshold = false;

    // Start from windowSize index (need enough data for first window)
    for (let i = windowSize; i < sampledDataA.length; i++) {
      // Get window data (lookback from current position)
      const windowStart = i - windowSize;
      const windowDataA = sampledDataA.slice(windowStart, i);
      const windowDataB = sampledDataB.slice(windowStart, i);

      // Calculate returns for this window
      const returnsA = ReturnCalculator.calculateReturns(windowDataA.map(d => d.close));
      const returnsB = ReturnCalculator.calculateReturns(windowDataB.map(d => d.close));

      if (returnsA.length < 10 || returnsB.length < 10) {
        continue; // Skip if not enough data
      }

      // Calculate correlations
      const syncResult = CorrelationCalculator.calculateSyncCorrelation(returnsA, returnsB);
      const lagResult = CorrelationCalculator.detectLeadLag(returnsA, returnsB, maxLag);

      const syncCorr = syncResult.correlation;
      const lagCorr = lagResult?.discountedCorrelation || 0;

      // Determine which correlation to use for scoring
      const syncScore = Math.abs(syncCorr) * 80;
      const lagScore = Math.abs(lagCorr) * 80;

      // Use sync if negative, lag if positive
      const effectiveSyncScore = syncCorr < 0 ? syncScore : 0;
      const effectiveLagScore = lagCorr > 0 ? lagScore : 0;
      const correlationScore = Math.max(effectiveSyncScore, effectiveLagScore);

      // Calculate volume scores using VolumeAnalyzer formula
      // Average volume from window data
      const avgVolumeA = windowDataA.reduce((sum, d) => sum + d.volume, 0) / windowDataA.length;
      const avgVolumeB = windowDataB.reduce((sum, d) => sum + d.volume, 0) / windowDataB.length;

      // Current volume is the volume at the current position (the bar being analyzed)
      const currentVolumeA = sampledDataA[i]?.volume || 0;
      const currentVolumeB = sampledDataB[i]?.volume || 0;

      // Calculate volume ratios
      const volumeRatioA = VolumeAnalyzer.calculateRatio(currentVolumeA, avgVolumeA);
      const volumeRatioB = VolumeAnalyzer.calculateRatio(currentVolumeB, avgVolumeB);

      // Calculate volume scores (max 10 each)
      const volumeScoreA = VolumeAnalyzer.calculateScore(volumeRatioA);
      const volumeScoreB = VolumeAnalyzer.calculateScore(volumeRatioB);
      const volumeScore = volumeScoreA + volumeScoreB; // Max 20

      const totalScoreVal = correlationScore + volumeScore;

      const meetsThreshold = totalScoreVal >= 87;

      // Count threshold crossings (transition from false to true)
      if (meetsThreshold && !lastMeetsThreshold) {
        thresholdCrossings++;
      }
      lastMeetsThreshold = meetsThreshold;

      maxScore = Math.max(maxScore, totalScoreVal);
      totalScore += totalScoreVal;

      rollingCorrelations.push({
        time: sampledDataA[i].date.toISOString(),
        syncCorrelation: syncCorr,
        lagCorrelation: lagResult?.correlation || 0,
        correlationScore,
        volumeScore,
        totalScore: totalScoreVal,
        meetsThreshold,
      });
    }

    const avgScore = rollingCorrelations.length > 0 ? totalScore / rollingCorrelations.length : 0;

    console.log(`[Test] Calculated ${rollingCorrelations.length} correlation points`);
    console.log(`[Test] Max score: ${maxScore.toFixed(1)}, Avg score: ${avgScore.toFixed(1)}, Crossings: ${thresholdCrossings}`);

    // Get final values (last window)
    const lastCorr = rollingCorrelations.length > 0 ? rollingCorrelations[rollingCorrelations.length - 1] : null;

    // Determine correlation type
    let correlationType: 'positive_lag' | 'negative_sync' | 'none';
    if (lastCorr && lastCorr.syncCorrelation < -0.3) {
      correlationType = 'negative_sync';
    } else if (lastCorr && lastCorr.lagCorrelation > 0.4) {
      correlationType = 'positive_lag';
    } else {
      correlationType = 'none';
    }

    // Detect lead-lag from full day data
    const allReturnsA = ReturnCalculator.calculateReturns(sampledDataA.map(d => d.close));
    const allReturnsB = ReturnCalculator.calculateReturns(sampledDataB.map(d => d.close));
    const fullLagResult = CorrelationCalculator.detectLeadLag(allReturnsA, allReturnsB, maxLag);

    const leader = fullLagResult?.leader === 'A' ? stockA.toUpperCase() :
                   fullLagResult?.leader === 'B' ? stockB.toUpperCase() : undefined;
    const lagger = fullLagResult?.lagger === 'A' ? stockA.toUpperCase() :
                   fullLagResult?.lagger === 'B' ? stockB.toUpperCase() : undefined;

    const response: TestPairResponse = {
      stockA: stockA.toUpperCase(),
      stockB: stockB.toUpperCase(),
      date,
      finalSyncCorrelation: lastCorr?.syncCorrelation || 0,
      finalLagCorrelation: lastCorr?.lagCorrelation || 0,
      correlationType,
      finalScore: lastCorr?.totalScore || 0,
      finalCorrelationScore: lastCorr?.correlationScore || 0,
      finalVolumeScore: lastCorr?.volumeScore || 0,
      finalMeetsThreshold: lastCorr?.meetsThreshold || false,
      rollingCorrelations,
      priceDataA,
      priceDataB,
      normalizedA,
      normalizedB,
      volumeDataA: sampledDataA.map(d => d.volume),
      volumeDataB: sampledDataB.map(d => d.volume),
      thresholdCrossings,
      maxScore,
      avgScore,
      leader,
      lagger,
    };

    console.log(`[Test] ${stockA}/${stockB} done: type=${correlationType}, crossings=${thresholdCrossings}`);

    res.json(response);
  } catch (error: any) {
    console.error('[Test] Error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to fetch data',
    });
  }
});

export default router;