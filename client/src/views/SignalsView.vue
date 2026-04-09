<script setup lang="ts">
import { onMounted, computed, ref, onUnmounted, watch } from 'vue';
import { useTradingStore } from '../stores/trading';

const store = useTradingStore();

// Pagination settings
const PAGE_SIZE = 50;
const currentPage = ref(1);

// Signal limit for fetching (increased to support pagination)
const signalLimit = ref(500);

// Market status
const marketOpen = ref(false);
const marketTime = ref('');
const nextOpenTime = ref('');

const updateMarketStatus = () => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const day = now.getUTCDay();

  // US Stock Market: Mon-Fri 9:30 AM - 4:00 PM ET
  // During daylight saving time (Mar-Nov): UTC 13:30 - 20:00
  // During standard time (Nov-Mar): UTC 14:30 - 21:00
  // We'll use daylight saving time as default
  const isWeekday = day >= 1 && day <= 5;
  const marketOpenUTC = 13 * 60 + 30; // 13:30 UTC in minutes
  const marketCloseUTC = 20 * 60; // 20:00 UTC in minutes
  const currentUTC = utcHour * 60 + utcMin;

  marketOpen.value = isWeekday && (currentUTC >= marketOpenUTC && currentUTC < marketCloseUTC);

  const hours = String(utcHour).padStart(2, '0');
  const minutes = String(utcMin).padStart(2, '0');
  marketTime.value = `${hours}:${minutes} UTC`;

  // Calculate next open time
  if (!marketOpen.value) {
    let nextOpen = new Date(now);
    const todayOpenUTC = new Date(now);
    todayOpenUTC.setUTCHours(13, 30, 0, 0);

    if (day === 0) {
      // Sunday - next Monday 13:30 UTC
      nextOpen.setUTCDate(nextOpen.getUTCDate() + 1);
      nextOpen.setUTCHours(13, 30, 0, 0);
    } else if (day === 6) {
      // Saturday - next Monday 13:30 UTC
      nextOpen.setUTCDate(nextOpen.getUTCDate() + 2);
      nextOpen.setUTCHours(13, 30, 0, 0);
    } else if (currentUTC >= marketCloseUTC) {
      // After market close - next day 13:30 UTC
      nextOpen.setUTCDate(nextOpen.getUTCDate() + 1);
      nextOpen.setUTCHours(13, 30, 0, 0);
    } else if (currentUTC < marketOpenUTC) {
      // Before market open today
      nextOpen = todayOpenUTC;
    }

    const diff = nextOpen.getTime() - now.getTime();
    const diffHours = Math.floor(diff / (1000 * 60 * 60));
    const diffMins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    nextOpenTime.value = `${diffHours}h ${diffMins}m until open`;
  }
};

let timeInterval: ReturnType<typeof setInterval>;

onMounted(() => {
  store.fetchSignals(signalLimit.value);
  updateMarketStatus();
  timeInterval = setInterval(updateMarketStatus, 1000);
});

onUnmounted(() => {
  clearInterval(timeInterval);
});

const showTriggeredOnly = ref(false);
const selectedSignal = ref<any>(null);
const showModal = ref(false);

const formatTime = (timestamp: string) => {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

const triggeredCount = computed(() => store.signals.filter(s => s.triggered).length);
const avgScore = computed(() => {
  if (store.signals.length === 0) return 0;
  return store.signals.reduce((sum, s) => sum + s.totalScore, 0) / store.signals.length;
});

const filteredSignals = computed(() => {
  if (showTriggeredOnly.value) {
    return store.signals.filter(s => s.triggered);
  }
  return store.signals;
});

// Paginated signals
const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredSignals.value.length / PAGE_SIZE))
);

const paginatedSignals = computed(() => {
  const list = filteredSignals.value;
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return list.slice(start, start + PAGE_SIZE);
});

// Pagination navigation
const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value) return;
  currentPage.value = page;
};

const goToPrevPage = () => goToPage(currentPage.value - 1);
const goToNextPage = () => goToPage(currentPage.value + 1);

