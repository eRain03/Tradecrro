<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, onUnmounted } from 'vue';
import * as echarts from 'echarts';

// Form state
const stockA = ref('');
const stockB = ref('');
const selectedDate = ref('');

// Parameter state
const samplingInterval = ref(30); // seconds
const lookbackWindow = ref(30); // minutes
const lagIntervals = ref(2); // number of intervals (1 minute)

// Cached raw data (1-minute bars)
interface RawBar {
  time: string;
  closeA: number;
  closeB: number;
  volumeA: number;
  volumeB: number;
}
const cachedRawData = ref<RawBar[]>([]);
const cachedStockA = ref('');
const cachedStockB = ref('');
const cachedDate = ref('');

// Result state
const isLoading = ref(false);
const error = ref('');
const result = ref<TestResult | null>(null);

// Chart mode toggle
const chartMode = ref<'side-by-side' | 'overlay'>('side-by-side');

// Chart references
const chartContainerA = ref<HTMLElement | null>(null);
const chartContainerB = ref<HTMLElement | null>(null);
const chartContainerOverlay = ref<HTMLElement | null>(null);
let chartInstanceA: echarts.ECharts | null = null;
let chartInstanceB: echarts.ECharts | null = null;
let chartInstanceOverlay: echarts.ECharts | null = null;

// Synchronized zoom state
const syncZoomState = ref({ start: 0, end: 100 });

// Available trading days (last 30 days, excluding weekends)
interface TradingDay {
  date: string;
  label: string;
  isWeekend: boolean;
}
const tradingDays = ref<TradingDay[]>([]);

// Types
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

interface TestResult {
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
}

// Initialize trading days
onMounted(() => {
  const days: TradingDay[] = [];
  for (let i = 1; i < 30; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0] || '';
    // Use UTC day of week to match backend logic
    const dayOfWeek = date.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const label = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    });

    days.push({ date: dateStr, label, isWeekend });
  }
  tradingDays.value = days;

  const lastTradingDay = days.find(d => !d.isWeekend);
  if (lastTradingDay) {
    selectedDate.value = lastTradingDay.date;
  }
});

// API base URL
function resolveApiBase(): string {
  const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isViteDev = window.location.port === '5173';
  if (isLocalDev && isViteDev) {
    return 'http://localhost:3001';
  }
  return envUrl ? envUrl.replace(/\/$/, '') : '';
}

// ============ Local Correlation Calculation ============

function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const curr = prices[i];
    const prev = prices[i - 1];
    if (curr !== undefined && prev !== undefined && prev !== 0) {
      returns.push((curr - prev) / prev);
    }
  }
  return returns;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n !== y.length || n < 2) return 0;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => {
    const yi = y[i];
    return yi !== undefined ? sum + xi * yi : sum;
  }, 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  return denominator === 0 ? 0 : numerator / denominator;
}

function detectLeadLag(returnsA: number[], returnsB: number[], maxLag: number): {
  leader: 'A' | 'B';
  lagger: 'A' | 'B';
  correlation: number;
  discountedCorrelation: number;
  lag: number;
} | null {
  let bestResult: {
    leader: 'A' | 'B';
    lagger: 'A' | 'B';
    correlation: number;
    discountedCorrelation: number;
    lag: number;
  } | null = null;
  let maxScore = 0;

  for (let lag = 1; lag <= maxLag; lag++) {
    if (returnsA.length <= lag) continue;
    const leaderSlice = returnsA.slice(0, returnsA.length - lag);
    const laggerSlice = returnsB.slice(lag);
    const corr = pearsonCorrelation(leaderSlice, laggerSlice);
    const discountFactor = 1 - (lag / (maxLag + 1));
    const discountedScore = corr * discountFactor;
    if (discountedScore > maxScore) {
      maxScore = discountedScore;
      bestResult = { leader: 'A', lagger: 'B', correlation: corr, discountedCorrelation: discountedScore, lag };
    }
  }

  for (let lag = 1; lag <= maxLag; lag++) {
    if (returnsB.length <= lag) continue;
    const leaderSlice = returnsB.slice(0, returnsB.length - lag);
    const laggerSlice = returnsA.slice(lag);
    const corr = pearsonCorrelation(leaderSlice, laggerSlice);
    const discountFactor = 1 - (lag / (maxLag + 1));
    const discountedScore = corr * discountFactor;
    if (discountedScore > maxScore) {
      maxScore = discountedScore;
      bestResult = { leader: 'B', lagger: 'A', correlation: corr, discountedCorrelation: discountedScore, lag };
    }
  }

  return bestResult;
}

