<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useTradingStore } from '../stores/trading';

const store = useTradingStore();

onMounted(() => {
  store.fetchOpenTrades();
  store.fetchClosedTrades();
});

const formatTime = (timestamp: string) => {
  return new Date(timestamp).toLocaleString('en-US', { hour12: false });
};

const totalPnl = computed(() => {
  return store.closedTrades.reduce((sum, t) => sum + (t.pnlAmount || 0), 0);
});

const winCount = computed(() => {
  return store.closedTrades.filter(t => (t.pnlPct || 0) > 0).length;
});

const lossCount = computed(() => {
  return store.closedTrades.filter(t => (t.pnlPct || 0) <= 0).length;
});
</script>

<template>
  <div class="positions-view">
    <div class="view-header">
      <h1>
        <span class="title-separator">◆</span>
        POSITIONS
        <span class="title-separator">◆</span>
      </h1>
      <div class="header-stats">
        <span class="stat-pill">
          <span class="pill-label">OPEN</span>
          <span class="pill-value">{{ store.openTrades.length }}</span>
        </span>
        <span class="stat-pill">
          <span class="pill-label">CLOSED</span>
          <span class="pill-value">{{ store.closedTrades.length }}</span>
        </span>
        <span class="stat-pill" :class="totalPnl >= 0 ? 'profit' : 'loss'">
          <span class="pill-label">P&L</span>
          <span class="pill-value">${{ totalPnl.toFixed(2) }}</span>
        </span>
      </div>
    </div>

    <!-- Open Positions -->
    <div class="panel">
      <div class="panel-header">
        <h2>
          <span class="header-icon">▣</span>
          OPEN POSITIONS
        </h2>
        <span class="count-badge">{{ store.openTrades.length }} ACTIVE</span>
      </div>

      <div v-if="store.openTrades.length > 0" class="table-container">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Size</th>
              <th>Entry Price</th>
              <th>Mark Price</th>
              <th>Unrealized P&L</th>
              <th>Entry Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="trade in store.openTrades" :key="trade.id">
              <td class="symbol-cell">
                <span class="symbol-name">{{ trade.stockSymbol }}</span>
              </td>
              <td>
                <span class="side-badge long">LONG</span>
              </td>
              <td class="font-mono">{{ trade.positionSize }}</td>
              <td class="font-mono">${{ trade.entryPrice?.toFixed(2) }}</td>
              <td class="font-mono text-info">$--.--</td>
              <td class="font-mono text-secondary">$--.--</td>
              <td class="time-cell">{{ formatTime(trade.entryTime) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="empty-state">
        <span class="empty-icon">---</span>
        <p>No open positions</p>
      </div>
    </div>

    <!-- Closed Trades -->
    <div class="panel">
      <div class="panel-header">
        <h2>
          <span class="header-icon">▢</span>
          TRADE HISTORY
        </h2>
        <div class="win-loss">
          <span class="win-count text-success">{{ winCount }} W</span>
          <span class="loss-count text-error">{{ lossCount }} L</span>
        </div>
      </div>

      <div v-if="store.closedTrades.length > 0" class="table-container">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Size</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>P&L %</th>
              <th>P&L $</th>
              <th>Source</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="trade in store.closedTrades" :key="trade.id">
              <td class="symbol-cell">
                <span class="symbol-name">{{ trade.stockSymbol }}</span>
              </td>
              <td>
                <span class="side-badge" :class="trade.action === 'SELL' ? 'short' : 'long'">
                  {{ trade.action || 'LONG' }}
                </span>
              </td>
              <td class="font-mono">{{ trade.positionSize || trade.quantity || '-' }}</td>
              <td class="font-mono">${{ trade.entryPrice?.toFixed(2) }}</td>
              <td class="font-mono">${{ trade.exitPrice?.toFixed(2) }}</td>
              <td class="font-mono" :class="(trade.pnlPct || 0) > 0 ? 'text-success' : 'text-error'">
                {{ trade.pnlPct?.toFixed(2) }}%
              </td>
              <td class="font-mono" :class="(trade.pnlAmount || 0) > 0 ? 'text-success' : 'text-error'">
                ${{ trade.pnlAmount?.toFixed(2) }}
              </td>
              <td>
                <span class="source-badge" :class="trade.source === 'tiger' ? 'tiger' : 'local'">
                  {{ trade.source === 'tiger' ? 'TIGER' : 'LOCAL' }}
                </span>
              </td>
              <td class="time-cell">{{ formatTime(trade.exitTime || '') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="empty-state">
        <span class="empty-icon">---</span>
        <p>No trade history</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.positions-view {
  max-width: 1400px;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.view-header h1 {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.3em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.title-separator {
  color: #c41e3a;
  font-size: 0.7em;
}

.header-stats {
  display: flex;
  gap: 10px;
}

.stat-pill {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 90px;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
}

.pill-label {
  font-size: 0.6em;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.pill-value {
  font-size: 1em;
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
  color: #1a1a1a;
}

.stat-pill.profit .pill-value {
  color: #1a7f37;
}

.stat-pill.loss .pill-value {
  color: #c41e3a;
}

/* Panel */
.panel {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  margin-bottom: 16px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: #ebebe6;
  border-bottom: 2px solid #1a1a1a;
}

.panel-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.header-icon {
  font-size: 1em;
  color: #c41e3a;
}

.count-badge {
  background: #0056b3;
  color: #fff;
  padding: 4px 10px;
  border-radius: 2px;
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.5px;
  font-family: 'Courier New', Courier, monospace;
}

.win-loss {
  display: flex;
  gap: 10px;
}

.win-count, .loss-count {
  font-size: 0.8em;
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
}

/* Table */
.table-container {
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
  padding: 10px 14px;
  background: #ebebe6;
  border-bottom: 1px solid #c4c4c4;
}

td {
  padding: 10px 14px;
  border-bottom: 1px solid #ebebe6;
  font-size: 0.85em;
}

tr:hover {
  background: #f5f5f0;
}

.symbol-cell {
  font-weight: 700;
}

.symbol-name {
  color: #1a1a1a;
  font-family: 'Courier New', Courier, monospace;
}

.side-badge {
  display: inline-block;
  padding: 3px 8px;
  border: 1px solid #1a7f37;
  border-radius: 2px;
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  background: #d4edda;
  color: #1a7f37;
}

.side-badge.short {
  border-color: #c41e3a;
  background: #f8d7da;
  color: #c41e3a;
}

.source-badge {
  display: inline-block;
  padding: 2px 6px;
  border: 1px solid #8b8b8b;
  border-radius: 2px;
  font-size: 0.65em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  background: #f5f5f5;
  color: #5a5a5a;
}

.source-badge.tiger {
  border-color: #0056b3;
  background: #d1ecf1;
  color: #0056b3;
}

.time-cell {
  color: #8b8b8b;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.8em;
  white-space: nowrap;
}

.reason-cell {
  color: #5a5a5a;
  font-size: 0.85em;
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Empty State */
.empty-state {
  padding: 50px 20px;
  text-align: center;
  color: #8b8b8b;
}

.empty-icon {
  font-size: 2em;
  display: block;
  margin-bottom: 12px;
  opacity: 0.4;
  font-family: 'Courier New', Courier, monospace;
}

.empty-state p {
  font-size: 0.85em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
