<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';

const PAGE_SIZE = 100;

const isLoading = ref(false);
const backtestResult = ref<BacktestResult | null>(null);
const showError = ref(false);
const errorMessage = ref('');

/** Database paginated query vs market replay (Databento / Yahoo, frontend pagination with 100 items per page after fetching all data) */
const backtestMode = ref<'db' | 'replay'>('db');
const replayPage = ref(1);
const replaySignalsFull = ref<BacktestResult['signals']>([]);

// Filter state (database mode passes to backend; replay mode filters in frontend then paginates)
const showTriggeredOnly = ref(true);

// Market hours configuration (US Market: 9:30 AM - 4:00 PM ET = 14:30 - 21:00 UTC)
const MARKET_OPEN_UTC = '14:30';
const MARKET_CLOSE_UTC = '21:00';

// Available trading days (last 30 days, excluding weekends)
interface TradingDay {
  date: string;
  label: string;
  isWeekend: boolean;
}
const tradingDays = ref<TradingDay[]>([]);

// Form state
const selectedStartDate = ref('');
const selectedEndDate = ref('');
const selectedPairs = ref<string[]>([]);

// Initialize trading days
onMounted(() => {
  const days: TradingDay[] = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0] || '';
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const label = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    days.push({ date: dateStr, label, isWeekend });
  }
  tradingDays.value = days;

  // Default to yesterday (Databento has ~1 day delay, today's data not yet available)
  // Find the first non-weekend day that's NOT today (i.e., skip i=0)
  const yesterday = days.slice(1).find(d => !d.isWeekend);
  if (yesterday) {
    selectedStartDate.value = yesterday.date;
    selectedEndDate.value = yesterday.date;
  }
});

// Get user's timezone for display
const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezoneOffset = new Date().getTimezoneOffset();
const offsetHours = Math.floor(Math.abs(timezoneOffset) / 60);
const offsetMins = Math.abs(timezoneOffset) % 60;
const offsetSign = timezoneOffset <= 0 ? '+' : '-';
const timezoneDisplay = `UTC${offsetSign}${offsetHours}${offsetMins > 0 ? ':' + String(offsetMins).padStart(2, '0') : ''}`;

// Convert UTC market hours to local time for display
const getLocalMarketHours = () => {
  const today = new Date();
  const openParts = MARKET_OPEN_UTC.split(':').map(Number);
  const closeParts = MARKET_CLOSE_UTC.split(':').map(Number);
  const openH = openParts[0] ?? 14;
  const openM = openParts[1] ?? 30;
  const closeH = closeParts[0] ?? 21;
  const closeM = closeParts[1] ?? 0;

  const openUTC = new Date(today);
  openUTC.setUTCHours(openH, openM, 0, 0);

  const closeUTC = new Date(today);
  closeUTC.setUTCHours(closeH, closeM, 0, 0);

  const formatTime = (d: Date) => d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  return {
    open: formatTime(openUTC),
    close: formatTime(closeUTC)
  };
};

const localMarketHours = computed(getLocalMarketHours);

const getRangeBody = () => {
  // Use market hours automatically
  const startDatetime = `${selectedStartDate.value}T${MARKET_OPEN_UTC}:00`;
  const endDatetime = `${selectedEndDate.value}T${MARKET_CLOSE_UTC}:00`;
  return {
    startTime: startDatetime,
    endTime: endDatetime,
    pairs: selectedPairs.value.length > 0 ? selectedPairs.value : undefined,
    concurrency: backtestConcurrency.value,
  };
};

const getSignalDedupKey = (signal: BacktestResult['signals'][number]) => {
  const secondTimestamp = signal.timestamp.slice(0, 19);
  return `${secondTimestamp}|${signal.stockA}|${signal.stockB}`;
};

const dedupeSignals = (signals: BacktestResult['signals']) => {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = getSignalDedupKey(signal);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Auto-detect API base URL based on frontend location */
function resolveApiBase(): string {
  const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();

  // 检测是否在本地开发环境 (localhost:5173)
  const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isViteDev = window.location.port === '5173';

  if (isLocalDev && isViteDev) {
    return 'http://localhost:3001';
  }

  return envUrl ? envUrl.replace(/\/$/, '') : '';
}

/** Database: server-side pagination, max 100 items per page */
const fetchDbPage = async (page: number) => {
  const body = {
    ...getRangeBody(),
    page,
    pageSize: PAGE_SIZE,
    triggeredOnly: showTriggeredOnly.value,
  };

  const response = await fetch(`${resolveApiBase()}/api/backtest/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Backtest failed with status ${response.status}`);
  }

  const data = (await response.json()) as BacktestResult;
  backtestResult.value = data;
  replaySignalsFull.value = [];
  replayPage.value = 1;
};

type ReplayStreamMsg =
  | { type: 'start'; totalPairs: number; startTime: string; endTime: string; concurrency?: number; optimized?: boolean }
  | { type: 'heartbeat'; timestamp: string }
  | {
      type: 'progress';
      step: string;
      subStep?: string;
      symbol?: string;
      barCount?: number;
      current: number;
      total: number;
      stockA: string;
      stockB: string;
      cumulativeSignals: number;
      elapsedSec: number;
      percentApprox: number;
      lastPairSignalCount?: number;
      error?: string;
      prefetchCompleted?: number;
      prefetchTotal?: number;
    }
  | { type: 'signals'; pairIndex: number; stockA: string; stockB: string; signals: BacktestResult['signals']; cumulativeSignals: number }
  | { type: 'complete'; result: BacktestResult }
  | { type: 'error'; message: string };

const replayProgress = ref<{
  totalPairs: number;
  current: number;
  pairLabel: string;
  cumulativeSignals: number;
  lastPairSignalCount: number;
  elapsedSec: number;
  percentApprox: number;
  step: string;
  detail: string;
  concurrency?: number;
  prefetchCompleted?: number;
  prefetchTotal?: number;
} | null>(null);

