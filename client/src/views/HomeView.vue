<script setup lang="ts">
import { onMounted } from 'vue';
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
</script>

<template>
  <div class="home">
    <div class="welcome-banner">
      <h1>STATARB TRADING SYSTEM</h1>
      <p class="subtitle">Statistical Arbitrage & Correlation Trading</p>
    </div>

    <div class="status-grid">
      <div class="status-card">
        <div class="status-icon">📊</div>
        <div class="status-info">
          <span class="status-label">Pairs Monitored</span>
          <span class="status-value">{{ store.pairs.length }}</span>
        </div>
      </div>

      <div class="status-card">
        <div class="status-icon">🚨</div>
        <div class="status-info">
          <span class="status-label">Signals Today</span>
          <span class="status-value">{{ store.signals.length }}</span>
        </div>
      </div>

      <div class="status-card">
        <div class="status-icon">📈</div>
        <div class="status-info">
          <span class="status-label">Open Positions</span>
          <span class="status-value">{{ store.openTrades.length }}</span>
        </div>
      </div>

      <div class="status-card">
        <div class="status-icon">⚙️</div>
        <div class="status-info">
          <span class="status-label">System Status</span>
          <span class="status-value online">ONLINE</span>
        </div>
      </div>
    </div>

    <div class="info-section">
      <h2>SYSTEM OVERVIEW</h2>
      <div class="info-grid">
        <div class="info-card">
          <h3>Data Source</h3>
          <p>Yahoo Finance</p>
          <p class="info-detail">Free stock/ETF data</p>
        </div>
        <div class="info-card">
          <h3>Strategy</h3>
          <p>Statistical Arbitrage</p>
          <p class="info-detail">Correlation-based trading</p>
        </div>
        <div class="info-card">
          <h3>Sampling</h3>
          <p>30s Interval</p>
          <p class="info-detail">30m lookback window</p>
        </div>
      </div>
    </div>

    <div class="quick-links">
      <RouterLink to="/signals" class="quick-link">
        <span class="link-icon">🚨</span>
        <span class="link-text">View Signals</span>
      </RouterLink>
      <RouterLink to="/pairs" class="quick-link">
        <span class="link-icon">📊</span>
        <span class="link-text">Trading Pairs</span>
      </RouterLink>
      <RouterLink to="/trades" class="quick-link">
        <span class="link-icon">📈</span>
        <span class="link-text">Positions</span>
      </RouterLink>
      <RouterLink to="/settings" class="quick-link">
        <span class="link-icon">⚙️</span>
        <span class="link-text">Settings</span>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.home {
  max-width: 1200px;
  padding: 10px 0;
}

.welcome-banner {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  padding: 20px 24px;
  margin-bottom: 16px;
  text-align: center;
}

.welcome-banner h1 {
  font-size: 1.5em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-bottom: 8px;
  font-family: 'Times New Roman', Times, serif;
}

.subtitle {
  font-size: 0.85em;
  color: #5a5a5a;
  font-style: italic;
}

/* Status Grid */
.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.status-card {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.status-icon {
  font-size: 2em;
  line-height: 1;
}

.status-info {
  display: flex;
  flex-direction: column;
}

.status-label {
  font-size: 0.7em;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.status-value {
  font-size: 1.2em;
  font-weight: 700;
  color: #1a1a1a;
  font-family: 'Courier New', Courier, monospace;
}

.status-value.online {
  color: #1a7f37;
}

/* Info Section */
.info-section {
  margin-bottom: 16px;
}

.info-section h2 {
  font-size: 0.9em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 12px;
  padding-left: 12px;
  border-left: 3px solid #c41e3a;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
}

.info-card {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  padding: 16px;
}

.info-card h3 {
  font-size: 0.75em;
  font-weight: 700;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.info-card p {
  font-size: 1em;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 4px;
}

.info-detail {
  font-size: 0.85em;
  color: #8b8b8b;
  font-weight: 400;
}

/* Quick Links */
.quick-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.quick-link {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  padding: 16px;
  text-decoration: none;
  color: #1a1a1a;
  transition: all 0.2s;
}

.quick-link:hover {
  box-shadow: 3px 3px 6px rgba(0,0,0,0.08);
  border-color: #8b8b8b;
}

.link-icon {
  font-size: 1.5em;
  line-height: 1;
}

.link-text {
  font-size: 0.85em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
