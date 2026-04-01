<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue';
import { useTradingStore } from '../stores/trading';
import wsClient from '../api/websocket';

const store = useTradingStore();

onMounted(() => {
  store.fetchPairs();
  store.fetchSignals();
  store.fetchOpenTrades();
  store.fetchClosedTrades();
  wsClient.connect();
  wsClient.onSignal((signal) => {
    store.addSignal(signal);
  });
});

onUnmounted(() => {
  wsClient.disconnect();
});

const formatTime = (timestamp: string) => {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour12: false });
};

const formatMoney = (value: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};

const pnlClass = computed(() => (value: number) => ({
  'text-success': value > 0,
  'text-error': value < 0,
}));
</script>

<template>
  <div class="dashboard">
    <!-- Stats Overview -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Portfolio Value</div>
        <div class="stat-value">$0.00</div>
        <div class="stat-change text-secondary">Simulation mode</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Day P&L</div>
        <div class="stat-value text-secondary">$0.00</div>
        <div class="stat-change text-secondary">No trades yet</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Open Positions</div>
        <div class="stat-value">{{ store.openTrades.length }}</div>
        <div class="stat-change text-secondary">Active trades</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value" :class="store.winRate > 50 ? 'text-success' : 'text-error'">
          {{ store.winRate.toFixed(1) }}%
        </div>
        <div class="stat-change text-secondary">{{ store.closedTrades.length }} closed trades</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total P&L</div>
        <div class="stat-value" :class="store.totalPnl > 0 ? 'text-success' : 'text-error'">
          {{ formatMoney(store.totalPnl) }}
        </div>
        <div class="stat-change text-secondary">All time</div>
      </div>
    </div>

    <!-- Main Grid -->
    <div class="dashboard-grid">
      <!-- Market Watch -->
      <div class="panel market-watch">
        <div class="panel-header">
          <h2>MARKET WATCH</h2>
          <span class="live-indicator">
            <span class="pulse-dot"></span> LIVE
          </span>
        </div>
        <div class="market-list">
          <div v-for="pair in store.pairs.slice(0, 8)" :key="pair.id" class="market-item">
            <div class="market-info">
              <span class="symbol-name">{{ pair.stockA }}</span>
              <span class="symbol-sep">/</span>
              <span class="symbol-name">{{ pair.stockB }}</span>
            </div>
            <div class="market-status">
              <span class="status-badge" :class="{ active: pair.isActive }">
                {{ pair.isActive ? 'ACTIVE' : 'INACTIVE' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Signals -->
      <div class="panel signals-panel">
        <div class="panel-header">
          <h2>RECENT SIGNALS</h2>
          <span class="signal-count">{{ store.signals.length }} signals</span>
        </div>
        <div class="signals-table">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Pair</th>
                <th>Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="signal in store.signals.slice(0, 8)" :key="signal.id" class="signal-row">
                <td class="time-cell">{{ formatTime(signal.timestamp) }}</td>
                <td class="pair-cell">
                  <span class="pair-name">{{ signal.stockA }}</span>
                  <span class="vs">vs</span>
                  <span class="pair-name">{{ signal.stockB }}</span>
                </td>
                <td>
                  <span class="score-badge" :class="{ 'high-score': signal.totalScore >= 70 }">
                    {{ Math.round(signal.totalScore) }}
                  </span>
                </td>
                <td>
                  <span class="status-badge" :class="{ 'triggered': signal.triggered }">
                    {{ signal.triggered ? 'TRIGGERED' : 'WAITING' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Open Positions -->
      <div class="panel positions-panel">
        <div class="panel-header">
          <h2>OPEN POSITIONS</h2>
          <span class="position-count">{{ store.openTrades.length }} active</span>
        </div>
        <div v-if="store.openTrades.length > 0" class="positions-table">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Size</th>
                <th>Entry</th>
                <th>Current</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="trade in store.openTrades" :key="trade.id">
                <td class="symbol-cell">{{ trade.stockSymbol }}</td>
                <td>{{ trade.positionSize }}</td>
                <td class="font-mono">${{ trade.entryPrice?.toFixed(2) }}</td>
                <td class="font-mono text-info">$--.--</td>
                <td class="font-mono text-secondary">$--.--</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-state">
          <span class="empty-icon">---</span>
          <p>No open positions</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 0;
}

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.stat-card {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  padding: 14px 16px;
}

.stat-label {
  font-size: 0.7em;
  color: #5a5a5a;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
}

.stat-value {
  font-size: 1.4em;
  font-weight: 700;
  color: #1a1a1a;
  font-family: 'Courier New', Courier, monospace;
}

.stat-change {
  font-size: 0.75em;
  margin-top: 4px;
  font-family: 'Courier New', Courier, monospace;
}

/* Dashboard Grid */
.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 1.5fr 1fr;
  gap: 12px;
}

/* Panel */
.panel {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 380px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 2px solid #1a1a1a;
  background: #ebebe6;
}

.panel-header h2 {
  font-size: 0.8em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.live-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7em;
  color: #1a7f37;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #1a7f37;
  border: 1px solid #0f5a22;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.signal-count, .position-count {
  font-size: 0.7em;
  color: #5a5a5a;
  background: #ffffff;
  padding: 3px 8px;
  border: 1px solid #c4c4c4;
  border-radius: 2px;
  font-family: 'Courier New', Courier, monospace;
}

/* Market Watch */
.market-list {
  flex: 1;
  overflow-y: auto;
}

.market-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid #ebebe6;
}

.market-item:hover {
  background: #f5f5f0;
}

.market-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.symbol-name {
  font-weight: 700;
  color: #1a1a1a;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.9em;
}

.symbol-sep {
  color: #8b8b8b;
}

.market-price {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.85em;
}

/* Signals Table */
.signals-table {
  flex: 1;
  overflow-y: auto;
}

.signals-table table {
  width: 100%;
  border-collapse: collapse;
}

.signals-table th {
  text-align: left;
  font-size: 0.65em;
  text-transform: uppercase;
  color: #5a5a5a;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 8px 12px;
  background: #ebebe6;
  border-bottom: 1px solid #c4c4c4;
}

.signals-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #ebebe6;
  font-size: 0.85em;
}