// Reset to page 1 when filter changes
watch(showTriggeredOnly, () => {
  currentPage.value = 1;
});

// Get correlation type label
const getCorrelationType = (signal: any) => {
  if (signal.strategyType === 'positive_lag') {
    return { label: 'Positive Correlation (Lag)', class: 'type-lag' };
  } else if (signal.strategyType === 'negative_corr') {
    return { label: 'Negative Correlation (Sync)', class: 'type-neg' };
  }
  return { label: 'Unknown', class: '' };
};

// Get leader/lagger info
const getLeadLagInfo = (signal: any) => {
  if (signal.strategyType === 'positive_lag') {
    return `${signal.score?.leader || 'N/A'} → ${signal.score?.lagger || 'N/A'}`;
  } else if (signal.strategyType === 'negative_corr') {
    return 'Synchronized';
  }
  return 'N/A';
};

// Get correlation score (0-80)
const getCorrelationScore = (signal: any) => {
  return Math.round(signal.score?.correlationScore || 0);
};

// Get volume score (0-20)
const getVolumeScore = (signal: any) => {
  return Math.round((signal.score?.volumeScoreA || 0) + (signal.score?.volumeScoreB || 0));
};

// Get total score
const getTotalScore = (signal: any) => {
  return Math.round(signal.totalScore);
};

// Get score class based on percentage
const getScoreClass = (score: number, max: number) => {
  const pct = score / max;
  if (pct >= 0.75) return 'score-high';
  if (pct >= 0.5) return 'score-medium';
  return 'score-low';
};

const openSignalModal = (signal: any) => {
  if (signal.triggered) {
    selectedSignal.value = signal;
    showModal.value = true;
  }
};

const closeModal = () => {
  showModal.value = false;
  selectedSignal.value = null;
};

const getEntryLogicText = (signal: any) => {
  if (!signal.entryConfirmed) {
    return signal.entryReason || 'Entry conditions not met';
  }

  if (signal.strategyType === 'positive_lag') {
    return `Leader rose ${(signal.leaderMove! * 100).toFixed(2)}% (≥5%), Lagger rose ${(signal.laggerMove! * 100).toFixed(2)}% (<2%), Expected move ${(signal.expectedMove! * 100).toFixed(2)}% (≥5%)`;
  } else if (signal.strategyType === 'negative_corr') {
    return `Strong negative correlation + High volume confirmation + Expected move ${(signal.expectedMove! * 100).toFixed(2)}% (≥5%)`;
  }
  return signal.entryReason || 'Conditions met';
};
</script>

