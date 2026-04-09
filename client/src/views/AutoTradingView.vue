<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

interface AutoTradingStatus {
  enabled: boolean;
  dryRun: boolean;
  activeTrades: number;
  trades: Trade[];
  config: {
    maxPositionSize: number;
    maxPositionValue: number;
    takeProfitPct: number;
    stopLossPct: number;
  };
}

interface OptionsTradingStatus {
  enabled: boolean;
  dryRun: boolean;
  activeTrades: number;
  trades: OptionsTrade[];
  config: {
    maxCapitalPct: number;
    takeProfitPct: number;
    stopLossPct: number;
  };
}

interface Trade {
  id: number;
  signalId: number;
  symbol: string;
  action: string;
  quantity: number;
  orderId?: string;
  entryPrice?: number;
  exitPrice?: number;
  entryTime: string;
  exitTime?: string;
  pnlPct?: number;
  pnlAmount?: number;
  status: string;
  exitReason?: string;
}

interface OptionsTrade {
  id: number;
  signalId: number;
  strategyType: 'positive_lag' | 'negative_corr';
  legA?: {
    underlyingSymbol: string;
    contractSymbol: string;
    quantity: number;
    entryAsk: number;
    status: string;
  };
  legB?: {
    underlyingSymbol: string;
    contractSymbol: string;
    quantity: number;
    entryAsk: number;
    status: string;
  };
  allocatedCapital: number;
  status: string;
  entryTime: string;
  exitTime?: string;
  pnlPct?: number;
  pnlAmount?: number;
  exitReason?: string;
}

interface Position {
  symbol: string;
  quantity: number;
  avgCost: number;
  marketValue: number;
  unrealizedPnl: number;
}

interface Order {
  orderId: string;
  symbol: string;
  action: string;
  quantity: number;
  filledQuantity: number;
  orderType: string;
  status: string;
  limitPrice: number;
}

interface DataSourceStatus {
  name: string;
  available: boolean;
  lastError?: string;
  lastErrorTime?: string;
  pausedUntil?: string;
  requestCount: number;
  errorCount: number;
}

interface APIStatus {
  currentSource: string;
  primarySource: string;
  usingFallback: boolean;
  sources: {
    tiger: DataSourceStatus;
    yahoo: DataSourceStatus;
  };
}

interface OptionContract {
  symbol: string;
  contractSymbol: string;
  strike: number;
  expiration: string;
  optionType: string;
  bid: number;
  ask: number;
  delta: number;
  volume: number;
  openInterest: number;
}

const status = ref<AutoTradingStatus | null>(null);
const optionsStatus = ref<OptionsTradingStatus | null>(null);
const apiStatus = ref<APIStatus | null>(null);
const positions = ref<Position[]>([]);
const orders = ref<Order[]>([]);
const history = ref<Trade[]>([]);
const optionsTrades = ref<OptionsTrade[]>([]);
const optionChain = ref<OptionContract[]>([]);
const optionChainSymbol = ref('');
const loading = ref(false);
const optionsLoading = ref(false);
const testResult = ref<string | null>(null);
const testLoading = ref(false);
const chainLoading = ref(false);

let refreshInterval: ReturnType<typeof setInterval>;

const fetchStatus = async () => {
  try {
    const res = await fetch('/api/auto-trading/status');
    status.value = await res.json();
  } catch (e) {
    console.error('Failed to fetch status:', e);
  }
};

const fetchAPIStatus = async () => {
  try {
    const res = await fetch('/api/auto-trading/api-status');
    apiStatus.value = await res.json();
  } catch (e) {
    console.error('Failed to fetch API status:', e);
  }
};

const fetchPositions = async () => {
  try {
    const res = await fetch('/api/auto-trading/positions');
    if (res.ok) {
      positions.value = await res.json();
    }
  } catch (e) {
    console.error('Failed to fetch positions:', e);
  }
};

const fetchOrders = async () => {
  try {
    const res = await fetch('/api/auto-trading/orders');
    if (res.ok) {
      orders.value = await res.json();
    }
  } catch (e) {
    console.error('Failed to fetch orders:', e);
  }
};