.time-cell {
  color: #8b8b8b;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.8em;
}

.pair-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pair-name {
  font-weight: 600;
  font-family: 'Courier New', Courier, monospace;
}

.vs {
  color: #8b8b8b;
  font-size: 0.8em;
}

.score-badge {
  display: inline-block;
  padding: 2px 6px;
  border: 1px solid #c4c4c4;
  background: #ffffff;
  color: #5a5a5a;
  font-family: 'Courier New', Courier, monospace;
  font-weight: 700;
  font-size: 0.85em;
  border-radius: 2px;
}

.score-badge.high-score {
  background: #b36b00;
  color: #fff;
  border-color: #8b5200;
}

.status-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 0.65em;
  font-weight: 700;
  letter-spacing: 0.5px;
  background: #ebebe6;
  color: #5a5a5a;
  border: 1px solid #c4c4c4;
}

.status-badge.triggered {
  background: #c41e3a;
  color: #fff;
  border-color: #8b1e2a;
}

/* Positions Panel */
.positions-panel .positions-table {
  flex: 1;
  overflow-y: auto;
}

.positions-panel table {
  width: 100%;
  border-collapse: collapse;
}

.positions-panel th {
  text-align: left;
  font-size: 0.65em;
  text-transform: uppercase;
  color: #5a5a5a;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 8px 12px;
  background: #ebebe6;
  border-bottom: 1px solid #c4c4c4;
}

.positions-panel td {
  padding: 8px 12px;
  border-bottom: 1px solid #ebebe6;
  font-size: 0.85em;
}

.symbol-cell {
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
}

/* Empty State */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #8b8b8b;
  padding: 30px 20px;
}

.empty-icon {
  font-size: 2em;
  margin-bottom: 10px;
  opacity: 0.4;
  font-family: 'Courier New', Courier, monospace;
}

.empty-state p {
  font-size: 0.85em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
