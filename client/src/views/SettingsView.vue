<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../api/http';

const settings = ref<Record<string, string>>({});
const loading = ref(true);

onMounted(async () => {
  try {
    settings.value = await api.getSettings();
  } catch (e) {
    console.error('Failed to load settings');
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="settings-view">
    <div class="view-header">
      <h1>
        <span class="title-separator">◆</span>
        SYSTEM SETTINGS
        <span class="title-separator">◆</span>
      </h1>
    </div>

    <div v-if="loading" class="loading-state">
      <span class="loading-spinner">⏳</span>
      <p>Loading settings...</p>
    </div>

    <div v-else class="settings-grid">
      <div class="settings-section">
        <div class="section-header">
          <h2>
            <span class="section-icon">▣</span>
            TRADING PARAMETERS
          </h2>
        </div>
        <div class="setting-list">
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Score Threshold</span>
              <span class="setting-desc">Minimum signal score to trigger</span>
            </div>
            <div class="setting-value">
              <span class="value-badge">{{ settings.score_threshold || '87' }}</span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Max Position %</span>
              <span class="setting-desc">Maximum portfolio allocation per position</span>
            </div>
            <div class="setting-value">
              <span class="value-badge">{{ settings.max_position_pct || '10' }}%</span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Take Profit</span>
              <span class="setting-desc">Target profit percentage to exit</span>
            </div>
            <div class="setting-value">
              <span class="value-badge success">{{ settings.take_profit_pct || '200' }}%</span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Stop Loss</span>
              <span class="setting-desc">Maximum loss before exiting position</span>
            </div>
            <div class="setting-value">
              <span class="value-badge error">{{ settings.stop_loss_pct || '50' }}%</span>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="section-header">
          <h2>
            <span class="section-icon">▢</span>
            DATA COLLECTION
          </h2>
        </div>
        <div class="setting-list">
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Sampling Interval</span>
              <span class="setting-desc">How often to fetch price data</span>
            </div>
            <div class="setting-value">
              <span class="value-badge">{{ settings.sampling_interval || '30' }}s</span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Lookback Window</span>
              <span class="setting-desc">Historical data window for analysis</span>
            </div>
            <div class="setting-value">
              <span class="value-badge">{{ settings.lookback_window || '30' }}m</span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Lag Intervals</span>
              <span class="setting-desc">Price lag calculation periods</span>
            </div>
            <div class="setting-value">
              <span class="value-badge">{{ settings.lag_intervals || '10' }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="section-header">
          <h2>
            <span class="section-icon">▣</span>
            SYSTEM STATUS
          </h2>
        </div>
        <div class="setting-list">
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Simulation Mode</span>
              <span class="setting-desc">Paper trading enabled/disabled</span>
            </div>
            <div class="setting-value">
              <span class="status-pill" :class="{ 'active': settings.is_simulated === '1' }">
                {{ settings.is_simulated === '1' ? 'ENABLED' : 'DISABLED' }}
              </span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Data Source</span>
              <span class="setting-desc">Market data provider</span>
            </div>
            <div class="setting-value">
              <span class="source-badge ig">IG MARKETS</span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Environment</span>
              <span class="setting-desc">API environment mode</span>
            </div>
            <div class="setting-value">
              <span class="source-badge demo">LIVE</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  max-width: 1200px;
}

.view-header {
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

.loading-state {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  padding: 60px 20px;
  text-align: center;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
}

.loading-spinner {
  font-size: 2em;
  display: block;
  margin-bottom: 16px;
  opacity: 0.4;
  font-family: 'Courier New', Courier, monospace;
}

.loading-state p {
  color: #5a5a5a;
  font-size: 0.9em;
  text-transform: uppercase;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.settings-section {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
}

.section-header {
  border-bottom: 2px solid #1a1a1a;
  background: #ebebe6;
}

.section-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75em;
  font-weight: 700;
  color: #1a1a1a;
  padding: 12px 16px;
  margin: 0;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.section-icon {
  color: #c41e3a;
  font-size: 1.2em;
}

.setting-list {
  padding: 8px 0;
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #ebebe6;
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-row:hover {
  background: #f5f5f0;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-label {
  font-weight: 700;
  color: #1a1a1a;
  font-size: 0.9em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.setting-desc {
  font-size: 0.75em;
  color: #8b8b8b;
}

.setting-value {
  flex-shrink: 0;
}

.value-badge {
  background: #ebebe6;
  color: #1a1a1a;
  padding: 5px 10px;
  border: 1px solid #c4c4c4;
  font-family: 'Courier New', Courier, monospace;
  font-weight: 700;
  font-size: 0.85em;
  border-radius: 2px;
}

.value-badge.success {
  background: #d4edda;
  color: #1a7f37;
  border-color: #1a7f37;
}

.value-badge.error {
  background: #f8d7da;
  color: #c41e3a;
  border-color: #c41e3a;
}

.status-pill {
  background: #ebebe6;
  color: #5a5a5a;
  padding: 5px 10px;
  border: 1px solid #c4c4c4;
  border-radius: 2px;
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-family: 'Courier New', Courier, monospace;
}

.status-pill.active {
  background: #d4edda;
  color: #1a7f37;
  border-color: #1a7f37;
}

.source-badge {
  background: #ebebe6;
  color: #5a5a5a;
  padding: 5px 10px;
  border: 1px solid #c4c4c4;
  border-radius: 2px;
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-family: 'Courier New', Courier, monospace;
}

.source-badge.ig {
  color: #0056b3;
  border-color: #0056b3;
}

.source-badge.demo {
  color: #b36b00;
  border-color: #b36b00;
}
</style>
