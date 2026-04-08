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

const status = ref<AutoTradingStatus | null>(null);
const positions = ref<Position[]>([]);
const orders = ref<Order[]>([]);
const history = ref<Trade[]>([]);
const loading = ref(false);
const testResult = ref<string | null>(null);
const testLoading = ref(false);

let refreshInterval: ReturnType<typeof setInterval>;

const fetchStatus = async () => {
  try {
    const res = await fetch('/api/auto-trading/status');
    status.value = await res.json();
  } catch (e) {
    console.error('Failed to fetch status:', e);
  }
};

const fetchPositions = async () => {
  try {
    // Get positions from Tiger trade client
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
  if (!confirm('确定要平掉所有仓位吗？')) return;

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

const testOrder = async () => {
  testLoading.value = true;
  testResult.value = null;

  try {
    // Test by placing a small order (1 share of AAPL) in simulation mode
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
      testResult.value = `✅ 测试成功: ${data.message || 'Order test passed'}`;
    } else {
      testResult.value = `❌ 测试失败: ${data.error || 'Unknown error'}`;
    }
  } catch (e: any) {
    testResult.value = `❌ 请求失败: ${e.message}`;
  } finally {
    testLoading.value = false;
  }
};

const formatTime = (time: string) => {
  return new Date(time).toLocaleString('zh-CN');
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
  fetchHistory();

  // Refresh every 10 seconds
  refreshInterval = setInterval(() => {
    fetchStatus();
    fetchHistory();
  }, 10000);
});

onUnmounted(() => {
  clearInterval(refreshInterval);
});
</script>

<template>
  <div class="auto-trading-view">
    <div class="page-header">
      <h1>🤖 自动交易</h1>
      <p>Tiger API 自动交易控制面板</p>
    </div>

    <!-- Status Card -->
    <div class="card status-card">
      <div class="card-header">
        <h2>📊 状态</h2>
        <div class="status-badges">
          <span class="badge" :class="status?.enabled ? 'enabled' : 'disabled'">
            {{ status?.enabled ? '✅ 已启用' : '⏹️ 已禁用' }}
          </span>
          <span class="badge" :class="status?.dryRun ? 'dry-run' : 'live'">
            {{ status?.dryRun ? '🧪 模拟模式' : '⚠️ 实盘模式' }}
          </span>
        </div>
      </div>

      <div class="status-content">
        <div class="status-item">
          <span class="label">活跃交易</span>
          <span class="value">{{ status?.activeTrades || 0 }}</span>
        </div>
        <div class="status-item">
          <span class="label">最大仓位 (股)</span>
          <span class="value">{{ status?.config?.maxPositionSize || 100 }}</span>
        </div>
        <div class="status-item">
          <span class="label">最大仓位 ($)</span>
          <span class="value">${{ status?.config?.maxPositionValue || 10000 }}</span>
        </div>
        <div class="status-item">
          <span class="label">止盈</span>
          <span class="value positive">+{{ status?.config?.takeProfitPct || 200 }}%</span>
        </div>
        <div class="status-item">
          <span class="label">止损</span>
          <span class="value negative">-{{ status?.config?.stopLossPct || 50 }}%</span>
        </div>
      </div>

      <div class="action-buttons">
        <button
          class="btn btn-success"
          @click="enableTrading(true)"
          :disabled="loading || status?.enabled"
        >
          🧪 启用 (模拟)
        </button>
        <button
          class="btn btn-warning"
          @click="enableTrading(false)"
          :disabled="loading || status?.enabled"
        >
          ⚠️ 启用 (实盘)
        </button>
        <button
          class="btn btn-danger"
          @click="disableTrading"
          :disabled="loading || !status?.enabled"
        >
          🛑 禁用
        </button>
        <button
          class="btn btn-secondary"
          @click="closeAllTrades"
          :disabled="loading"
        >
          📉 平掉所有仓位
        </button>
      </div>
    </div>

    <!-- Test Order Card -->
    <div class="card test-card">
      <div class="card-header">
        <h2>🧪 测试下单</h2>
      </div>
      <div class="test-content">
        <p>点击按钮测试 Tiger API 下单是否正常工作（不会执行真实交易）</p>
        <button class="btn btn-primary" @click="testOrder" :disabled="testLoading">
          {{ testLoading ? '测试中...' : '🧪 测试下单' }}
        </button>
        <div v-if="testResult" class="test-result" :class="testResult.includes('✅') ? 'success' : 'error'">
          {{ testResult }}
        </div>
      </div>
    </div>

    <!-- Active Trades -->
    <div class="card" v-if="status?.trades && status.trades.length > 0">
      <div class="card-header">
        <h2>📈 活跃交易</h2>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>股票</th>
              <th>方向</th>
              <th>数量</th>
              <th>入场价</th>
              <th>入场时间</th>
              <th>订单ID</th>
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
        <h2>📜 交易历史</h2>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>股票</th>
              <th>方向</th>
              <th>数量</th>
              <th>入场价</th>
              <th>出场价</th>
              <th>P&L %</th>
              <th>入场时间</th>
              <th>出场时间</th>
              <th>状态</th>
              <th>原因</th>
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
          暂无交易记录
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
</style>