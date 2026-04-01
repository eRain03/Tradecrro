<script setup lang="ts">
import { ref, computed } from 'vue';

const isLoading = ref(false);
const backtestResult = ref<BacktestResult | null>(null);
const showError = ref(false);
const errorMessage = ref('');

// Filter state
const showTriggeredOnly = ref(true);
const page = ref(1);
const pageSize = ref(100);

// Form state
const startDate = ref('');
const startTime = ref('00:00');
const endDate = ref('');
const endTime = ref('23:59');
const selectedPairs = ref<string[]>([]);

// Initialize dates
const today = new Date().toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
startDate.value = yesterday || '';
endDate.value = today || '';

const runBacktest = async () => {
  isLoading.value = true;
  showError.value = false;
  backtestResult.value = null;
  showTriggeredOnly.value = true; // Reset filter to show triggered only
  page.value = 1;

  try {
    const startDatetime = `${startDate.value}T${startTime.value}:00`;
    const endDatetime = `${endDate.value}T${endTime.value}:00`;

    console.log('Running backtest:', {
      startTime: startDatetime,
      endTime: endDatetime,
      pairs: selectedPairs.value,
    });

    const response = await fetch('/api/backtest/replay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startTime: startDatetime,
        endTime: endDatetime,
        pairs: selectedPairs.value.length > 0 ? selectedPairs.value : undefined,
        page: page.value,
        pageSize: pageSize.value,
      }),
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `Backtest failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log('Backtest result:', data);
    backtestResult.value = data;
  } catch (error: any) {
    console.error('Backtest error:', error);
    showError.value = true;
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
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
  if (strategyType === 'positive_lag') return 'Positive (Lag)';
  if (strategyType === 'negative_corr') return 'Negative (Sync)';
  return 'Not Triggered';
};

const getStrategyTypeClass = (strategyType: string | null) => {
  if (strategyType === 'positive_lag') return 'type-lag';
  if (strategyType === 'negative_corr') return 'type-neg';
  return '';
};

// Filtered signals
const filteredSignals = computed(() => {
  if (!backtestResult.value) return [];
  if (showTriggeredOnly.value) {
    return backtestResult.value.signals.filter(s => s.triggered);
  }
  return backtestResult.value.signals;
});

const nextPage = async () => {
  if (!backtestResult.value?.pagination) return;
  if (page.value >= backtestResult.value.pagination.totalPages) return;
  page.value += 1;
  await runBacktest();
};

const prevPage = async () => {
  if (page.value <= 1) return;
  page.value -= 1;
  await runBacktest();
};

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
    totalRows: number;
    totalPages: number;
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
        Backtest
        <span class="title-separator">◆</span>
      </h1>
    </div>

    <!-- Configuration Form -->
    <div class="config-card">
      <div class="form-section">
        <h3>Time Range</h3>
        <div class="date-range">
          <div class="date-field">
            <label>Start Date</label>
            <input type="date" v-model="startDate" />
          </div>
          <div class="date-field">
            <label>Start Time</label>
            <input type="time" v-model="startTime" />
          </div>
          <div class="separator">→</div>
          <div class="date-field">
            <label>End Date</label>
            <input type="date" v-model="endDate" />
          </div>
          <div class="date-field">
            <label>End Time</label>
            <input type="time" v-model="endTime" />
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
      <span class="loading-spinner">⏳</span>
      <p>Running backtest...</p>
      <p class="loading-sub">Analyzing historical signal data</p>
    </div>

    <!-- Results -->
    <div v-if="backtestResult" class="results-container">
      <!-- Summary Cards -->
      <div class="summary-grid">
        <div class="summary-card highlight">
          <div class="summary-label">Total Signals</div>
          <div class="summary-value">{{ backtestResult.summary.totalSignals }}</div>
          <div class="summary-sub">Within range</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">Triggered Signals</div>
          <div class="summary-value">{{ backtestResult.summary.triggeredSignals }}</div>
          <div class="summary-sub">Total score ≥ 87</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">Entry Confirmed</div>
          <div class="summary-value">{{ backtestResult.summary.confirmedSignals }}</div>
          <div class="summary-sub">Entry rules satisfied</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">Positive Lag Strategy</div>
          <div class="summary-value">{{ backtestResult.summary.positiveLagCount }}</div>
          <div class="summary-sub">Leader/Lagger</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">Negative Sync Strategy</div>
          <div class="summary-value">{{ backtestResult.summary.negativeCorrCount }}</div>
          <div class="summary-sub">Synchronous inverse</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">Average Total Score</div>
          <div class="summary-value">{{ backtestResult.summary.avgTotalScore.toFixed(1) }}</div>
          <div class="summary-sub">Average across all signals</div>
        </div>
      </div>

      <!-- Signals Table -->
      <div class="signals-card">
        <div class="table-header">
          <h3>Signals ({{ filteredSignals.length }})</h3>
          <button
            class="filter-btn"
            :class="{ 'active': showTriggeredOnly }"
            @click="showTriggeredOnly = !showTriggeredOnly"
          >
            <span class="filter-icon">{{ showTriggeredOnly ? '✓' : '○' }}</span>
            <span class="filter-text">Triggered only</span>
            <span class="filter-count">(Triggered: {{ backtestResult.summary.triggeredSignals }} / Total: {{ backtestResult.summary.totalSignals }})</span>
          </button>
        </div>
        <div class="table-header" v-if="backtestResult.pagination">
          <button class="filter-btn" @click="prevPage" :disabled="page <= 1 || isLoading">Prev</button>
          <span class="filter-count">Page {{ backtestResult.pagination.page }} / {{ backtestResult.pagination.totalPages }}</span>
          <button class="filter-btn" @click="nextPage" :disabled="page >= backtestResult.pagination.totalPages || isLoading">Next</button>
        </div>
        <div class="signals-table-container">
          <table v-if="filteredSignals.length > 0">
            <thead>
              <tr>
                <th>Time</th>
                <th>Pair</th>
                <th>Strategy</th>
                <th>Correlation Score</th>
                <th>Volume Score</th>
                <th>Total</th>
                <th>Leader/Lagger</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="signal in filteredSignals" :key="`${signal.timestamp}-${signal.stockA}-${signal.stockB}-${signal.strategyType}`">
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
                    {{ signal.triggered ? 'Tradable' : 'Watch' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="no-signals">
            <span class="no-signals-icon">∅</span>
            <p>No triggered signals found</p>
          </div>
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
.backtest-view {
  max-width: 1400px;
}

.view-header {
  margin-bottom: 20px;
  display: flex;
  align-items: center;
}

.view-header h1 {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1.3em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.title-separator {
  color: #c41e3a;
  font-size: 0.8em;
}

/* Config Card */
.config-card {
  background: #ffffff;
  border: 2px solid #c4c4c4;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
}

.form-section {
  margin-bottom: 20px;
}

.form-section:last-of-type {
  margin-bottom: 0;
}

.form-section h3 {
  font-size: 0.7em;
  font-weight: 700;
  color: #5a5a5a;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid #c4c4c4;
}

.date-range {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}

.date-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.date-field label {
  font-size: 0.65em;
  font-weight: 700;
  color: #5a5a5a;
  text-transform: uppercase;
}

.date-field input {
  padding: 8px 12px;
  border: 1px solid #c4c4c4;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.9em;
  background: #ffffff;
  color: #1a1a1a;
}

.separator {
  font-size: 1.5em;
  color: #c4c4c4;
  line-height: 1;
  padding-bottom: 4px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #c4c4c4;
}

.run-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 24px;
  background: #c41e3a;
  border: none;
  color: #ffffff;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.9em;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.1);
  transition: all 0.2s ease;
}

.run-btn:hover:not(:disabled) {
  background: #a01830;
  box-shadow: 3px 3px 6px rgba(0,0,0,0.15);
}

.run-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 1.2em;
}

/* Error & Loading */
.error-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: #f8d7da;
  border: 1px solid #c41e3a;
  color: #721c24;
  margin-bottom: 20px;
}

.error-icon {
  font-size: 1.3em;
}

.error-message {
  font-weight: 600;
}

.loading-card {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  padding: 60px 20px;
  text-align: center;
}

.loading-spinner {
  font-size: 2.5em;
  display: block;
  margin-bottom: 16px;
  opacity: 0.4;
}

.loading-card p {
  color: #5a5a5a;
  font-size: 0.95em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 8px 0;
}

.loading-sub {
  color: #8b8b8b;
  font-size: 0.85em;
}

/* Results */
.results-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.summary-card {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
}

.summary-card.highlight {
  border-color: #c41e3a;
  background: #f8f8f8;
}

.summary-label {
  font-size: 0.65em;
  font-weight: 700;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.summary-value {
  font-size: 1.5em;
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
  color: #1a1a1a;
}

.summary-sub {
  font-size: 0.75em;
  color: #8b8b8b;
  margin-top: 4px;
}

/* Signals Table */
.signals-card {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  padding: 20px;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #c4c4c4;
}

.table-header h3 {
  font-size: 0.75em;
  font-weight: 700;
  color: #5a5a5a;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin: 0;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #ffffff;
  border: 2px solid #c4c4c4;
  cursor: pointer;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: #5a5a5a;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  transition: all 0.2s ease;
}

.filter-btn:hover {
  border-color: #8b8b8b;
  background: #f5f5f0;
}

.filter-btn.active {
  border-color: #c41e3a;
  background: #c41e3a;
  color: #ffffff;
}

.filter-icon {
  font-size: 1.2em;
  line-height: 1;
}

.filter-count {
  color: #8b8b8b;
  font-size: 0.9em;
  font-weight: 400;
  text-transform: none;
  margin-left: 8px;
}

.filter-btn.active .filter-count {
  color: #e0e0e0;
}

.signals-card h3 {
  font-size: 0.75em;
  font-weight: 700;
  color: #5a5a5a;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin: 0 0 16px 0;
}

.signals-table-container {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
  font-size: 0.65em;
  text-transform: uppercase;
  color: #5a5a5a;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 10px 12px;
  background: #ebebe6;
  border-bottom: 2px solid #1a1a1a;
}

td {
  padding: 10px 12px;
  border-bottom: 1px solid #ebebe6;
  font-size: 0.85em;
}

.time-cell {
  color: #8b8b8b;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.8em;
  white-space: nowrap;
}

.pair-cell {
  min-width: 180px;
}

.pair-box {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #ebebe6;
  padding: 4px 8px;
  border-radius: 2px;
  width: fit-content;
}

.pair-a, .pair-b {
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
  color: #1a1a1a;
  font-size: 0.9em;
}

.pair-vs {
  color: #8b8b8b;
  font-size: 0.8em;
}

/* Type Badge */
.type-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 3px;
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  border: 1px solid;
}

.type-badge.type-lag {
  background: #d1ecf1;
  color: #0056b3;
  border-color: #b8d9e8;
}

.type-badge.type-neg {
  background: #f8d7da;
  color: #721c24;
  border-color: #f5c6cb;
}

/* Score Display */
.score-display {
  display: inline-block;
  padding: 3px 8px;
  border: 1px solid #c4c4c4;
  border-radius: 2px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.85em;
  font-weight: 700;
}

/* Total Score */
.total-score {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 3px;
  font-size: 0.85em;
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
  border: 1px solid;
}

.total-score.score-high {
  background: #28a745;
  color: #fff;
  border-color: #1e7e34;
}

.total-score.score-medium {
  background: #ffc107;
  color: #1a1a1a;
  border-color: #e0a800;
}

.total-score.score-low {
  background: #dc3545;
  color: #fff;
  border-color: #bd2130;
}

.leadlag-cell {
  font-size: 0.75em;
  color: #5a5a5a;
  font-weight: 600;
  white-space: nowrap;
}

/* Status Badge */
.status-badge {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 2px;
  font-size: 0.65em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  background: #ebebe6;
  color: #5a5a5a;
  border: 1px solid #c4c4c4;
}

.status-badge.triggered {
  background: #c41e3a;
  color: #fff;
  border-color: #8b1e2a;
}

/* No Signals */
.no-signals {
  text-align: center;
  padding: 40px 20px;
}

.no-signals-icon {
  font-size: 3em;
  color: #c4c4c4;
  display: block;
  margin-bottom: 12px;
  opacity: 0.4;
}

.no-signals p {
  color: #8b8b8b;
  font-size: 0.9em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