// Concurrency setting for optimized backtest
const backtestConcurrency = ref(5);

// Stream signals for real-time display
const streamSignals = ref<BacktestResult['signals']>([]);
const showStreamResults = ref(false);

/** Market replay: NDJSON streaming with real-time signal display */
const fetchReplay = async () => {
  // Reset stream signals
  streamSignals.value = [];
  showStreamResults.value = true;

  replayProgress.value = {
    totalPairs: 0,
    current: 0,
    pairLabel: '',
    cumulativeSignals: 0,
    lastPairSignalCount: 0,
    elapsedSec: 0,
    percentApprox: 0,
    step: 'connecting',
    detail: 'Connecting to server…',
  };

  const streamUrl = `${resolveApiBase()}/api/backtest/replay-stream`;
  const response = await fetch(streamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(getRangeBody()),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((error as { error?: string }).error || `Replay failed with status ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Browser does not support streaming response');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const applyProgress = (msg: Extract<ReplayStreamMsg, { type: 'progress' }>) => {
    const pair = `${msg.stockA} / ${msg.stockB}`;
    let detail = '';
    if (msg.step === 'prefetch') {
      const completed = msg.prefetchCompleted ?? 0;
      const total = msg.prefetchTotal ?? 0;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      detail = `Prefetching symbols (${completed}/${total}, ${pct}%) - warming cache for faster processing…`;
    } else if (msg.step === 'pair_start' || msg.step === 'symbol_start') {
      detail =
        'Starting this pair: will fetch K-lines for both symbols (Databento single request may take 1-5 minutes, check terminal [Databento] logs)';
    } else if (msg.step === 'symbol_done') {
      detail = `${msg.symbol ?? ''} returned ${msg.barCount ?? 0} 1m K-lines`;
    } else if (msg.step === 'compute') {
      detail = 'Computing correlation, volume scores and signals…';
    } else if (msg.step === 'pair_done') {
      detail = `Pair completed, generated ${msg.lastPairSignalCount ?? 0} timestamp signals`;
    } else if (msg.step === 'heartbeat') {
      detail = `Waiting for data... (${msg.elapsedSec}s elapsed)`;
    } else {
      detail = 'Processing…';
    }
    replayProgress.value = {
      totalPairs: msg.total,
      current: msg.current,
      pairLabel: pair,
      cumulativeSignals: msg.cumulativeSignals,
      lastPairSignalCount: msg.lastPairSignalCount ?? 0,
      elapsedSec: msg.elapsedSec,
      percentApprox: msg.percentApprox,
      step: msg.step,
      detail,
      prefetchCompleted: msg.prefetchCompleted,
      prefetchTotal: msg.prefetchTotal,
    };
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as ReplayStreamMsg;
      if (msg.type === 'start') {
        replayProgress.value = {
          totalPairs: msg.totalPairs,
          current: 0,
          pairLabel: '',
          cumulativeSignals: 0,
          lastPairSignalCount: 0,
          elapsedSec: 0,
          percentApprox: 0,
          step: msg.optimized ? 'prefetch' : 'start',
          detail: msg.optimized
            ? `Total ${msg.totalPairs} pairs · Concurrency: ${msg.concurrency ?? 1}x · Optimized mode with prefetch`
            : `Total ${msg.totalPairs} pairs, starting backtest…`,
          concurrency: msg.concurrency,
          prefetchCompleted: 0,
          prefetchTotal: 0,
        };
      } else if (msg.type === 'progress') {
        applyProgress(msg);
      } else if (msg.type === 'heartbeat') {
        // Keepalive message, ignore (just prevents connection timeout)
        console.log('[replay] heartbeat received');
      } else if (msg.type === 'signals') {
        // Real-time signals: append to streamSignals immediately
        streamSignals.value = [...streamSignals.value, ...msg.signals];
      } else if (msg.type === 'complete') {
        const data = { ...msg.result };
        data.signals = dedupeSignals(data.signals || []);
        backtestResult.value = data;
        replaySignalsFull.value = data.signals;
        replayPage.value = 1;
      } else if (msg.type === 'error') {
        throw new Error(msg.message);
      }
    }
  }

  if (buffer.trim()) {
    const msg = JSON.parse(buffer) as ReplayStreamMsg;
    if (msg.type === 'complete') {
      const data = { ...msg.result };
      data.signals = dedupeSignals(data.signals || []);
      backtestResult.value = data;
      replaySignalsFull.value = data.signals;
      replayPage.value = 1;
    } else if (msg.type === 'error') {
      throw new Error(msg.message);
    }
  }
};

const runBacktest = async () => {
  isLoading.value = true;
  showError.value = false;
  backtestResult.value = null;
  replaySignalsFull.value = [];
  streamSignals.value = [];
  showTriggeredOnly.value = true;

  try {
    if (backtestMode.value === 'db') {
      await fetchDbPage(1);
    } else {
      await fetchReplay();
    }
  } catch (error: any) {
    console.error('Backtest error:', error);
    showError.value = true;
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
    replayProgress.value = null;
  }
};

const goToDbPage = async (nextPage: number) => {
  const p = backtestResult.value?.pagination;
  if (!p || nextPage < 1 || nextPage > p.totalPages) return;
  isLoading.value = true;
  showError.value = false;
  try {
    await fetchDbPage(nextPage);
  } catch (error: any) {
    showError.value = true;
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
};

const toggleTriggeredOnly = async () => {
  showTriggeredOnly.value = !showTriggeredOnly.value;
  if (backtestMode.value === 'replay') {
    replayPage.value = 1;
    return;
  }
  isLoading.value = true;
  showError.value = false;
  try {
    await fetchDbPage(1);
  } catch (error: any) {
    showError.value = true;
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
};

const replayFiltered = computed(() => {
  const list = replaySignalsFull.value;
  if (!showTriggeredOnly.value) return list;
  return list.filter((s) => s.triggered);
});

const replayTotalPages = computed(() =>
  Math.max(1, Math.ceil(replayFiltered.value.length / PAGE_SIZE))
);

const pagedReplaySignals = computed(() => {
  const list = replayFiltered.value;
  const start = (replayPage.value - 1) * PAGE_SIZE;
  return list.slice(start, start + PAGE_SIZE);
});

const goToReplayPage = (next: number) => {
  if (next < 1 || next > replayTotalPages.value) return;
  replayPage.value = next;
};

const formatTime = (timestamp: string) => {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const getStrategyTypeLabel = (strategyType: string | null) => {
  if (strategyType === 'positive_lag') return 'Positive Correlation (Lag)';
  if (strategyType === 'negative_corr') return 'Negative Correlation (Sync)';
  return 'Not Triggered';
};

const getStrategyTypeClass = (strategyType: string | null) => {
  if (strategyType === 'positive_lag') return 'type-lag';
  if (strategyType === 'negative_corr') return 'type-neg';
  return '';
};

const tableSignals = computed(() => {
  if (backtestMode.value === 'replay' && replaySignalsFull.value.length > 0) {
    return pagedReplaySignals.value;
  }
  return backtestResult.value?.signals ?? [];
});

const listTitleExtra = computed(() => {
  if (backtestMode.value === 'db' && backtestResult.value?.pagination) {
    const { page, totalPages, total } = backtestResult.value.pagination;
    return `Page ${page}/${totalPages || 1} · Total: ${total} signals`;
  }
  if (backtestMode.value === 'replay' && replaySignalsFull.value.length > 0) {
    return `Page ${replayPage.value}/${replayTotalPages.value} · Up to ${PAGE_SIZE} per page (frontend pagination)`;
  }
  return '';
});

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
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  performance?: {
    elapsedSec: number;
    concurrency: number;
    prefetched: boolean;
  };
  signals: Array<{
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
  }>;
}
</script>

<template>
  <div class="backtest-view">
    <div class="view-header">
      <h1>
        <span class="title-separator">◆</span>
        BACKTEST
        <span class="title-separator">◆</span>
      </h1>
    </div>

    <!-- Configuration Form -->
    <div class="config-card">
      <!-- Market Hours Info -->
      <div class="market-info-banner">
        <span class="market-icon">🕐</span>
        <span class="market-text">
          US Market Hours: <strong>{{ localMarketHours.open }} - {{ localMarketHours.close }}</strong> ({{ userTimezone }})
          <span class="market-note">Auto-applied to selected dates</span>
        </span>
      </div>

      <div class="form-section">
        <h3>Select Trading Days</h3>
        <div class="date-selector">
          <div class="date-field">
            <label>Start Date</label>
            <select v-model="selectedStartDate" class="date-select">
              <option v-for="day in tradingDays" :key="day.date" :value="day.date" :disabled="day.isWeekend">
                {{ day.label }}{{ day.isWeekend ? ' (Weekend)' : '' }}
              </option>
            </select>
          </div>
          <div class="separator">→</div>
          <div class="date-field">
            <label>End Date</label>
            <select v-model="selectedEndDate" class="date-select">
              <option v-for="day in tradingDays" :key="day.date" :value="day.date" :disabled="day.isWeekend">
                {{ day.label }}{{ day.isWeekend ? ' (Weekend)' : '' }}
              </option>
            </select>
          </div>
        </div>
        <p class="date-hint">
          Selected range: <strong>{{ selectedStartDate }}</strong> to <strong>{{ selectedEndDate }}</strong>
          · Market hours ({{ MARKET_OPEN_UTC }} - {{ MARKET_CLOSE_UTC }} UTC) will be used automatically
        </p>
      </div>

      <div class="form-section mode-section">
        <h3>Data Source</h3>
        <div class="mode-row">
          <label class="mode-option">
            <input type="radio" value="db" v-model="backtestMode" />
            <span>Database Signals (paginated, {{ PAGE_SIZE }} per page)</span>
          </label>
          <label class="mode-option">
            <input type="radio" value="replay" v-model="backtestMode" />
            <span>Market Replay (Databento if API key configured, otherwise Yahoo)</span>
          </label>
        </div>
        <p v-if="backtestMode === 'replay'" class="databento-notice">
          ⚠️ Databento DBEQ.BASIC has ~1 day delay. Today's intraday data may not be available yet.
        </p>

        <!-- Concurrency setting for replay mode -->
        <div v-if="backtestMode === 'replay'" class="concurrency-section">
          <label class="concurrency-label">
            Concurrency: <strong>{{ backtestConcurrency }}</strong> parallel requests
          </label>
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            v-model.number="backtestConcurrency"
            class="concurrency-slider"
          />
          <div class="concurrency-hints">
            <span>1 (slowest)</span>
            <span>5 (recommended)</span>
            <span>10 (fastest)</span>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button class="run-btn" @click="runBacktest" :disabled="isLoading">
          <span class="btn-icon">{{ isLoading ? '⏳' : '▶' }}</span>
          <span class="btn-text">{{ isLoading ? 'Running...' : 'Run Backtest' }}</span>
        </button>
      </div>
    </div>

    <!-- Error State -->
    <div v-if="showError" class="error-card">
      <span class="error-icon">⚠</span>
      <span class="error-message">{{ errorMessage }}</span>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading-card">
      <template v-if="backtestMode === 'replay' && replayProgress">
        <div class="replay-progress-top">
          <span class="loading-spinner">⏳</span>
          <span class="replay-title">Market Replay Backtest</span>
          <span v-if="replayProgress.concurrency" class="replay-concurrency-badge">
            {{ replayProgress.concurrency }}x concurrency
          </span>
        </div>

        <!-- Prefetch progress (shown during prefetch phase) -->
        <div v-if="replayProgress.step === 'prefetch' && replayProgress.prefetchTotal" class="prefetch-progress">
          <p class="prefetch-label">🚀 Prefetching symbols (warming cache)</p>
          <div class="progress-track prefetch-track" role="progressbar">
            <div class="progress-fill prefetch-fill" :style="{ width: `${Math.round((replayProgress.prefetchCompleted ?? 0) / replayProgress.prefetchTotal * 100)}%` }" />
          </div>
          <p class="prefetch-stats">
            <strong>{{ replayProgress.prefetchCompleted ?? 0 }}</strong> / {{ replayProgress.prefetchTotal }} symbols
            · {{ Math.round((replayProgress.prefetchCompleted ?? 0) / replayProgress.prefetchTotal * 100) }}%
            · {{ replayProgress.elapsedSec }}s elapsed
          </p>
        </div>

        <!-- Normal pair processing progress -->
        <div v-else>
          <div class="progress-track" role="progressbar" :aria-valuenow="replayProgress.percentApprox" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill" :style="{ width: `${replayProgress.percentApprox}%` }" />
          </div>
          <p class="replay-percent">{{ replayProgress.percentApprox }}%</p>
          <p class="replay-main">
            Pair <strong>{{ replayProgress.current }}</strong> / {{ replayProgress.totalPairs }}
            <span v-if="replayProgress.pairLabel" class="replay-pair"> · {{ replayProgress.pairLabel }}</span>
          </p>
          <p class="replay-stats">
            Total signals: <strong>{{ replayProgress.cumulativeSignals }}</strong>
            <span v-if="replayProgress.step === 'pair_done' && replayProgress.lastPairSignalCount">
              · This pair +{{ replayProgress.lastPairSignalCount }}
            </span>
            · Elapsed: <strong>{{ replayProgress.elapsedSec }}</strong>s
          </p>
        </div>
        <p class="loading-sub replay-detail">{{ replayProgress.detail }}</p>

        <!-- Streaming Signals Preview -->
        <div v-if="streamSignals.length > 0" class="stream-signals-preview">
          <div class="stream-header">
            <span class="stream-icon">📊</span>
            <span class="stream-title">Live Signals ({{ streamSignals.length }})</span>
          </div>
          <div class="stream-table-container">
            <table class="stream-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Pair</th>
                  <th>Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(signal, idx) in streamSignals.slice(-10).reverse()" :key="`stream-${idx}`" class="stream-row">
                  <td class="stream-time">{{ formatTime(signal.timestamp) }}</td>
                  <td class="stream-pair">{{ signal.stockA }}/{{ signal.stockB }}</td>
                  <td class="stream-score">
                    <span :class="signal.triggered ? 'score-triggered' : 'score-watching'">
                      {{ signal.totalScore.toFixed(0) }}
                    </span>
                  </td>
                  <td class="stream-status">
                    <span class="status-pill" :class="signal.triggered ? 'triggered' : 'watching'">
                      {{ signal.triggered ? '✓' : '○' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="stream-hint">Showing latest 10 signals (scrolls automatically)</p>
        </div>
      </template>
      <template v-else>
        <span class="loading-spinner">⏳</span>
        <p>Running backtest...</p>
        <p class="loading-sub">Analyzing historical signal data</p>
      </template>
    </div>

    <!-- Results -->
    <div v-if="backtestResult" class="results-container">
      <!-- Summary Cards -->
      <div class="summary-grid">
        <div class="summary-card highlight">
          <div class="summary-label">Total Signals</div>
          <div class="summary-value">{{ backtestResult.summary.totalSignals }}</div>
          <div class="summary-sub">Within time range</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">Triggered Signals</div>
          <div class="summary-value">{{ backtestResult.summary.triggeredSignals }}</div>
          <div class="summary-sub">Total score ≥ 87</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">Entry Confirmed</div>
          <div class="summary-value">{{ backtestResult.summary.confirmedSignals }}</div>
          <div class="summary-sub">Entry conditions met</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">Positive Correlation</div>
          <div class="summary-value">{{ backtestResult.summary.positiveLagCount }}</div>
          <div class="summary-sub">Leader/Lag strategy</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">Negative Correlation</div>
          <div class="summary-value">{{ backtestResult.summary.negativeCorrCount }}</div>
          <div class="summary-sub">Synchronized strategy</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">Avg Total Score</div>
          <div class="summary-value">{{ backtestResult.summary.avgTotalScore.toFixed(1) }}</div>
          <div class="summary-sub">Average of all signals</div>
        </div>

        <!-- Performance metrics (replay mode only) -->
        <div v-if="backtestResult.performance" class="summary-card performance-card">
          <div class="summary-label">Performance</div>
          <div class="summary-value">{{ backtestResult.performance.elapsedSec }}s</div>
          <div class="summary-sub">
            Concurrency: {{ backtestResult.performance.concurrency }}
            <span v-if="backtestResult.performance.prefetched">· Prefetched</span>
          </div>
        </div>
      </div>

      <!-- Signals Table -->
      <div class="signals-card">
        <div class="table-header">
          <h3>
            Signal List <span class="list-hint">({{ tableSignals.length }} signals)</span>
            <span v-if="listTitleExtra" class="list-hint">· {{ listTitleExtra }}</span>
          </h3>
          <button
            class="filter-btn"
            :class="{ 'active': showTriggeredOnly }"
            @click="toggleTriggeredOnly"
          >
            <span class="filter-icon">{{ showTriggeredOnly ? '✓' : '○' }}</span>
            <span class="filter-text">Triggered Only</span>
            <span class="filter-count">(Triggered: {{ backtestResult.summary.triggeredSignals }} / Total: {{ backtestResult.summary.totalSignals }})</span>
          </button>
        </div>
        <div class="signals-table-container">
          <table v-if="tableSignals.length > 0">
            <thead>
              <tr>
                <th>Time</th>
                <th>Pair</th>
                <th>Strategy Type</th>
                <th>Correlation Score</th>
                <th>Volume Score</th>
                <th>Total Score</th>
                <th>Leader/Lagger</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(signal, idx) in tableSignals" :key="`${signal.id}-${signal.timestamp}-${idx}`">
                <td class="time-cell">{{ formatTime(signal.timestamp) }}</td>
                <td class="pair-cell">
                  <div class="pair-box">
                    <span class="pair-a">{{ signal.stockA }}</span>
                    <span class="pair-vs">/</span>
                    <span class="pair-b">{{ signal.stockB }}</span>
                  </div>
                </td>
                <td>
                  <span class="type-badge" :class="getStrategyTypeClass(signal.strategyType)">
                    {{ getStrategyTypeLabel(signal.strategyType) }}
                  </span>
                </td>
                <td>
                  <div class="score-display">
                    <span class="score-value">{{ signal.correlationScore.toFixed(0) }}/80</span>
                  </div>
                </td>
                <td>
                  <div class="score-display">
                    <span class="score-value">{{ signal.volumeScore.toFixed(0) }}/20</span>
                  </div>
                </td>
                <td>
                  <span class="total-score" :class="getScoreClass(signal.totalScore)">
                    {{ signal.totalScore.toFixed(0) }}
                  </span>
                </td>
                <td class="leadlag-cell">
                  <span v-if="signal.strategyType === 'positive_lag'">
                    {{ signal.leader }} → {{ signal.lagger }}
                  </span>
                  <span v-else>Sync</span>
                </td>
                <td>
                  <span class="status-badge" :class="{ 'triggered': signal.triggered }">
                    {{ signal.triggered ? 'Tradable' : 'Watching' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="no-signals">
            <span class="no-signals-icon">∅</span>
            <p>{{ showTriggeredOnly ? 'No triggered signals on this page (try disabling "Triggered Only" filter)' : 'No signals' }}</p>
          </div>
        </div>

        <div v-if="backtestResult && backtestMode === 'db' && backtestResult.pagination" class="pagination-bar">
          <button
            type="button"
            class="page-btn"
            :disabled="isLoading || backtestResult.pagination.page <= 1"
            @click="goToDbPage(backtestResult.pagination.page - 1)"
          >
            Previous
          </button>
          <span class="page-info">
            {{ backtestResult.pagination.page }} / {{ backtestResult.pagination.totalPages || 1 }}
          </span>
          <button
            type="button"
            class="page-btn"
            :disabled="isLoading || backtestResult.pagination.page >= backtestResult.pagination.totalPages"
            @click="goToDbPage(backtestResult.pagination.page + 1)"
          >
            Next
          </button>
        </div>

        <div v-if="backtestResult && backtestMode === 'replay' && replaySignalsFull.length > 0" class="pagination-bar">
          <button
            type="button"
            class="page-btn"
            :disabled="replayPage <= 1"
            @click="goToReplayPage(replayPage - 1)"
          >
            Previous
          </button>
          <span class="page-info">{{ replayPage }} / {{ replayTotalPages }}</span>
          <button
            type="button"
            class="page-btn"
            :disabled="replayPage >= replayTotalPages"
            @click="goToReplayPage(replayPage + 1)"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default {
  methods: {
    getScoreClass(score: number) {
      if (score >= 87) return 'score-high';
      if (score >= 70) return 'score-medium';
      return 'score-low';
    }
  }
}
</script>

<style scoped>
/* ═══════════════════════════════════════════════════════════════════════════
   NEO-TERMINAL BACKTEST VIEW
   A refined trading terminal aesthetic with modern polish
   ═══════════════════════════════════════════════════════════════════════════ */

@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');

.backtest-view {
  max-width: 1400px;
  font-family: 'DM Sans', sans-serif;
}

/* ─────────────────────────────────────────────────────────────────────────────
   HEADER - Strong typographic presence
   ───────────────────────────────────────────────────────────────────────────── */

.view-header {
  margin-bottom: 24px;
  display: flex;
  align-items: center;
}

.view-header h1 {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 1.4em;
  font-weight: 700;
  color: #0a0a0a;
  letter-spacing: 3px;
  text-transform: uppercase;
  font-family: 'DM Sans', sans-serif;
}

.title-separator {
  color: #c41e3a;
  font-size: 0.7em;
  animation: pulse-glow 2s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ─────────────────────────────────────────────────────────────────────────────
   CONFIG CARD - Glass morphism with refined borders
   ───────────────────────────────────────────────────────────────────────────── */

.config-card {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 50%, #f5f5f5 100%);
  border: 1px solid rgba(196, 30, 58, 0.15);
  padding: 24px 28px;
  margin-bottom: 24px;
  box-shadow:
    0 1px 3px rgba(0,0,0,0.04),
    0 8px 24px rgba(196, 30, 58, 0.06),
    inset 0 1px 0 rgba(255,255,255,0.8);
  border-radius: 8px;
  position: relative;
  overflow: hidden;
}

.config-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #c41e3a 0%, #e85a6f 50%, #c41e3a 100%);
  opacity: 0.8;
}

/* Market Info Banner */
.market-info-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(135deg, #e8f4f8 0%, #f0f8ff 100%);
  border: 1px solid #b8d4e8;
  border-radius: 6px;
  margin-bottom: 20px;
}

.market-icon {
  font-size: 1.3em;
}

.market-text {
  font-size: 0.85em;
  color: #2c5282;
}

.market-text strong {
  color: #1a365d;
}

.market-note {
  display: block;
  font-size: 0.8em;
  color: #4a6fa5;
  margin-top: 2px;
}

.form-section {
  margin-bottom: 24px;
}

.form-section:last-of-type {
  margin-bottom: 0;
}

.form-section h3 {
  font-size: 0.72em;
  font-weight: 600;
  color: #3a3a3a;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin: 0 0 14px 0;
  padding-bottom: 10px;
  border-bottom: 1px solid #e5e5e5;
  font-family: 'DM Sans', sans-serif;
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-section h3::before {
  content: '◇';
  color: #c41e3a;
  font-size: 0.8em;
}

.date-selector {
  display: flex;
  align-items: flex-end;
  gap: 20px;
  flex-wrap: wrap;
}

.date-selector .separator {
  padding-bottom: 10px;
}

.date-hint {
  margin-top: 12px;
  font-size: 0.75em;
  color: #5a5a5a;
  font-family: 'JetBrains Mono', monospace;
}

.date-hint strong {
  color: #1a1a1a;
}

.date-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.date-field label {
  font-size: 0.68em;
  font-weight: 600;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.date-select {
  padding: 10px 14px;
  border: 1px solid #d5d5d5;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.88em;
  background: #ffffff;
  color: #1a1a1a;
  border-radius: 4px;
  transition: all 0.2s ease;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.04);
}

.date-field input:focus {
  outline: none;
  border-color: #c41e3a;
  box-shadow:
    inset 0 1px 2px rgba(0,0,0,0.04),
    0 0 0 3px rgba(196, 30, 58, 0.12);
}

.separator {
  font-size: 1.4em;
  color: #c41e3a;
  line-height: 1;
  padding-bottom: 6px;
  opacity: 0.6;
}

.mode-section .mode-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.86em;
  color: #2a2a2a;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 4px;
  transition: background 0.2s ease;
}

.mode-option:hover {
  background: rgba(196, 30, 58, 0.04);
}

.mode-option input {
  accent-color: #c41e3a;
  width: 16px;
  height: 16px;
}

.databento-notice {
  margin-top: 12px;
  padding: 10px 14px;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  font-size: 0.85em;
  color: #92400e;
}

.concurrency-section {
  margin-top: 16px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  border: 1px solid #bae6fd;
  border-radius: 6px;
}

.concurrency-label {
  display: block;
  font-size: 0.85em;
  color: #0c4a6e;
  margin-bottom: 8px;
}

.concurrency-slider {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #e0f2fe;
  outline: none;
  cursor: pointer;
  accent-color: #c41e3a;
}

.concurrency-slider::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #c41e3a;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(196, 30, 58, 0.3);
}

.concurrency-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #c41e3a;
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(196, 30, 58, 0.3);
}

.concurrency-hints {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 0.75em;
  color: #0369a1;
}

.list-hint {
  font-weight: 400;
  color: #8b8b8b;
  font-size: 0.85em;
  text-transform: none;
  letter-spacing: 0;
}

/* ─────────────────────────────────────────────────────────────────────────────
   ACTION BUTTON - Bold, confident presence
   ───────────────────────────────────────────────────────────────────────────── */

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #e5e5e5;
}

.run-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 28px;
  background: linear-gradient(135deg, #c41e3a 0%, #a51832 100%);
  border: none;
  color: #ffffff;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.92em;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow:
    0 2px 8px rgba(196, 30, 58, 0.3),
    0 8px 24px rgba(196, 30, 58, 0.15),
    inset 0 1px 0 rgba(255,255,255,0.15);
  border-radius: 6px;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.run-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  transition: left 0.5s ease;
}

.run-btn:hover:not(:disabled)::before {
  left: 100%;
}

.run-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow:
    0 4px 12px rgba(196, 30, 58, 0.35),
    0 12px 32px rgba(196, 30, 58, 0.2),
    inset 0 1px 0 rgba(255,255,255,0.15);
}

.run-btn:active:not(:disabled) {
  transform: translateY(0);
}

.run-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: linear-gradient(135deg, #888 0%, #666 100%);
}

.btn-icon {
  font-size: 1.1em;
}

/* ─────────────────────────────────────────────────────────────────────────────
   ERROR & LOADING STATES
   ───────────────────────────────────────────────────────────────────────────── */

.error-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 24px;
  background: linear-gradient(135deg, #fff5f5 0%, #fee2e2 100%);
  border: 1px solid #fecaca;
  color: #991b1b;
  margin-bottom: 24px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(153, 27, 27, 0.08);
}

.error-icon {
  font-size: 1.4em;
  animation: shake 0.5s ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

.error-message {
  font-weight: 600;
  font-size: 0.95em;
}

.loading-card {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border: 1px solid #e5e5e5;
  padding: 80px 24px;
  text-align: center;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.04);
}

.loading-spinner {
  font-size: 3em;
  display: block;
  margin-bottom: 20px;
  animation: spin 1.5s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.loading-card p {
  color: #5a5a5a;
  font-size: 0.95em;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 10px 0;
  font-weight: 500;
}

.loading-sub {
  color: #8b8b8b;
  font-size: 0.85em;
  font-weight: 400;
}

/* ─────────────────────────────────────────────────────────────────────────────
   REPLAY PROGRESS - Animated progress visualization
   ───────────────────────────────────────────────────────────────────────────── */

.replay-progress-top {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-bottom: 24px;
}

.replay-title {
  font-weight: 600;
  letter-spacing: 1.5px;
  color: #1a1a1a;
  font-size: 0.98em;
  text-transform: uppercase;
}

.replay-concurrency-badge {
  padding: 4px 10px;
  background: linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%);
  color: #fff;
  font-size: 0.75em;
  font-weight: 600;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.prefetch-progress {
  margin: 16px auto;
  max-width: 480px;
}

.prefetch-label {
  font-size: 0.85em;
  color: #0c4a6e;
  margin-bottom: 12px;
  text-align: center;
}

.prefetch-track {
  background: linear-gradient(to right, #e0f2fe, #bae6fd);
  border-color: #7dd3fc;
}

.prefetch-fill {
  background: linear-gradient(90deg, #0ea5e9 0%, #38bdf8 60%, #7dd3fc 100%);
}

.prefetch-stats {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85em;
  color: #0369a1;
  text-align: center;
  margin-top: 8px;
}

.progress-track {
  height: 12px;
  background: linear-gradient(to right, #e5e5e5, #f0f0f0);
  border: 1px solid #d5d5d5;
  max-width: 480px;
  margin: 0 auto 16px;
  border-radius: 6px;
  overflow: hidden;
  position: relative;
}

.progress-track::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent,
    transparent 20px,
    rgba(255,255,255,0.1) 20px,
    rgba(255,255,255,0.1) 21px
  );
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #c41e3a 0%, #e85a6f 60%, #f08a7e 100%);
  transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.progress-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255,255,255,0.3) 50%,
    transparent 100%
  );
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.replay-percent {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.2em;
  font-weight: 700;
  color: #c41e3a;
  margin: 0 0 16px 0;
  text-transform: none;
  letter-spacing: 0;
}

.replay-main {
  color: #2a2a2a;
  font-size: 0.98em;
  margin: 10px 0;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}

.replay-pair {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  color: #c41e3a;
}

.replay-stats {
  color: #5a5a5a;
  font-size: 0.88em;
  margin: 10px 0;
  text-transform: none;
  letter-spacing: 0;
  font-family: 'JetBrains Mono', monospace;
}

.replay-detail {
  max-width: 560px;
  margin: 16px auto 0;
  line-height: 1.6;
  font-size: 0.88em;
  color: #7a7a7a;
}

/* ─────────────────────────────────────────────────────────────────────────────
   STREAM SIGNALS PREVIEW - Real-time signal display during replay
   ───────────────────────────────────────────────────────────────────────────── */

.stream-signals-preview {
  margin-top: 32px;
  background: #f8f9fa;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 16px;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}

.stream-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 12px;
}

.stream-icon {
  font-size: 1.2em;
}

.stream-title {
  font-weight: 600;
  font-size: 0.9em;
  color: #333;
  letter-spacing: 0.5px;
}

.stream-table-container {
  max-height: 280px;
  overflow-y: auto;
}

.stream-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85em;
}

.stream-table th {
  padding: 8px 12px;
  text-align: left;
  font-weight: 600;
  color: #5a5a5a;
  border-bottom: 1px solid #ddd;
  font-size: 0.8em;
  letter-spacing: 0.5px;
}

.stream-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
}

.stream-row {
  animation: fadeInRow 0.3s ease;
}

@keyframes fadeInRow {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.stream-time {
  font-family: 'JetBrains Mono', monospace;
  color: #333;
}

.stream-pair {
  font-weight: 500;
  color: #c41e3a;
}

.stream-score {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
}

.score-triggered {
  color: #16a34a;
}

.score-watching {
  color: #8b8b8b;
}

.stream-status {
  text-align: center;
}

.status-pill {
  display: inline-block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  line-height: 20px;
  text-align: center;
  font-size: 0.8em;
}

.status-pill.triggered {
  background: #16a34a;
  color: white;
}

.status-pill.watching {
  background: #e5e5e5;
  color: #8b8b8b;
}

.stream-hint {
  text-align: center;
  font-size: 0.75em;
  color: #8b8b8b;
  margin-top: 12px;
  font-style: italic;
}

/* ─────────────────────────────────────────────────────────────────────────────
   RESULTS - Elegant data presentation
   ───────────────────────────────────────────────────────────────────────────── */

.results-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ─────────────────────────────────────────────────────────────────────────────
   SUMMARY GRID - Dashboard-style metrics
   ───────────────────────────────────────────────────────────────────────────── */

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.summary-card {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border: 1px solid #e5e5e5;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-shadow:
    0 2px 8px rgba(0,0,0,0.04),
    0 8px 24px rgba(0,0,0,0.02);
  border-radius: 8px;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.summary-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #e5e5e5 0%, #d5d5d5 100%);
}

.summary-card:hover {
  transform: translateY(-4px);
  box-shadow:
    0 4px 16px rgba(0,0,0,0.06),
    0 16px 48px rgba(0,0,0,0.04);
}

.summary-card.highlight {
  border-color: rgba(196, 30, 58, 0.3);
  background: linear-gradient(135deg, #fff8f8 0%, #fff0f0 100%);
}

.summary-card.highlight::before {
  background: linear-gradient(90deg, #c41e3a 0%, #e85a6f 50%, #c41e3a 100%);
}

.summary-card.performance-card {
  border-color: rgba(14, 165, 233, 0.3);
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
}

.summary-card.performance-card::before {
  background: linear-gradient(90deg, #0ea5e9 0%, #38bdf8 50%, #0ea5e9 100%);
}

.summary-card.performance-card .summary-value {
  color: #0369a1;
}

.summary-label {
  font-size: 0.68em;
  font-weight: 600;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
  font-family: 'DM Sans', sans-serif;
}

.summary-value {
  font-size: 2.2em;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  color: #1a1a1a;
  line-height: 1;
}

.summary-card.highlight .summary-value {
  color: #c41e3a;
}

.summary-sub {
  font-size: 0.78em;
  color: #8b8b8b;
  margin-top: 8px;
  font-weight: 400;
}

/* ─────────────────────────────────────────────────────────────────────────────
   SIGNALS TABLE - Clean data grid
   ───────────────────────────────────────────────────────────────────────────── */

.signals-card {
  background: #ffffff;
  border: 1px solid #e5e5e5;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e5e5e5;
}

.table-header h3 {
  font-size: 0.78em;
  font-weight: 600;
  color: #3a3a3a;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin: 0;
  font-family: 'DM Sans', sans-serif;
  display: flex;
  align-items: center;
  gap: 8px;
}

.table-header h3::before {
  content: '◇';
  color: #c41e3a;
  font-size: 0.9em;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: #ffffff;
  border: 1px solid #d5d5d5;
  cursor: pointer;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.72em;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: #5a5a5a;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  transition: all 0.2s ease;
  border-radius: 4px;
}

.filter-btn:hover {
  border-color: #b5b5b5;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.filter-btn.active {
  border-color: #c41e3a;
  background: linear-gradient(135deg, #c41e3a 0%, #a51832 100%);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(196, 30, 58, 0.2);
}

.filter-icon {
  font-size: 1.1em;
  line-height: 1;
}

.filter-count {
  color: #8b8b8b;
  font-size: 0.92em;
  font-weight: 400;
  text-transform: none;
  margin-left: 10px;
}

.filter-btn.active .filter-count {
  color: rgba(255,255,255,0.7);
}

.signals-card h3 {
  font-size: 0.75em;
  font-weight: 600;
  color: #5a5a5a;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin: 0 0 16px 0;
}

.signals-table-container {
  overflow-x: auto;
  border-radius: 6px;
  border: 1px solid #e5e5e5;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
  font-size: 0.68em;
  text-transform: uppercase;
  color: #3a3a3a;
  font-weight: 600;
  letter-spacing: 1px;
  padding: 14px 16px;
  background: linear-gradient(to bottom, #f8f8f8, #f0f0f0);
  border-bottom: 1px solid #d5d5d5;
  font-family: 'DM Sans', sans-serif;
}

td {
  padding: 14px 16px;
  border-bottom: 1px solid #eaeaea;
  font-size: 0.88em;
  transition: background 0.15s ease;
}

tr:hover td {
  background: rgba(196, 30, 58, 0.02);
}

.time-cell {
  color: #7a7a7a;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.82em;
  white-space: nowrap;
  font-weight: 500;
}

.pair-cell {
  min-width: 200px;
}

.pair-box {
  display: flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #f5f5f5 0%, #ebebe6 100%);
  padding: 6px 12px;
  border-radius: 4px;
  width: fit-content;
  border: 1px solid #e5e5e5;
}

.pair-a, .pair-b {
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
  color: #1a1a1a;
  font-size: 0.92em;
}

.pair-vs {
  color: #8b8b8b;
  font-size: 0.85em;
  opacity: 0.6;
}

/* ─────────────────────────────────────────────────────────────────────────────
   TYPE BADGE - Color-coded strategy indicators
   ───────────────────────────────────────────────────────────────────────────── */

.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 0.72em;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  border: 1px solid;
  font-family: 'DM Sans', sans-serif;
}

.type-badge.type-lag {
  background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%);
  color: #0369a1;
  border-color: #7dd3fc;
}

.type-badge.type-neg {
  background: linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%);
  color: #9f1239;
  border-color: #f9a8d4;
}

/* ─────────────────────────────────────────────────────────────────────────────
   SCORE DISPLAY - Visual score representation
   ───────────────────────────────────────────────────────────────────────────── */

.score-display {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.88em;
  font-weight: 600;
  background: #fafafa;
}

/* ─────────────────────────────────────────────────────────────────────────────
   TOTAL SCORE - Gradient score badges
   ───────────────────────────────────────────────────────────────────────────── */

.total-score {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 0.88em;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  border: none;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}

.total-score.score-high {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  color: #fff;
}

.total-score.score-medium {
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
  color: #1a1a1a;
}

.total-score.score-low {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #fff;
}

.leadlag-cell {
  font-size: 0.78em;
  color: #4a4a4a;
  font-weight: 600;
  white-space: nowrap;
  font-family: 'JetBrains Mono', monospace;
}

/* ─────────────────────────────────────────────────────────────────────────────
   STATUS BADGE - State indicators
   ───────────────────────────────────────────────────────────────────────────── */

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 0.68em;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  background: linear-gradient(135deg, #f5f5f5 0%, #ebebe6 100%);
  color: #5a5a5a;
  border: 1px solid #d5d5d5;
  font-family: 'DM Sans', sans-serif;
}

.status-badge::before {
  content: '○';
  font-size: 0.9em;
}

.status-badge.triggered {
  background: linear-gradient(135deg, #c41e3a 0%, #a51832 100%);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 2px 6px rgba(196, 30, 58, 0.2);
}

.status-badge.triggered::before {
  content: '●';
}

/* ─────────────────────────────────────────────────────────────────────────────
   NO SIGNALS - Empty state
   ───────────────────────────────────────────────────────────────────────────── */

.no-signals {
  text-align: center;
  padding: 60px 24px;
}

.no-signals-icon {
  font-size: 4em;
  color: #d5d5d5;
  display: block;
  margin-bottom: 16px;
  opacity: 0.3;
}

.no-signals p {
  color: #8b8b8b;
  font-size: 0.92em;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 500;
}

/* ─────────────────────────────────────────────────────────────────────────────
   PAGINATION - Navigation controls
   ───────────────────────────────────────────────────────────────────────────── */

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #e5e5e5;
}

.page-btn {
  padding: 10px 20px;
  border: 1px solid #d5d5d5;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78em;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  color: #3a3a3a;
  border-radius: 4px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  transition: all 0.2s ease;
}

.page-btn:hover:not(:disabled) {
  border-color: #c41e3a;
  color: #c41e3a;
  box-shadow: 0 2px 8px rgba(196, 30, 58, 0.1);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: #f5f5f5;
}

.page-info {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.88em;
  color: #3a3a3a;
  min-width: 6em;
  text-align: center;
  font-weight: 600;
  padding: 8px 16px;
  background: #f5f5f5;
  border-radius: 4px;
}
</style>