<template>
  <div class="signals-view">
    <!-- Market Closed Banner -->
    <div v-if="!marketOpen" class="market-closed-overlay">
      <div class="market-closed-content">
        <div class="closed-icon">📴</div>
        <h1 class="closed-title">MARKET CLOSED</h1>
        <div class="closed-time">{{ marketTime }}</div>
        <div class="next-open">{{ nextOpenTime }}</div>
        <p class="closed-hint">Signals will resume when market opens</p>
      </div>
    </div>

    <!-- Normal Content (shown when market is open) -->
    <template v-else>
    <div class="view-header">
      <h1>
        <span class="title-separator">◆</span>
        TRADING SIGNALS
        <span class="title-separator">◆</span>
      </h1>
      <div class="header-actions">
        <div class="signal-stats">
          <span class="stat-badge">
            <span class="stat-label">PAIRS</span>
            <span class="stat-value">{{ store.signals.length }}</span>
          </span>
          <span class="stat-badge triggered">
            <span class="stat-label">TRIGGERED</span>
            <span class="stat-value">{{ triggeredCount }}</span>
          </span>
          <span class="stat-badge">
            <span class="stat-label">AVG SCORE</span>
            <span class="stat-value">{{ avgScore.toFixed(0) }}</span>
          </span>
        </div>
        <button
          class="filter-btn"
          :class="{ 'active': showTriggeredOnly }"
          @click="showTriggeredOnly = !showTriggeredOnly"
        >
          <span class="filter-icon">{{ showTriggeredOnly ? '✓' : '○' }}</span>
          <span class="filter-text">TRIGGERED ONLY</span>
        </button>
      </div>
    </div>

    <div class="scan-info" v-if="store.signals.length > 0">
      <span class="scan-label">Latest Scan:</span>
      <span class="scan-time">{{ store.signals[0]?.timestamp ? formatTime(store.signals[0].timestamp) : '-' }}</span>
      <span class="scan-note">• Showing latest signal for each trading pair</span>
    </div>

    <div v-if="store.isLoading" class="loading-state">
      <span class="loading-spinner">⏳</span>
      <p>Loading signals...</p>
    </div>

    <div v-else-if="filteredSignals.length > 0" class="signals-table-container">
      <div class="table-header">
        <span class="table-info">
          Page {{ currentPage }}/{{ totalPages }} · Showing {{ paginatedSignals.length }} of {{ filteredSignals.length }} signals
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Pair</th>
            <th>Correlation Type</th>
            <th>Correlation Score</th>
            <th>Volume Score</th>
            <th>Total Score</th>
            <th>Leader/Lagger</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="signal in paginatedSignals"
            :key="signal.id"
            class="signal-row"
            :class="{ 'triggered-row': signal.triggered, 'clickable': signal.triggered }"
            @click="openSignalModal(signal)"
          >
            <td class="time-cell">{{ formatTime(signal.timestamp) }}</td>
            <td class="pair-cell">
              <div class="pair-box">
                <span class="pair-a">{{ signal.stockA }}</span>
                <span class="pair-vs">/</span>
                <span class="pair-b">{{ signal.stockB }}</span>
              </div>
            </td>
            <td>
              <span class="type-badge" :class="getCorrelationType(signal).class">
                {{ getCorrelationType(signal).label }}
              </span>
            </td>
            <td>
              <div class="score-bar-container">
                <div class="score-bar" :class="getScoreClass(getCorrelationScore(signal), 80)" :style="{ width: (getCorrelationScore(signal) / 80 * 100) + '%' }"></div>
                <span class="score-bar-text">{{ getCorrelationScore(signal) }}/80</span>
              </div>
            </td>
            <td>
              <div class="score-bar-container">
                <div class="score-bar volume" :class="getScoreClass(getVolumeScore(signal), 20)" :style="{ width: (getVolumeScore(signal) / 20 * 100) + '%' }"></div>
                <span class="score-bar-text">{{ getVolumeScore(signal) }}/20</span>
              </div>
            </td>
            <td>
              <span class="total-score" :class="getScoreClass(getTotalScore(signal), 100)">
                {{ getTotalScore(signal) }}
              </span>
            </td>
            <td class="leadlag-cell">{{ getLeadLagInfo(signal) }}</td>
            <td>
              <span class="status-badge" :class="{ 'triggered': signal.triggered }">
                {{ signal.triggered ? 'Tradable' : 'Watching' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="filteredSignals.length > PAGE_SIZE" class="pagination-bar">
        <button
          type="button"
          class="page-btn"
          :disabled="currentPage <= 1"
          @click="goToPrevPage"
        >
          Previous
        </button>
        <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
        <button
          type="button"
          class="page-btn"
          :disabled="currentPage >= totalPages"
          @click="goToNextPage"
        >
          Next
        </button>
      </div>
    </div>

    <div v-else class="empty-state">
      <span class="empty-icon">---</span>
      <h2>NO SIGNALS</h2>
      <p v-if="showTriggeredOnly">No triggered signals found</p>
      <p v-else>Waiting for market opportunities...</p>
    </div>

    <!-- Modal Popup -->
    <div v-if="showModal" class="modal-overlay" @click="closeModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h2>Signal Details</h2>
          <button class="modal-close" @click="closeModal">×</button>
        </div>
        <div class="modal-body" v-if="selectedSignal">
          <div class="detail-section">
            <h3>📊 Pair Information</h3>
            <div class="detail-row">
              <span class="detail-label">Pair:</span>
              <span class="detail-value">{{ selectedSignal.stockA }} / {{ selectedSignal.stockB }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Time:</span>
              <span class="detail-value">{{ formatTime(selectedSignal.timestamp) }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Correlation Type:</span>
              <span class="detail-value strategy-value">{{ getCorrelationType(selectedSignal).label }}</span>
            </div>
            <div v-if="selectedSignal.strategyType === 'positive_lag'" class="detail-row">
              <span class="detail-label">Leader → Lagger:</span>
              <span class="detail-value">{{ selectedSignal.score?.leader }} → {{ selectedSignal.score?.lagger }}</span>
            </div>
          </div>

          <div class="detail-section">
            <h3>📈 Score Breakdown</h3>
            <div class="score-breakdown-grid">
              <div class="score-item">
                <span class="score-item-label">Correlation Score</span>
                <span class="score-item-value">{{ getCorrelationScore(selectedSignal) }} / 80</span>
                <span class="score-item-desc">Measures how strongly the two stocks' price movements are correlated</span>
              </div>
              <div class="score-item">
                <span class="score-item-label">Volume Score A</span>
                <span class="score-item-value">{{ Math.round(selectedSignal.score?.volumeScoreA || 0) }} / 10</span>
                <span class="score-item-desc">Stock A's current volume relative to its average</span>
              </div>
              <div class="score-item">
                <span class="score-item-label">Volume Score B</span>
                <span class="score-item-value">{{ Math.round(selectedSignal.score?.volumeScoreB || 0) }} / 10</span>
                <span class="score-item-desc">Stock B's current volume relative to its average</span>
              </div>
              <div class="score-item total">
                <span class="score-item-label">Total Score</span>
                <span class="score-item-value total-value" :class="getScoreClass(getTotalScore(selectedSignal), 100)">
                  {{ getTotalScore(selectedSignal) }} / 100
                </span>
                <span class="score-item-desc">≥87 to trigger trading signal</span>
              </div>
            </div>
            <div class="score-details">
              <div class="detail-row">
                <span class="detail-label">Sync Correlation:</span>
                <span class="detail-value">{{ (selectedSignal.score?.syncCorrelation || 0).toFixed(3) }}</span>
                <span class="detail-hint">For negative correlation strategy</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Lag Correlation:</span>
                <span class="detail-value">{{ (selectedSignal.score?.lagCorrelation || 0).toFixed(3) }}</span>
                <span class="detail-hint">For positive correlation strategy</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Volume Ratio A:</span>
                <span class="detail-value">{{ (selectedSignal.score?.volumeRatioA || 1).toFixed(2) }}x</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Volume Ratio B:</span>
                <span class="detail-value">{{ (selectedSignal.score?.volumeRatioB || 1).toFixed(2) }}x</span>
              </div>
            </div>
          </div>

          <div class="detail-section entry-logic">
            <h3>🎯 Entry Logic</h3>
            <div class="detail-row">
              <span class="detail-label">Entry Confirmed:</span>
              <span class="detail-value" :class="{ 'confirmed': selectedSignal.entryConfirmed, 'not-confirmed': !selectedSignal.entryConfirmed }">
                {{ selectedSignal.entryConfirmed ? 'Confirmed ✓' : 'Not Confirmed ✗' }}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Reason:</span>
              <span class="detail-value reason-text">{{ getEntryLogicText(selectedSignal) }}</span>
            </div>
            <div v-if="selectedSignal.leaderMove" class="detail-row">
              <span class="detail-label">Leader Move:</span>
              <span class="detail-value">{{ (selectedSignal.leaderMove * 100).toFixed(2) }}%</span>
            </div>
            <div v-if="selectedSignal.laggerMove" class="detail-row">
              <span class="detail-label">Lagger Move:</span>
              <span class="detail-value">{{ (selectedSignal.laggerMove * 100).toFixed(2) }}%</span>
            </div>
            <div v-if="selectedSignal.expectedMove" class="detail-row">
              <span class="detail-label">Expected Move:</span>
              <span class="detail-value">{{ (selectedSignal.expectedMove * 100).toFixed(2) }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    </template>
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
.signals-view {
  max-width: 1400px;
}

/* Market Closed Overlay */
.market-closed-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 200px);
  padding: 40px;
}

.market-closed-content {
  text-align: center;
  background: linear-gradient(135deg, #ffffff 0%, #f8f8f5 100%);
  border: 2px solid #d4d4d4;
  border-radius: 12px;
  padding: 60px 80px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.08);
  max-width: 500px;
  animation: fade-in 0.5s ease-out;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.closed-icon {
  font-size: 4em;
  margin-bottom: 20px;
  opacity: 0.8;
}

.closed-title {
  font-size: 2.5em;
  font-weight: 700;
  color: #8b8b8b;
  letter-spacing: 6px;
  text-transform: uppercase;
  margin-bottom: 16px;
  font-family: 'Times New Roman', Times, serif;
}

.closed-time {
  font-size: 1.8em;
  font-weight: 700;
  color: #1a1a1a;
  font-family: 'Courier New', Courier, monospace;
  margin-bottom: 12px;
  padding: 8px 20px;
  background: #ebebe6;
  border-radius: 6px;
  display: inline-block;
}

.next-open {
  font-size: 1em;
  color: #5a5a5a;
  margin-bottom: 20px;
  font-weight: 600;
}

.closed-hint {
  font-size: 0.85em;
  color: #8b8b8b;
  font-style: italic;
}

.view-header {
  margin-bottom: 20px;
  display: flex;
  justify-content: space-between;
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.signal-stats {
  display: flex;
  gap: 10px;
}

.stat-badge {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
}

.stat-label {
  font-size: 0.6em;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.stat-value {
  font-size: 1.1em;
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
  color: #1a1a1a;
}

.stat-badge.triggered {
  border-color: #c41e3a;
  background: #f8d7da;
}

.stat-badge.triggered .stat-value {
  color: #c41e3a;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #ffffff;
  border: 2px solid #c4c4c4;
  cursor: pointer;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.75em;
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

/* Scan Info */
.scan-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 14px;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 4px;
  font-size: 0.8em;
}

.scan-label {
  color: #5a5a5a;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.scan-time {
  color: #1a1a1a;
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
}

.scan-note {
  color: #8b8b8b;
  font-style: italic;
}

/* Table */
.signals-table-container {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
}

.table-header {
  padding: 10px 14px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
}

.table-info {
  font-size: 0.75em;
  color: #5a5a5a;
  font-weight: 600;
}

.pagination-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #f8f9fa;
  border-top: 1px solid #e9ecef;
}

.page-btn {
  padding: 8px 16px;
  background: #ffffff;
  border: 1px solid #c4c4c4;
  cursor: pointer;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.75em;
  font-weight: 700;
  text-transform: uppercase;
  color: #5a5a5a;
  transition: all 0.2s ease;
}

.page-btn:hover:not(:disabled) {
  border-color: #c41e3a;
  color: #c41e3a;
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.page-info {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.85em;
  font-weight: 700;
  color: #1a1a1a;
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
  padding: 10px 14px;
  background: #ebebe6;
  border-bottom: 2px solid #1a1a1a;
}

td {
  padding: 10px 14px;
  border-bottom: 1px solid #ebebe6;
  font-size: 0.85em;
}

.signal-row:hover {
  background: #f5f5f0;
}

.signal-row.triggered-row {
  background: #f8d7da;
}

.signal-row.clickable {
  cursor: pointer;
}

.signal-row.clickable:hover {
  background: #f0c0c5;
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

.leadlag-cell {
  font-size: 0.75em;
  color: #5a5a5a;
  font-weight: 600;
  white-space: nowrap;
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

/* Score Bar */
.score-bar-container {
  position: relative;
  width: 100%;
  height: 24px;
  background: #ebebe6;
  border-radius: 3px;
  overflow: hidden;
}

.score-bar {
  height: 100%;
  transition: width 0.3s ease;
}

.score-bar.score-high {
  background: #28a745;
}

.score-bar.score-medium {
  background: #ffc107;
}

.score-bar.score-low {
  background: #dc3545;
}

.score-bar.volume.score-high {
  background: #28a745;
}

.score-bar.volume.score-medium {
  background: #ffc107;
}

.score-bar.volume.score-low {
  background: #dc3545;
}

.score-bar-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.75em;
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
  color: #1a1a1a;
  text-shadow: 0 0 2px rgba(255,255,255,0.8);
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

.score-value {
  font-family: 'Courier New', Courier, monospace;
  font-weight: 700;
  padding: 3px 8px;
  border: 1px solid #c4c4c4;
  border-radius: 2px;
}

.score-high {
  background: #b36b00;
  color: #fff;
  border-color: #8b5200;
}

.score-medium {
  color: #0056b3;
  background: #d1ecf1;
  border-color: #0056b3;
}

.score-low {
  color: #5a5a5a;
  background: #ffffff;
}

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

/* Loading & Empty */
.loading-state, .empty-state {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  padding: 60px 20px;
  text-align: center;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
}

.loading-spinner, .empty-icon {
  font-size: 2em;
  display: block;
  margin-bottom: 16px;
  opacity: 0.4;
  font-family: 'Courier New', Courier, monospace;
}

.loading-state p, .empty-state h2 {
  color: #5a5a5a;
  margin-bottom: 8px;
  font-size: 0.9em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.empty-state p {
  color: #8b8b8b;
  font-size: 0.85em;
}

/* Modal Overlay */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-content {
  background: #ffffff;
  border: 2px solid #1a1a1a;
  box-shadow: 4px 4px 8px rgba(0, 0, 0, 0.15);
  max-width: 600px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 2px solid #1a1a1a;
  background: #ebebe6;
}

.modal-header h2 {
  font-size: 1em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin: 0;
}

.modal-close {
  background: transparent;
  border: none;
  font-size: 2em;
  line-height: 0.8;
  color: #5a5a5a;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  color: #c41e3a;
}

.modal-body {
  padding: 20px;
}

.detail-section {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid #ebebe6;
}

.detail-section:last-of-type {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.detail-section h3 {
  font-size: 0.7em;
  font-weight: 700;
  color: #5a5a5a;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid #c4c4c4;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 8px 0;
  font-size: 0.85em;
}

.detail-label {
  color: #8b8b8b;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.9em;
}

.detail-value {
  color: #1a1a1a;
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
  text-align: right;
}

.detail-value.strategy-value {
  color: #0056b3;
}

.detail-value.confirmed {
  color: #28a745;
}

.detail-value.not-confirmed {
  color: #dc3545;
}

.detail-value.reason-text {
  text-align: left;
  max-width: 300px;
  line-height: 1.4;
}

.detail-hint {
  font-size: 0.7em;
  color: #c41e3a;
  font-weight: 600;
  margin-left: 8px;
  padding: 2px 6px;
  background: #f8d7da;
  border-radius: 2px;
}

.entry-logic {
  background: #f8f9fa;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #e9ecef;
}

.entry-logic h3 {
  color: #c41e3a;
  border-bottom-color: #c41e3a;
}

/* Score Breakdown Grid */
.score-breakdown-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 4px;
  border: 1px solid #e9ecef;
}

.score-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #c4c4c4;
  border-radius: 4px;
}

.score-item-label {
  font-size: 0.65em;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  margin-bottom: 8px;
  text-align: center;
}

.score-item-value {
  font-size: 1.1em;
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
  color: #1a1a1a;
}

.score-item-desc {
  font-size: 0.65em;
  color: #8b8b8b;
  text-align: center;
  margin-top: 6px;
  line-height: 1.3;
}

.score-item.total {
  background: #ebebe6;
  border-color: #1a1a1a;
}

.score-item.total .score-item-value {
  font-size: 1.3em;
}

.score-item.total .total-value.score-high {
  background: #b36b00;
  color: #fff;
  padding: 4px 8px;
  border-radius: 2px;
}

.score-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Scrollbar styling */
.modal-content::-webkit-scrollbar {
  width: 8px;
}

.modal-content::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.modal-content::-webkit-scrollbar-thumb {
  background: #c4c4c4;
}

.modal-content::-webkit-scrollbar-thumb:hover {
  background: #8b8b8b;
}
</style>