// Recalculate with cached data
const recalculateFromCache = () => {
  if (cachedRawData.value.length === 0) {
    error.value = 'No cached data. Please run test first.';
    return;
  }

  const rawData = cachedRawData.value;
  const samplingSec = samplingInterval.value;
  const lookbackMin = lookbackWindow.value;
  const maxLag = lagIntervals.value;

  // Sample data
  const samplingRatio = Math.max(1, Math.round(samplingSec / 60));
  const sampledData: RawBar[] = [];
  for (let i = 0; i < rawData.length; i += samplingRatio) {
    const bar = rawData[i];
    if (bar) sampledData.push(bar);
  }

  if (sampledData.length === 0) {
    error.value = 'No data after sampling.';
    return;
  }

  const windowSize = Math.floor((lookbackMin * 60) / samplingSec);

  // Calculate normalized prices
  const firstA = sampledData[0]!.closeA;
  const firstB = sampledData[0]!.closeB;

  const normalizedA: PricePoint[] = sampledData.map(d => ({
    time: d.time,
    price: ((d.closeA - firstA) / firstA) * 100,
  }));

  const normalizedB: PricePoint[] = sampledData.map(d => ({
    time: d.time,
    price: ((d.closeB - firstB) / firstB) * 100,
  }));

  // Calculate rolling correlations
  const rollingCorrelations: CorrelationPoint[] = [];
  let thresholdCrossings = 0;
  let maxScoreVal = 0;
  let totalScoreVal = 0;
  let lastMeetsThreshold = false;

  for (let i = windowSize; i < sampledData.length; i++) {
    const windowStart = i - windowSize;
    const windowData = sampledData.slice(windowStart, i);

    const pricesA = windowData.map(d => d.closeA);
    const pricesB = windowData.map(d => d.closeB);

    const returnsA = calculateReturns(pricesA);
    const returnsB = calculateReturns(pricesB);

    if (returnsA.length < 10) continue;

    const syncCorr = pearsonCorrelation(returnsA, returnsB);
    const lagResult = detectLeadLag(returnsA, returnsB, maxLag);
    const lagCorr = lagResult?.correlation || 0;

    const syncScore = Math.abs(syncCorr) * 80;
    const lagScore = Math.abs(lagResult?.discountedCorrelation || 0) * 80;
    const effectiveSyncScore = syncCorr < 0 ? syncScore : 0;
    const effectiveLagScore = (lagResult?.discountedCorrelation || 0) > 0 ? lagScore : 0;
    const correlationScore = Math.max(effectiveSyncScore, effectiveLagScore);

    // Calculate volume scores
    const avgVolumeA = windowData.reduce((sum, d) => sum + d.volumeA, 0) / windowData.length;
    const avgVolumeB = windowData.reduce((sum, d) => sum + d.volumeB, 0) / windowData.length;
    const currentBar = sampledData[i];
    const currentVolumeA = currentBar?.volumeA || 0;
    const currentVolumeB = currentBar?.volumeB || 0;

    // Volume ratio and score formula: score = (ratio - 1) * 5, max 10
    const volumeRatioA = avgVolumeA > 0 ? currentVolumeA / avgVolumeA : 1;
    const volumeRatioB = avgVolumeB > 0 ? currentVolumeB / avgVolumeB : 1;
    const volumeScoreA = Math.min(Math.max((volumeRatioA - 1) * 5, 0), 10);
    const volumeScoreB = Math.min(Math.max((volumeRatioB - 1) * 5, 0), 10);
    const volumeScore = volumeScoreA + volumeScoreB;

    const score = correlationScore + volumeScore;

    const meetsThreshold = score >= 87;
    if (meetsThreshold && !lastMeetsThreshold) {
      thresholdCrossings++;
    }
    lastMeetsThreshold = meetsThreshold;

    maxScoreVal = Math.max(maxScoreVal, score);
    totalScoreVal += score;

    if (currentBar) {
      rollingCorrelations.push({
        time: currentBar.time,
        syncCorrelation: syncCorr,
        lagCorrelation: lagCorr,
        correlationScore,
        volumeScore,
        totalScore: score,
        meetsThreshold,
      });
    }
  }

  const avgScore = rollingCorrelations.length > 0 ? totalScoreVal / rollingCorrelations.length : 0;
  const lastCorr = rollingCorrelations.length > 0 ? rollingCorrelations[rollingCorrelations.length - 1] : null;

  let correlationType: 'positive_lag' | 'negative_sync' | 'none';
  if (lastCorr && lastCorr.syncCorrelation < -0.3) {
    correlationType = 'negative_sync';
  } else if (lastCorr && lastCorr.lagCorrelation > 0.4) {
    correlationType = 'positive_lag';
  } else {
    correlationType = 'none';
  }

  const allReturnsA = calculateReturns(sampledData.map(d => d.closeA));
  const allReturnsB = calculateReturns(sampledData.map(d => d.closeB));
  const fullLagResult = detectLeadLag(allReturnsA, allReturnsB, maxLag);

  const leader = fullLagResult?.leader === 'A' ? cachedStockA.value :
                 fullLagResult?.leader === 'B' ? cachedStockB.value : undefined;
  const lagger = fullLagResult?.lagger === 'A' ? cachedStockA.value :
                 fullLagResult?.lagger === 'B' ? cachedStockB.value : undefined;

  result.value = {
    stockA: cachedStockA.value,
    stockB: cachedStockB.value,
    date: cachedDate.value,
    finalSyncCorrelation: lastCorr?.syncCorrelation || 0,
    finalLagCorrelation: lastCorr?.lagCorrelation || 0,
    correlationType,
    finalScore: lastCorr?.totalScore || 0,
    finalCorrelationScore: lastCorr?.correlationScore || 0,
    finalVolumeScore: lastCorr?.volumeScore || 0,
    finalMeetsThreshold: lastCorr?.meetsThreshold || false,
    rollingCorrelations,
    priceDataA: sampledData.map(d => ({ time: d.time, price: d.closeA })),
    priceDataB: sampledData.map(d => ({ time: d.time, price: d.closeB })),
    normalizedA,
    normalizedB,
    volumeDataA: sampledData.map(d => d.volumeA),
    volumeDataB: sampledData.map(d => d.volumeB),
    thresholdCrossings,
    maxScore: maxScoreVal,
    avgScore,
    leader,
    lagger,
  };

  nextTick().then(() => renderCharts());
};