const fetchHistory = async () => {
  try {
    const res = await fetch('/api/auto-trading/history?limit=50');
    const data = await res.json();
    history.value = data.trades || [];
  } catch (e) {
    console.error('Failed to fetch history:', e);
  }
};

const fetchOptionsStatus = async () => {
  try {
    const res = await fetch('/api/auto-trading/options-status');
    optionsStatus.value = await res.json();
  } catch (e) {
    console.error('Failed to fetch options status:', e);
  }
};

const fetchOptionsTrades = async () => {
  try {
    const res = await fetch('/api/auto-trading/options-trades');
    const data = await res.json();
    optionsTrades.value = data.trades || [];
  } catch (e) {
    console.error('Failed to fetch options trades:', e);
  }
};

const fetchOptionChain = async () => {
  if (!optionChainSymbol.value.trim()) return;

  chainLoading.value = true;
  try {
    const res = await fetch(`/api/auto-trading/option-chain/${optionChainSymbol.value.trim().toUpperCase()}`);
    const data = await res.json();
    optionChain.value = data.contracts || [];
  } catch (e) {
    console.error('Failed to fetch option chain:', e);
    optionChain.value = [];
  } finally {
    chainLoading.value = false;
  }
};

const enableTrading = async (dryRun: boolean) => {
  loading.value = true;
  try {
    const res = await fetch('/api/auto-trading/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchStatus();
    }
  } catch (e) {
    console.error('Failed to enable trading:', e);
  } finally {
    loading.value = false;
  }
};

const disableTrading = async () => {
  loading.value = true;
  try {
    const res = await fetch('/api/auto-trading/disable', {
      method: 'POST',
    });
    const data = await res.json();
    if (data.success) {
      await fetchStatus();
    }
  } catch (e) {
    console.error('Failed to disable trading:', e);
  } finally {
    loading.value = false;
  }
};

const closeAllTrades = async () => {
  if (!confirm('Are you sure you want to close all positions?')) return;

  loading.value = true;
  try {
    await fetch('/api/auto-trading/close-all', {
      method: 'POST',
    });
    await fetchStatus();
    await fetchPositions();
  } catch (e) {
    console.error('Failed to close all trades:', e);
  } finally {
    loading.value = false;
  }
};

const enableOptionsTrading = async (dryRun: boolean) => {
  optionsLoading.value = true;
  try {
    const res = await fetch('/api/auto-trading/options-enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchOptionsStatus();
    }
  } catch (e) {
    console.error('Failed to enable options trading:', e);
  } finally {
    optionsLoading.value = false;
  }
};

const disableOptionsTrading = async () => {
  optionsLoading.value = true;
  try {
    const res = await fetch('/api/auto-trading/options-disable', {
      method: 'POST',
    });
    const data = await res.json();
    if (data.success) {
      await fetchOptionsStatus();
    }
  } catch (e) {
    console.error('Failed to disable options trading:', e);
  } finally {
    optionsLoading.value = false;
  }
};

const testOrder = async () => {
  testLoading.value = true;
  testResult.value = null;

  try {
    const res = await fetch('/api/auto-trading/test-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: 'AAPL',
        quantity: 1,
      }),
    });
    const data = await res.json();

    if (data.success) {
      testResult.value = `✅ Test passed: ${data.message || 'Tiger API connection OK'}`;
    } else {
      testResult.value = `❌ Test failed: ${data.error || 'Unknown error'}`;
    }
  } catch (e: any) {
    testResult.value = `❌ Request failed: ${e.message}`;
  } finally {
    testLoading.value = false;
  }
};

const formatTime = (time: string) => {
  return new Date(time).toLocaleString('en-US');
};

