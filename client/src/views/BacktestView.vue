<script setup lang="ts">
import { ref, computed } from 'vue';

const PAGE_SIZE = 100;

const isLoading = ref(false);
const backtestResult = ref<BacktestResult | null>(null);
const showError = ref(false);
const errorMessage = ref('');

/** 数据库分页查询 vs 行情重放（Databento / Yahoo，全量拉取后前端按 100 条分页） */
const backtestMode = ref<'db' | 'replay'>('db');
const replayPage = ref(1);
const replaySignalsFull = ref<BacktestResult['signals']>([]);

// Filter state（数据库模式会传给后端；重放模式在前端过滤后再分页）
const showTriggeredOnly = ref(true);

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

const getSignalDedupKey = (signal: BacktestResult['signals'][number]) => {
  const secondTimestamp = signal.timestamp.slice(0, 19);
  return `${secondTimestamp}|${signal.stockA}|${signal.stockB}`;
};

const dedupeSignals = (signals: BacktestResult['signals']) => {
  const seen = new Set<string>();

  return signals.filter((signal) => {
    const key = getSignalDedupKey(signal);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const getRangeBody = () => {
  const startDatetime = `${startDate.value}T${startTime.value}:00`;
  const endDatetime = `${endDate.value}T${endTime.value}:00`;
  return {
    startTime: startDatetime,
    endTime: endDatetime,
    pairs: selectedPairs.value.length > 0 ? selectedPairs.value : undefined,
  };
};

/** 与 src/api/http.ts 一致；开发时直连后端，避免 Vite 代理缓冲 NDJSON 流导致进度不刷新 */
function resolveApiBase(): string {
  const url = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (url) return url.replace(/\/$/, '');
  return import.meta.env.DEV ? 'http://localhost:3001' : '';
}

/** 数据库：服务端分页，每页最多 100 条 */
const fetchDbPage = async (page: number) => {
  const body = {
    ...getRangeBody(),
    page,
    pageSize: PAGE_SIZE,
    triggeredOnly: showTriggeredOnly.value,
  };

  const response = await fetch('/api/backtest/run', {
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
  | { type: 'start'; totalPairs: number; startTime: string; endTime: string }
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
    }
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
} | null>(null);

/** 行情重放：NDJSON 流式进度 + 配置 DATABENTO_API_KEY 时后端用 Databento */
const fetchReplay = async () => {
  replayProgress.value = {
    totalPairs: 0,
    current: 0,
    pairLabel: '',
    cumulativeSignals: 0,
    lastPairSignalCount: 0,
    elapsedSec: 0,
    percentApprox: 0,
    step: 'connecting',
    detail: '连接服务器…',
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
    throw new Error('浏览器不支持流式响应');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const applyProgress = (msg: Extract<ReplayStreamMsg, { type: 'progress' }>) => {
    const pair = `${msg.stockA} / ${msg.stockB}`;
    let detail = '';
    if (msg.step === 'pair_start') {
      detail =
        '开始该交易对：将依次拉取两只标的 K 线（Databento 单次请求可能需 1～5 分钟，请看终端 [Databento] 日志）';
    } else if (msg.step === 'symbol') {
      if (msg.subStep === 'symbol_start') {
        detail = `正在请求 Databento：${msg.symbol ?? ''}（Python 子进程）…`;
      } else if (msg.subStep === 'symbol_done') {
        detail = `${msg.symbol ?? ''} 已返回 ${msg.barCount ?? 0} 根 1m K 线`;
      } else if (msg.subStep === 'compute') {
        detail = '正在计算相关性、成交量分数与信号…';
      } else {
        detail = '处理中…';
      }
    } else if (msg.step === 'pair_done') {
      detail = `本对已完成，生成 ${msg.lastPairSignalCount ?? 0} 条时间点信号`;
    } else {
      detail = '处理中…';
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
          step: 'start',
          detail: `共 ${msg.totalPairs} 对交易对，开始逐对回测…`,
        };
      } else if (msg.type === 'progress') {
        applyProgress(msg);
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
  if (strategyType === 'positive_lag') return '正相关 (滞后)';
  if (strategyType === 'negative_corr') return '负相关 (同步)';
  return '未触发';
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
    return `第 ${page}/${totalPages || 1} 页 · 本条件共 ${total} 条`;
  }
  if (backtestMode.value === 'replay' && replaySignalsFull.value.length > 0) {
    return `第 ${replayPage.value}/${replayTotalPages.value} 页 · 本页最多 ${PAGE_SIZE} 条（前端分页）`;
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
        回测
        <span class="title-separator">◆</span>
      </h1>
    </div>

    <!-- Configuration Form -->
    <div class="config-card">
      <div class="form-section">
        <h3>时间范围</h3>
        <div class="date-range">
          <div class="date-field">
            <label>开始日期</label>
            <input type="date" v-model="startDate" />
          </div>
          <div class="date-field">
            <label>开始时间</label>
            <input type="time" v-model="startTime" />
          </div>
          <div class="separator">→</div>
          <div class="date-field">
            <label>结束日期</label>
            <input type="date" v-model="endDate" />
          </div>
          <div class="date-field">
            <label>结束时间</label>
            <input type="time" v-model="endTime" />
          </div>
        </div>
      </div>

      <div class="form-section mode-section">
        <h3>数据源</h3>
        <div class="mode-row">
          <label class="mode-option">
            <input type="radio" value="db" v-model="backtestMode" />
            <span>数据库信号（分页查询，每页 {{ PAGE_SIZE }} 条）</span>
          </label>
          <label class="mode-option">
            <input type="radio" value="replay" v-model="backtestMode" />
            <span>行情重放（配置 DATABENTO_API_KEY 时用 Databento，否则 Yahoo；结果前端分页）</span>
          </label>
        </div>
      </div>

      <div class="form-actions">
        <button class="run-btn" @click="runBacktest" :disabled="isLoading">
          <span class="btn-icon">{{ isLoading ? '⏳' : '▶' }}</span>
          <span class="btn-text">{{ isLoading ? '回测中...' : '运行回测' }}</span>
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
          <span class="replay-title">行情重放回测</span>
        </div>
        <div class="progress-track" role="progressbar" :aria-valuenow="replayProgress.percentApprox" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-fill" :style="{ width: `${replayProgress.percentApprox}%` }" />
        </div>
        <p class="replay-percent">{{ replayProgress.percentApprox }}%</p>
        <p class="replay-main">
          第 <strong>{{ replayProgress.current }}</strong> / {{ replayProgress.totalPairs }} 对
          <span v-if="replayProgress.pairLabel" class="replay-pair"> · {{ replayProgress.pairLabel }}</span>
        </p>
        <p class="replay-stats">
          累计信号 <strong>{{ replayProgress.cumulativeSignals }}</strong> 条
          <span v-if="replayProgress.step === 'pair_done' && replayProgress.lastPairSignalCount">
            · 本对 +{{ replayProgress.lastPairSignalCount }}
          </span>
          · 已用时 <strong>{{ replayProgress.elapsedSec }}</strong> 秒
        </p>
        <p class="loading-sub replay-detail">{{ replayProgress.detail }}</p>
      </template>
      <template v-else>
        <span class="loading-spinner">⏳</span>
        <p>正在回测...</p>
        <p class="loading-sub">分析历史信号数据</p>
      </template>
    </div>

    <!-- Results -->
    <div v-if="backtestResult" class="results-container">
      <!-- Summary Cards -->
      <div class="summary-grid">
        <div class="summary-card highlight">
          <div class="summary-label">总信号数</div>
          <div class="summary-value">{{ backtestResult.summary.totalSignals }}</div>
          <div class="summary-sub">时间范围内</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">触发信号</div>
          <div class="summary-value">{{ backtestResult.summary.triggeredSignals }}</div>
          <div class="summary-sub">总分≥87</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">已确认入场</div>
          <div class="summary-value">{{ backtestResult.summary.confirmedSignals }}</div>
          <div class="summary-sub">满足入场条件</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">正相关策略</div>
          <div class="summary-value">{{ backtestResult.summary.positiveLagCount }}</div>
          <div class="summary-sub">领先/滞后</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">负相关策略</div>
          <div class="summary-value">{{ backtestResult.summary.negativeCorrCount }}</div>
          <div class="summary-sub">同步联动</div>
        </div>

        <div class="summary-card">
          <div class="summary-label">平均总分</div>
          <div class="summary-value">{{ backtestResult.summary.avgTotalScore.toFixed(1) }}</div>
          <div class="summary-sub">所有信号平均</div>
        </div>
      </div>

      <!-- Signals Table -->
      <div class="signals-card">
        <div class="table-header">
          <h3>
            信号列表 <span class="list-hint">({{ tableSignals.length }} 条)</span>
            <span v-if="listTitleExtra" class="list-hint">· {{ listTitleExtra }}</span>
          </h3>
          <button
            class="filter-btn"
            :class="{ 'active': showTriggeredOnly }"
            @click="toggleTriggeredOnly"
          >
            <span class="filter-icon">{{ showTriggeredOnly ? '✓' : '○' }}</span>
            <span class="filter-text">只显示触发信号</span>
            <span class="filter-count">(触发：{{ backtestResult.summary.triggeredSignals }} / 总计：{{ backtestResult.summary.totalSignals }})</span>
          </button>
        </div>
        <div class="signals-table-container">
          <table v-if="tableSignals.length > 0">
            <thead>
              <tr>
                <th>时间</th>
                <th>交易对</th>
                <th>策略类型</th>
                <th>相关性分数</th>
                <th>成交量分数</th>
                <th>总分</th>
                <th>领先/滞后</th>
                <th>状态</th>
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
                  <span v-else>同步</span>
                </td>
                <td>
                  <span class="status-badge" :class="{ 'triggered': signal.triggered }">
                    {{ signal.triggered ? '可交易' : '观察中' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="no-signals">
            <span class="no-signals-icon">∅</span>
            <p>{{ showTriggeredOnly ? '本页无触发信号（可关闭「只显示触发」）' : '暂无信号' }}</p>
          </div>
        </div>

        <div v-if="backtestResult && backtestMode === 'db' && backtestResult.pagination" class="pagination-bar">
          <button
            type="button"
            class="page-btn"
            :disabled="isLoading || backtestResult.pagination.page <= 1"
            @click="goToDbPage(backtestResult.pagination.page - 1)"
          >
            上一页
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
            下一页
          </button>
        </div>

        <div v-if="backtestResult && backtestMode === 'replay' && replaySignalsFull.length > 0" class="pagination-bar">
          <button
            type="button"
            class="page-btn"
            :disabled="replayPage <= 1"
            @click="goToReplayPage(replayPage - 1)"
          >
            上一页
          </button>
          <span class="page-info">{{ replayPage }} / {{ replayTotalPages }}</span>
          <button
            type="button"
            class="page-btn"
            :disabled="replayPage >= replayTotalPages"
            @click="goToReplayPage(replayPage + 1)"
          >
            下一页
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

.mode-section .mode-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.85em;
  color: #1a1a1a;
  cursor: pointer;
}

.mode-option input {
  accent-color: #c41e3a;
}

.list-hint {
  font-weight: 400;
  color: #8b8b8b;
  font-size: 0.85em;
  text-transform: none;
  letter-spacing: 0;
}

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #ebebe6;
}

.page-btn {
  padding: 8px 16px;
  border: 2px solid #c4c4c4;
  background: #fff;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  color: #1a1a1a;
}

.page-btn:hover:not(:disabled) {
  border-color: #c41e3a;
  color: #c41e3a;
}

.page-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.page-info {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.85em;
  color: #5a5a5a;
  min-width: 5em;
  text-align: center;
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

.replay-progress-top {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 20px;
}

.replay-title {
  font-weight: 700;
  letter-spacing: 1px;
  color: #1a1a1a;
  font-size: 0.95em;
}

.progress-track {
  height: 10px;
  background: #ebebe6;
  border: 1px solid #c4c4c4;
  max-width: 420px;
  margin: 0 auto 12px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #c41e3a, #e85a6f);
  transition: width 0.25s ease;
}

.replay-percent {
  font-family: 'Courier New', Courier, monospace;
  font-size: 1.1em;
  font-weight: 700;
  color: #c41e3a;
  margin: 0 0 12px 0;
  text-transform: none;
  letter-spacing: 0;
}

.replay-main {
  color: #1a1a1a;
  font-size: 0.95em;
  margin: 8px 0;
  text-transform: none;
  letter-spacing: 0;
}

.replay-pair {
  font-family: 'Courier New', Courier, monospace;
  font-weight: 600;
}

.replay-stats {
  color: #5a5a5a;
  font-size: 0.88em;
  margin: 8px 0;
  text-transform: none;
  letter-spacing: 0;
}

.replay-detail {
  max-width: 520px;
  margin: 12px auto 0;
  line-height: 1.5;
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