// Run test - fetch data only
const runTest = async () => {
  if (!stockA.value || !stockB.value || !selectedDate.value) {
    error.value = 'Please fill in all fields';
    return;
  }

  isLoading.value = true;
  error.value = '';
  result.value = null;

  try {
    const response = await fetch(`${resolveApiBase()}/api/test/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stockA: stockA.value.toUpperCase(),
        stockB: stockB.value.toUpperCase(),
        date: selectedDate.value,
        samplingInterval: 60, // Always get 1-minute data
        lookbackWindow: lookbackWindow.value,
        lagIntervals: lagIntervals.value,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch data');
    }

    // Cache raw data
    cachedRawData.value = data.priceDataA
      .map((p: PricePoint, i: number) => {
        const b = data.priceDataB[i];
        const volA = data.volumeDataA?.[i] || 0;
        const volB = data.volumeDataB?.[i] || 0;
        if (!b) return null;
        return {
          time: p.time,
          closeA: p.price,
          closeB: b.price,
          volumeA: volA,
          volumeB: volB,
        };
      })
      .filter((x: RawBar | null): x is RawBar => x !== null);
    cachedStockA.value = data.stockA;
    cachedStockB.value = data.stockB;
    cachedDate.value = data.date;

    // Calculate locally
    recalculateFromCache();
  } catch (e: any) {
    error.value = e.message || 'Unknown error';
  } finally {
    isLoading.value = false;
  }
};

// Convert UTC to US Eastern Time (ET)
const formatETTime = (isoString: string) => {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'
  });
};

// Render charts based on current mode
const renderCharts = async () => {
  if (!result.value) return;

  if (chartInstanceA) chartInstanceA.dispose();
  if (chartInstanceB) chartInstanceB.dispose();
  if (chartInstanceOverlay) chartInstanceOverlay.dispose();
  chartInstanceA = null;
  chartInstanceB = null;
  chartInstanceOverlay = null;

  await nextTick();

  if (chartMode.value === 'overlay') {
    renderOverlayChart();
  } else {
    renderSideBySideCharts();
  }
};

// Render single overlay chart
const renderOverlayChart = () => {
  if (!chartContainerOverlay.value) return;

  chartInstanceOverlay = echarts.init(chartContainerOverlay.value);

  const {
    normalizedA,
    normalizedB,
    stockA: symbolA,
    stockB: symbolB,
    correlationType,
    rollingCorrelations
  } = result.value!;

  const times = normalizedA.map(p => formatETTime(p.time));
  const isNegCorr = correlationType === 'negative_sync';

  const colorA = '#2563eb';
  const colorB = isNegCorr ? '#dc2626' : '#f59e0b';

  const dataA = normalizedA.map(p => p.price);
  const dataB = normalizedB.map(p => p.price);

  // Create correlation lookup map for tooltip
  const corrMap = new Map<string, CorrelationPoint>();
  rollingCorrelations.forEach(c => {
    corrMap.set(c.time, c);
  });

  const option: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    title: {
      text: `${symbolA} vs ${symbolB}`,
      left: 'center',
      top: 10,
      textStyle: { fontSize: 16, fontWeight: 600, color: '#374151' },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: '#e5e7eb',
      borderWidth: 1,
      textStyle: { color: '#374151' },
      formatter: (params: any) => {
        const time = params[0]?.axisValue;
        const valA = params[0]?.value?.toFixed(2) || '0.00';
        const valB = params[1]?.value?.toFixed(2) || '0.00';

        // Get original ISO time for correlation lookup
        const dataIndex = params[0]?.dataIndex;
        const isoTime = normalizedA[dataIndex]?.time || '';
        const corr = isoTime ? corrMap.get(isoTime) : null;

        let corrHtml = '';
        if (corr) {
          const syncColor = corr.syncCorrelation < 0 ? '#dc2626' : '#16a34a';
          const scoreColor = corr.meetsThreshold ? '#16a34a' : '#6b7280';
          corrHtml = `
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
              <div style="font-weight: 600; margin-bottom: 4px; color: #374151;">Correlation</div>
              <div style="color: ${syncColor};">Sync: ${corr.syncCorrelation.toFixed(3)}</div>
              <div style="color: #f59e0b;">Lag: ${corr.lagCorrelation.toFixed(3)}</div>
              <div style="color: ${scoreColor}; font-weight: 600;">
                Score: <span style="color: #3b82f6;">${corr.correlationScore.toFixed(1)}</span>
                + <span style="color: #f59e0b;">${corr.volumeScore.toFixed(1)}</span>
                = ${corr.totalScore.toFixed(1)} ${corr.meetsThreshold ? '✓' : ''}
              </div>
            </div>
          `;
        }

        return `
          <div style="font-weight: 600; margin-bottom: 4px">${time} ET</div>
          <div style="color: ${colorA}">${symbolA}: ${valA}%</div>
          <div style="color: ${colorB}">${symbolB}: ${valB}%</div>
          ${corrHtml}
        `;
      },
    },
    legend: {
      data: [symbolA, symbolB],
      top: 35,
      textStyle: { color: '#6b7280' },
    },
    grid: {
      left: '5%',
      right: '5%',
      bottom: '15%',
      top: 70,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#d1d5db' } },
      axisLabel: {
        rotate: 45,
        interval: Math.floor(times.length / 6),
        fontSize: 11,
        color: '#6b7280'
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'Change (%)',
      nameTextStyle: { color: '#6b7280', fontSize: 11 },
      axisLine: { show: false },
      axisLabel: { formatter: '{value}%', fontSize: 11, color: '#6b7280' },
      splitLine: { lineStyle: { type: 'dashed', color: '#e5e7eb' } },
    },
    series: [
      {
        name: symbolA,
        type: 'line',
        data: dataA,
        smooth: true,
        lineStyle: { color: colorA, width: 2 },
        itemStyle: { color: colorA },
        symbol: 'none',
      },
      {
        name: symbolB,
        type: 'line',
        data: dataB,
        smooth: true,
        lineStyle: { color: colorB, width: 2 },
        itemStyle: { color: colorB },
        symbol: 'none',
      },
    ],
    dataZoom: [
      { type: 'inside', start: syncZoomState.value.start, end: syncZoomState.value.end },
      { type: 'slider', start: syncZoomState.value.start, end: syncZoomState.value.end, bottom: 10, height: 20 },
    ],
  };

  chartInstanceOverlay.setOption(option);
};

// Render side by side charts
const renderSideBySideCharts = () => {
  if (!chartContainerA.value || !chartContainerB.value) return;

  chartInstanceA = echarts.init(chartContainerA.value);
  chartInstanceB = echarts.init(chartContainerB.value);

  const {
    normalizedA,
    normalizedB,
    stockA: symbolA,
    stockB: symbolB,
    correlationType
  } = result.value!;

  const times = normalizedA.map(p => formatETTime(p.time));
  const isNegativeCorr = correlationType === 'negative_sync';

  const colorA = '#2563eb';
  const colorB = isNegativeCorr ? '#dc2626' : '#f59e0b';

  const dataA = normalizedA.map(p => p.price);
  const dataB = normalizedB.map(p => p.price);

  const createChartOption = (symbol: string, color: string, data: number[], times: string[]): echarts.EChartsOption => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: '#e5e7eb',
      borderWidth: 1,
      textStyle: { color: '#374151' },
      formatter: (params: any) => {
        const time = params[0]?.axisValue;
        const val = params[0]?.value?.toFixed(2) || '0.00';
        return `
          <div style="font-weight: 600; margin-bottom: 4px">${time} ET</div>
          <div style="color: ${color}">${symbol}: ${val}%</div>
        `;
      },
    },
    grid: {
      left: '8%',
      right: '4%',
      bottom: '20%',
      top: '5%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#d1d5db' } },
      axisLabel: {
        rotate: 45,
        interval: Math.floor(times.length / 5),
        fontSize: 10,
        color: '#6b7280'
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { formatter: '{value}%', fontSize: 10, color: '#6b7280' },
      splitLine: { lineStyle: { type: 'dashed', color: '#e5e7eb' } },
    },
    series: [{
      name: symbol,
      type: 'line',
      data,
      smooth: true,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      symbol: 'none',
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: `${color}20` },
          { offset: 1, color: `${color}05` },
        ]),
      },
    }],
    dataZoom: [
      { type: 'inside', start: syncZoomState.value.start, end: syncZoomState.value.end },
      { type: 'slider', start: syncZoomState.value.start, end: syncZoomState.value.end, bottom: 6, height: 18 },
    ],
  });

  chartInstanceA.setOption(createChartOption(symbolA, colorA, dataA, times));
  chartInstanceB.setOption(createChartOption(symbolB, colorB, dataB, times));

  setTimeout(() => {
    chartInstanceA?.resize();
    chartInstanceB?.resize();
  }, 100);

  chartInstanceA.on('datazoom', (e: any) => {
    if (chartInstanceB && e) {
      const start = e.start ?? e.batch?.[0]?.start;
      const end = e.end ?? e.batch?.[0]?.end;
      if (start !== undefined && end !== undefined) {
        chartInstanceB.dispatchAction({ type: 'dataZoom', start, end });
      }
    }
  });

  chartInstanceB.on('datazoom', (e: any) => {
    if (chartInstanceA && e) {
      const start = e.start ?? e.batch?.[0]?.start;
      const end = e.end ?? e.batch?.[0]?.end;
      if (start !== undefined && end !== undefined) {
        chartInstanceA.dispatchAction({ type: 'dataZoom', start, end });
      }
    }
  });
};

// Toggle chart mode
const toggleChartMode = () => {
  chartMode.value = chartMode.value === 'side-by-side' ? 'overlay' : 'side-by-side';
};

// Watch chart mode
watch(chartMode, async () => {
  if (result.value) {
    await nextTick();
    renderCharts();
  }
});

// Resize handler
const handleResize = () => {
  if (chartMode.value === 'overlay') {
    chartInstanceOverlay?.resize();
  } else {
    chartInstanceA?.resize();
    chartInstanceB?.resize();
  }
};

onMounted(() => window.addEventListener('resize', handleResize));
onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  chartInstanceA?.dispose();
  chartInstanceB?.dispose();
  chartInstanceOverlay?.dispose();
});

// Computed properties
const correlationColor = computed(() => {
  if (!result.value) return '#6b7280';
  if (result.value.correlationType === 'negative_sync') return '#dc2626';
  if (result.value.correlationType === 'positive_lag') return '#16a34a';
  return '#6b7280';
});

const syncCorrelationColor = computed(() => {
  if (!result.value) return '#6b7280';
  const sync = result.value.finalSyncCorrelation;
  if (sync < -0.5) return '#dc2626';
  if (sync < 0) return '#f87171';
  if (sync > 0.5) return '#16a34a';
  return '#6b7280';
});

const lagCorrelationColor = computed(() => {
  if (!result.value) return '#6b7280';
  const lag = result.value.finalLagCorrelation;
  if (lag > 0.5) return '#16a34a';
  if (lag > 0) return '#86efac';
  return '#6b7280';
});

const isNegativeCorr = computed(() => result.value?.correlationType === 'negative_sync');

// Helper: get correlation at specific time
const getCorrelationAtTime = (time: string): CorrelationPoint | null => {
  if (!result.value?.rollingCorrelations) return null;
  // Find the correlation point closest to the given time
  const targetTime = new Date(time).getTime();
  let closest: CorrelationPoint | null = null;
  let minDiff = Infinity;

  for (const point of result.value.rollingCorrelations) {
    const diff = Math.abs(new Date(point.time).getTime() - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point;
    }
  }

  return closest;
};
</script>

<template>
  <div class="test-page">
    <!-- Simple Header -->
    <div class="page-header">
      <h1>Pair Test</h1>
    </div>

    <!-- Input Section -->
    <div class="input-card">
      <div class="input-row">
        <div class="input-item">
          <label>Stock A</label>
          <input
            v-model="stockA"
            type="text"
            placeholder="TQQQ"
            @keyup.enter="runTest"
          />
        </div>

        <div class="input-item">
          <label>Stock B</label>
          <input
            v-model="stockB"
            type="text"
            placeholder="SQQQ"
            @keyup.enter="runTest"
          />
        </div>

        <div class="input-item">
          <label>Date</label>
          <select v-model="selectedDate">
            <option value="" disabled>Select</option>
            <option
              v-for="day in tradingDays"
              :key="day.date"
              :value="day.date"
              :disabled="day.isWeekend"
            >
              {{ day.label }}{{ day.isWeekend ? ' (Closed)' : '' }}
            </option>
          </select>
        </div>

        <div class="input-item">
          <button @click="runTest" :disabled="isLoading" class="run-btn">
            <span v-if="isLoading" class="loading">
              <span class="spinner"></span>
              Loading
            </span>
            <span v-else>Run</span>
          </button>
        </div>
      </div>

      <!-- Parameters Row -->
      <div class="params-row">
        <div class="param-item">
          <label>Sampling (sec)</label>
          <input
            type="number"
            v-model.number="samplingInterval"
            min="10"
            max="60"
            class="param-input"
          />
        </div>

        <div class="param-item">
          <label>Lookback (min)</label>
          <input
            type="number"
            v-model.number="lookbackWindow"
            min="10"
            max="60"
            class="param-input"
          />
        </div>

        <div class="param-item">
          <label>Lag intervals</label>
          <input
            type="number"
            v-model.number="lagIntervals"
            min="1"
            max="20"
            class="param-input"
          />
        </div>

        <div class="param-info">
          <span class="info-label">Window points:</span>
          <span class="info-value">{{ Math.floor(lookbackWindow * 60 / samplingInterval) }}</span>
        </div>

        <button
          v-if="cachedRawData.length > 0"
          @click="recalculateFromCache"
          class="recalc-btn"
        >
          Recalculate
        </button>
      </div>

      <div v-if="error" class="error-msg">{{ error }}</div>
    </div>

    <!-- Results Section -->
    <div v-if="result" class="results-section">
      <!-- Stats -->
      <div class="stats-row">
        <div class="stat">
          <span class="label">Pair</span>
          <span class="pair-display">
            <span class="stock tag-a">{{ result.stockA }}</span>
            <span class="sep">/</span>
            <span class="stock tag-b">{{ result.stockB }}</span>
          </span>
        </div>

        <div class="stat">
          <span class="label">Date</span>
          <span class="value">{{ result.date }}</span>
        </div>

        <div class="stat">
          <span class="label">Sync Corr</span>
          <span class="value" :style="{ color: syncCorrelationColor }">
            {{ result.finalSyncCorrelation.toFixed(3) }}
          </span>
        </div>

        <div class="stat">
          <span class="label">Lag Corr</span>
          <span class="value" :style="{ color: lagCorrelationColor }">
            {{ result.finalLagCorrelation.toFixed(3) }}
          </span>
        </div>

        <div class="stat">
          <span class="label">Score</span>
          <span class="value breakdown">
            <span class="corr-part">{{ result.finalCorrelationScore.toFixed(1) }}</span>
            <span class="plus">+</span>
            <span class="vol-part">{{ result.finalVolumeScore.toFixed(1) }}</span>
            <span class="score-badge" :class="{ passed: result.finalMeetsThreshold }">
              {{ result.finalMeetsThreshold ? 'PASS' : 'FAIL' }}
            </span>
          </span>
        </div>

        <div class="stat">
          <span class="label">Type</span>
          <span class="badge" :class="result.correlationType">
            {{ result.correlationType === 'negative_sync' ? 'Neg Sync' : result.correlationType === 'positive_lag' ? 'Pos Lag' : 'None' }}
          </span>
        </div>
      </div>

      <!-- Day Summary -->
      <div class="summary-row">
        <div class="summary-item">
          <span class="summary-label">Triggers</span>
          <span class="summary-value highlight">{{ result.thresholdCrossings }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Max score</span>
          <span class="summary-value">{{ result.maxScore.toFixed(1) }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Avg score</span>
          <span class="summary-value">{{ result.avgScore.toFixed(1) }}</span>
        </div>
        <div v-if="result.leader && result.lagger" class="summary-item">
          <span class="summary-label">Lead/Lag</span>
          <span class="summary-value">
            <span class="leader">{{ result.leader }}</span>
            <span class="arrow">→</span>
            <span class="lagger">{{ result.lagger }}</span>
          </span>
        </div>
      </div>

      <!-- Toggle -->
      <div class="toggle-row">
        <button
          @click="chartMode = 'side-by-side'"
          :class="{ active: chartMode === 'side-by-side' }"
        >
          Split
        </button>
        <button
          @click="chartMode = 'overlay'"
          :class="{ active: chartMode === 'overlay' }"
        >
          Overlay
        </button>
      </div>

      <!-- Charts -->
      <div class="charts-area">
        <!-- Split View -->
        <div v-if="chartMode === 'side-by-side'" class="charts-split">
          <div class="chart-box">
            <div class="chart-title" style="color: #2563eb;">{{ result.stockA }}</div>
            <div ref="chartContainerA" class="chart-inner"></div>
          </div>
          <div class="chart-box">
            <div class="chart-title" :style="{ color: isNegativeCorr ? '#dc2626' : '#f59e0b' }">{{ result.stockB }}</div>
            <div ref="chartContainerB" class="chart-inner"></div>
          </div>
        </div>

        <!-- Overlay View -->
        <div v-else class="chart-box chart-full">
          <div ref="chartContainerOverlay" class="chart-inner chart-large"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.test-page {
  padding: 20px;
  background: #f8fafc;
  min-height: 100vh;
}

.page-header h1 {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 16px 0;
}

.input-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.input-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.input-item {
  flex: 1;
  min-width: 120px;
}

.input-item label {
  display: block;
  font-size: 0.75rem;
  color: #64748b;
  margin-bottom: 4px;
}

.input-item input,
.input-item select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  color: #1e293b;
  background: #fff;
}

.input-item input:focus,
.input-item select:focus {
  outline: none;
  border-color: #3b82f6;
}

.run-btn {
  width: 100%;
  padding: 8px 16px;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.2s;
}

.run-btn:hover:not(:disabled) {
  background: #2563eb;
}

.run-btn:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.loading {
  display: flex;
  align-items: center;
  gap: 6px;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-msg {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #dc2626;
  font-size: 0.875rem;
}

.params-row {
  display: flex;
  gap: 24px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
  align-items: flex-end;
  flex-wrap: wrap;
}

.param-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.param-item label {
  font-size: 0.7rem;
  color: #64748b;
}

.param-input {
  width: 80px;
  padding: 6px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  font-size: 0.875rem;
  color: #1e293b;
  text-align: center;
}

.param-input:focus {
  outline: none;
  border-color: #3b82f6;
}

.param-info {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #f8fafc;
  border-radius: 4px;
}

.param-info .info-label {
  font-size: 0.75rem;
  color: #64748b;
}

.param-info .info-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #3b82f6;
}

.recalc-btn {
  padding: 6px 16px;
  background: #f59e0b;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.recalc-btn:hover {
  background: #d97706;
}

.results-section {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
}

.stats-row {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat .label {
  font-size: 0.75rem;
  color: #64748b;
}

.stat .value {
  font-size: 1rem;
  font-weight: 500;
  color: #1e293b;
}

.pair-display {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pair-display .stock {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
}

.pair-display .tag-a {
  background: #dbeafe;
  color: #2563eb;
}

.pair-display .tag-b {
  background: #fee2e2;
  color: #dc2626;
}

.pair-display .sep {
  color: #94a3b8;
}

.strength {
  font-size: 0.75rem;
  color: #64748b;
  margin-left: 4px;
}

.badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
}

.badge.negative_sync {
  background: #fee2e2;
  color: #dc2626;
}

.badge.positive_lag {
  background: #dcfce7;
  color: #16a34a;
}

.badge.none {
  background: #f1f5f9;
  color: #64748b;
}

.score-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.65rem;
  font-weight: 600;
  background: #f1f5f9;
  color: #94a3b8;
}

.score-badge.passed {
  background: #dcfce7;
  color: #16a34a;
}

.value.breakdown {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 0.9rem;
}

.value.breakdown .corr-part {
  color: #3b82f6;
  font-weight: 600;
}

.value.breakdown .plus {
  color: #94a3b8;
  font-size: 0.8rem;
}

.value.breakdown .vol-part {
  color: #f59e0b;
  font-weight: 600;
}

.lead-lag {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.875rem;
}

.lead-lag .leader {
  font-weight: 600;
  color: #16a34a;
}

.lead-lag .lagger {
  font-weight: 600;
  color: #f59e0b;
}

.lead-lag .arrow {
  color: #94a3b8;
}

.summary-row {
  display: flex;
  gap: 32px;
  padding: 12px 16px;
  background: #f8fafc;
  border-radius: 6px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.summary-label {
  font-size: 0.75rem;
  color: #64748b;
}

.summary-value {
  font-size: 0.9rem;
  font-weight: 600;
  color: #1e293b;
}

.summary-value.highlight {
  color: #16a34a;
  font-size: 1rem;
}

.summary-value .leader {
  color: #16a34a;
}

.summary-value .lagger {
  color: #f59e0b;
}

.summary-value .arrow {
  color: #94a3b8;
  margin: 0 4px;
}

.badge.negative_sync {
  background: #fee2e2;
  color: #dc2626;
}

.badge.positive_lag {
  background: #dcfce7;
  color: #16a34a;
}

.badge.none {
  background: #f1f5f9;
  color: #64748b;
}

.toggle-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.toggle-row button {
  padding: 6px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #64748b;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-row button:hover {
  border-color: #cbd5e1;
}

.toggle-row button.active {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}

.charts-area {
  margin-top: 8px;
}

.charts-split {
  display: flex !important;
  flex-direction: row !important;
  gap: 16px;
}

.chart-box {
  flex: 1 1 50% !important;
  max-width: 50%;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px;
  background: #fafafa;
}

.chart-title {
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 8px;
}

.chart-inner {
  height: 300px;
  width: 100% !important;
}

.chart-large {
  height: 400px;
}

.chart-full {
  max-width: 100%;
}

@media (max-width: 768px) {
  .input-row {
    flex-direction: column;
  }

  .charts-split {
    flex-direction: column !important;
  }

  .chart-box {
    max-width: 100%;
  }

  .stats-row {
    flex-direction: column;
    gap: 12px;
  }
}
</style>