const formatPnl = (pnl?: number) => {
  if (pnl === undefined || pnl === null) return '-';
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}${pnl.toFixed(2)}%`;
};

const getPnlClass = (pnl?: number) => {
  if (pnl === undefined || pnl === null) return '';
  return pnl >= 0 ? 'positive' : 'negative';
};

onMounted(() => {
  fetchStatus();
  fetchOptionsStatus();
  fetchAPIStatus();
  fetchHistory();
  fetchOptionsTrades();

  refreshInterval = setInterval(() => {
    fetchStatus();
    fetchOptionsStatus();
    fetchAPIStatus();
    fetchHistory();
    fetchOptionsTrades();
  }, 10000);
});

onUnmounted(() => {
  clearInterval(refreshInterval);
});
</script>

<template>
  <div class="auto-trading-view">
    <div class="page-header">
      <h1>🤖 Auto Trading</h1>
      <p>Tiger API automated trading control panel</p>
    </div>

    <!-- Status Card -->
    <div class="card status-card">
      <div class="card-header">
        <h2>📊 Status</h2>
        <div class="status-badges">
          <span class="badge" :class="status?.enabled ? 'enabled' : 'disabled'">
            {{ status?.enabled ? '✅ Enabled' : '⏹️ Disabled' }}
          </span>
          <span class="badge" :class="status?.dryRun ? 'dry-run' : 'live'">
            {{ status?.dryRun ? '🧪 Simulation' : '⚠️ LIVE' }}
          </span>
        </div>
      </div>

      <div class="status-content">
        <div class="status-item">
          <span class="label">Active Trades</span>
          <span class="value">{{ status?.activeTrades || 0 }}</span>
        </div>
        <div class="status-item">
          <span class="label">Max Position (shares)</span>
          <span class="value">{{ status?.config?.maxPositionSize || 100 }}</span>
        </div>
        <div class="status-item">
          <span class="label">Max Position ($)</span>
          <span class="value">${{ status?.config?.maxPositionValue || 10000 }}</span>
        </div>
        <div class="status-item">
          <span class="label">Take Profit</span>
          <span class="value positive">+{{ status?.config?.takeProfitPct || 200 }}%</span>
        </div>
        <div class="status-item">
          <span class="label">Stop Loss</span>
          <span class="value negative">-{{ status?.config?.stopLossPct || 50 }}%</span>
        </div>
      </div>

      <div class="action-buttons">
        <button
          class="btn btn-success"
          @click="enableTrading(true)"
          :disabled="loading || status?.enabled"
        >
          🧪 Enable (Simulation)
        </button>
        <button
          class="btn btn-warning"
          @click="enableTrading(false)"
          :disabled="loading || status?.enabled"
        >
          ⚠️ Enable (LIVE)
        </button>
        <button
          class="btn btn-danger"
          @click="disableTrading"
          :disabled="loading || !status?.enabled"
        >
          🛑 Disable
        </button>
        <button
          class="btn btn-secondary"
          @click="closeAllTrades"
          :disabled="loading"
        >
          📉 Close All Positions
        </button>
      </div>
    </div>

    <!-- API Status Card -->
    <div class="card api-status-card">
      <div class="card-header">
        <h2>🔌 Data Source Status</h2>
        <div class="status-badges">
          <span class="badge" :class="apiStatus?.usingFallback ? 'warning' : 'success'">
            {{ apiStatus?.currentSource?.toUpperCase() || 'UNKNOWN' }}
          </span>
          <span v-if="apiStatus?.usingFallback" class="badge warning">
            ⚠️ Using Fallback
          </span>
        </div>
      </div>

      <div class="api-sources">
        <div class="source-item" v-if="apiStatus?.sources?.tiger">
          <div class="source-header">
            <span class="source-name">🐯 Tiger API</span>
            <span class="source-status" :class="apiStatus.sources.tiger.available ? 'available' : 'unavailable'">
              {{ apiStatus.sources.tiger.available ? '✅ Available' : '❌ Unavailable' }}
            </span>
          </div>
          <div class="source-details" v-if="apiStatus.sources.tiger">
            <span>Requests: {{ apiStatus.sources.tiger.requestCount }}</span>
            <span>Errors: {{ apiStatus.sources.tiger.errorCount }}</span>
          </div>
          <div class="source-error" v-if="apiStatus.sources.tiger.lastError">
            <span class="error-label">Last Error:</span>
            <span class="error-message">{{ apiStatus.sources.tiger.lastError }}</span>
          </div>
          <div class="source-paused" v-if="apiStatus.sources.tiger.pausedUntil">
            <span>⏳ Paused until: {{ formatTime(apiStatus.sources.tiger.pausedUntil) }}</span>
          </div>
        </div>

        <div class="source-item" v-if="apiStatus?.sources?.yahoo">
          <div class="source-header">
            <span class="source-name">📈 Yahoo Finance</span>
            <span class="source-status" :class="apiStatus.sources.yahoo.available ? 'available' : 'unavailable'">
              {{ apiStatus.sources.yahoo.available ? '✅ Available' : '❌ Unavailable' }}
            </span>
          </div>
          <div class="source-details" v-if="apiStatus.sources.yahoo">
            <span>Requests: {{ apiStatus.sources.yahoo.requestCount }}</span>
            <span>Errors: {{ apiStatus.sources.yahoo.errorCount }}</span>
          </div>
        </div>
      </div>

      <div class="failover-info" v-if="apiStatus?.usingFallback">
        <p>⚠️ Currently using Yahoo Finance as fallback. System will automatically switch back to Tiger when it recovers.</p>
      </div>
    </div>

    <!-- Test Order Card -->
    <div class="card test-card">
      <div class="card-header">
        <h2>🧪 Test Order</h2>
      </div>
      <div class="test-content">
        <p>Click to test if Tiger API order execution is working properly (will not execute real trades)</p>
        <button class="btn btn-primary" @click="testOrder" :disabled="testLoading">
          {{ testLoading ? 'Testing...' : '🧪 Test Order' }}
        </button>
        <div v-if="testResult" class="test-result" :class="testResult.includes('✅') ? 'success' : 'error'">
          {{ testResult }}
        </div>
      </div>
    </div>

    <!-- Options Trading Card -->
    <div class="card options-card">
      <div class="card-header">
        <h2>📊 Options Trading</h2>
        <div class="status-badges">
          <span class="badge" :class="optionsStatus?.enabled ? 'enabled' : 'disabled'">
            {{ optionsStatus?.enabled ? '✅ Enabled' : '⏹️ Disabled' }}
          </span>
          <span class="badge" :class="optionsStatus?.dryRun ? 'dry-run' : 'live'">
            {{ optionsStatus?.dryRun ? '🧪 Simulation' : '⚠️ LIVE' }}
          </span>
        </div>
      </div>

      <div class="status-content">
        <div class="status-item">
          <span class="label">Active Options Trades</span>
          <span class="value">{{ optionsStatus?.activeTrades || 0 }}</span>
        </div>
        <div class="status-item">
          <span class="label">Max Capital %</span>
          <span class="value">{{ optionsStatus?.config?.maxCapitalPct || 10 }}%</span>
        </div>
        <div class="status-item">
          <span class="label">Take Profit</span>
          <span class="value positive">+{{ optionsStatus?.config?.takeProfitPct || 200 }}%</span>
        </div>
        <div class="status-item">
          <span class="label">Stop Loss</span>
          <span class="value negative">-{{ optionsStatus?.config?.stopLossPct || 50 }}%</span>
        </div>
      </div>

      <div class="action-buttons">
        <button
          class="btn btn-success"
          @click="enableOptionsTrading(true)"
          :disabled="optionsLoading || optionsStatus?.enabled"
        >
          🧪 Enable Options (Simulation)
        </button>
        <button
          class="btn btn-warning"
          @click="enableOptionsTrading(false)"
          :disabled="optionsLoading || optionsStatus?.enabled"
        >
          ⚠️ Enable Options (LIVE)
        </button>
        <button
          class="btn btn-danger"
          @click="disableOptionsTrading"
          :disabled="optionsLoading || !optionsStatus?.enabled"
        >
          🛑 Disable Options
        </button>
      </div>
    </div>

    <!-- Option Chain Lookup -->
    <div class="card chain-card">
      <div class="card-header">
        <h2>🔍 Option Chain Lookup</h2>
      </div>
      <div class="chain-content">
        <div class="chain-input">
          <input
            type="text"
            v-model="optionChainSymbol"
            placeholder="Enter symbol (e.g., AAPL)"
            class="symbol-input"
          />
          <button class="btn btn-primary" @click="fetchOptionChain" :disabled="chainLoading">
            {{ chainLoading ? 'Loading...' : '🔍 Lookup' }}
          </button>
        </div>
        <div v-if="optionChain.length > 0" class="chain-results">
          <table class="data-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Strike</th>
                <th>Type</th>
                <th>Bid</th>
                <th>Ask</th>
                <th>Delta</th>
                <th>Volume</th>
                <th>OI</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="opt in optionChain.slice(0, 20)" :key="opt.contractSymbol">
                <td class="mono">{{ opt.contractSymbol }}</td>
                <td>${{ opt.strike }}</td>
                <td :class="opt.optionType === 'CALL' ? 'buy' : 'sell'">{{ opt.optionType }}</td>
                <td>${{ opt.bid?.toFixed(2) || '-' }}</td>
                <td>${{ opt.ask?.toFixed(2) || '-' }}</td>
                <td>{{ opt.delta?.toFixed(2) || '-' }}</td>
                <td>{{ opt.volume || 0 }}</td>
                <td>{{ opt.openInterest || 0 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else-if="optionChainSymbol && !chainLoading" class="empty-state">
          No option contracts found
        </div>
      </div>
    </div>

    <!-- Active Options Trades -->
    <div class="card" v-if="optionsTrades && optionsTrades.length > 0">
      <div class="card-header">
        <h2>📈 Active Options Trades</h2>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Leg A Contract</th>
              <th>Leg A Qty</th>
              <th>Leg B Contract</th>
              <th>Leg B Qty</th>
              <th>Capital</th>
              <th>Entry Time</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="trade in optionsTrades" :key="trade.id">
              <td>{{ trade.strategyType }}</td>
              <td class="mono">{{ trade.legA?.contractSymbol || '-' }}</td>
              <td>{{ trade.legA?.quantity || '-' }}</td>
              <td class="mono">{{ trade.legB?.contractSymbol || '-' }}</td>
              <td>{{ trade.legB?.quantity || '-' }}</td>
              <td>${{ trade.allocatedCapital?.toFixed(2) }}</td>
              <td>{{ formatTime(trade.entryTime) }}</td>
              <td>
                <span class="status-badge" :class="trade.status">{{ trade.status }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Active Trades -->
    <div class="card" v-if="status?.trades && status.trades.length > 0">
      <div class="card-header">
        <h2>📈 Active Trades</h2>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Action</th>
              <th>Quantity</th>
              <th>Entry Price</th>
              <th>Entry Time</th>
              <th>Order ID</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="trade in status?.trades" :key="trade.id">
              <td class="symbol">{{ trade.symbol }}</td>
              <td :class="trade.action === 'BUY' ? 'buy' : 'sell'">{{ trade.action }}</td>
              <td>{{ trade.quantity }}</td>
              <td>${{ trade.entryPrice?.toFixed(2) }}</td>
              <td>{{ formatTime(trade.entryTime) }}</td>
              <td class="mono">{{ trade.orderId || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Trade History -->
    <div class="card">
      <div class="card-header">
        <h2>📜 Trade History</h2>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Action</th>
              <th>Qty</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>P&L %</th>
              <th>Entry Time</th>
              <th>Exit Time</th>
              <th>Status</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="trade in history" :key="trade.id">
              <td class="symbol">{{ trade.symbol }}</td>
              <td :class="trade.action === 'BUY' ? 'buy' : 'sell'">{{ trade.action }}</td>
              <td>{{ trade.quantity }}</td>
              <td>${{ trade.entryPrice?.toFixed(2) || '-' }}</td>
              <td>${{ trade.exitPrice?.toFixed(2) || '-' }}</td>
              <td :class="getPnlClass(trade.pnlPct)">{{ formatPnl(trade.pnlPct) }}</td>
              <td>{{ formatTime(trade.entryTime) }}</td>
              <td>{{ trade.exitTime ? formatTime(trade.exitTime) : '-' }}</td>
              <td>
                <span class="status-badge" :class="trade.status">
                  {{ trade.status }}
                </span>
              </td>
              <td>{{ trade.exitReason || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="history.length === 0" class="empty-state">
          No trade history
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auto-trading-view {
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 1.8em;
  color: #1a1a1a;
  margin-bottom: 4px;
}

.page-header p {
  color: #666;
  font-size: 0.9em;
}

.card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.card-header h2 {
  font-size: 1.1em;
  color: #333;
}

.status-badges {
  display: flex;
  gap: 8px;
}

.badge {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 0.8em;
  font-weight: 600;
}

.badge.enabled {
  background: #e6f4ea;
  color: #1a7f37;
}

.badge.disabled {
  background: #f5f5f5;
  color: #666;
}

.badge.dry-run {
  background: #fff3cd;
  color: #856404;
}

.badge.live {
  background: #f8d7da;
  color: #721c24;
}

.badge.success {
  background: #e6f4ea;
  color: #1a7f37;
}

.badge.warning {
  background: #fff3cd;
  color: #856404;
}

.api-status-card .api-sources {
  padding: 20px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.source-item {
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.source-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.source-name {
  font-weight: 600;
  font-size: 1em;
}

.source-status {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 600;
}

.source-status.available {
  background: #e6f4ea;
  color: #1a7f37;
}

.source-status.unavailable {
  background: #f8d7da;
  color: #721c24;
}

.source-details {
  display: flex;
  gap: 16px;
  font-size: 0.85em;
  color: #666;
}

.source-error {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fff5f5;
  border-radius: 4px;
  font-size: 0.85em;
}

.source-error .error-label {
  color: #dc3545;
  font-weight: 600;
  margin-right: 8px;
}

.source-error .error-message {
  color: #666;
}

.source-paused {
  margin-top: 8px;
  font-size: 0.85em;
  color: #856404;
}

.failover-info {
  padding: 12px 20px 20px;
  color: #856404;
  font-size: 0.9em;
}

.failover-info p {
  margin: 0;
}

.status-content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  padding: 20px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-item .label {
  font-size: 0.8em;
  color: #666;
  text-transform: uppercase;
}

.status-item .value {
  font-size: 1.2em;
  font-weight: 600;
  color: #1a1a1a;
}

.status-item .value.positive {
  color: #1a7f37;
}

.status-item .value.negative {
  color: #dc3545;
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 0 20px 20px;
}

.btn {
  padding: 10px 20px;
  border-radius: 6px;
  border: none;
  font-size: 0.85em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #0056b3;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #004494;
}

.btn-success {
  background: #1a7f37;
  color: #fff;
}

.btn-success:hover:not(:disabled) {
  background: #0f5a22;
}

.btn-warning {
  background: #ff9800;
  color: #fff;
}

.btn-warning:hover:not(:disabled) {
  background: #e68900;
}

.btn-danger {
  background: #dc3545;
  color: #fff;
}

.btn-danger:hover:not(:disabled) {
  background: #c82333;
}

.btn-secondary {
  background: #6c757d;
  color: #fff;
}

.btn-secondary:hover:not(:disabled) {
  background: #5a6268;
}

.test-card .test-content {
  padding: 20px;
}

.test-content p {
  color: #666;
  margin-bottom: 16px;
}

.test-result {
  margin-top: 16px;
  padding: 12px 16px;
  border-radius: 6px;
  font-weight: 500;
}

.test-result.success {
  background: #e6f4ea;
  color: #1a7f37;
}

.test-result.error {
  background: #f8d7da;
  color: #721c24;
}

.table-container {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

.data-table th {
  font-size: 0.75em;
  text-transform: uppercase;
  color: #666;
  font-weight: 600;
  background: #fafafa;
}

.data-table td {
  font-size: 0.9em;
}

.data-table .symbol {
  font-weight: 600;
  color: #0056b3;
}

.data-table .buy {
  color: #1a7f37;
}

.data-table .sell {
  color: #dc3545;
}

.data-table .positive {
  color: #1a7f37;
  font-weight: 600;
}

.data-table .negative {
  color: #dc3545;
  font-weight: 600;
}

.data-table .mono {
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
}

.status-badge.filled {
  background: #e6f4ea;
  color: #1a7f37;
}

.status-badge.closed {
  background: #f5f5f5;
  color: #666;
}

.status-badge.pending {
  background: #fff3cd;
  color: #856404;
}

.status-badge.failed {
  background: #f8d7da;
  color: #721c24;
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: #999;
}

.options-card {
  border-left: 4px solid #6c5ce7;
}

.chain-card .chain-content {
  padding: 20px;
}

.chain-input {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.symbol-input {
  padding: 10px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9em;
  width: 200px;
}

.symbol-input:focus {
  border-color: #0056b3;
  outline: none;
}

.chain-results {
  overflow-x: auto;
}

.chain-card .data-table td.mono {
  font-size: 0.75em;
}
</style>