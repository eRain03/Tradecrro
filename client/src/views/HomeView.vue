<script setup lang="ts">
import { onMounted, ref, computed, onUnmounted } from 'vue';
import { useTradingStore } from '../stores/trading';
import wsClient from '../api/websocket';
import api from '../api/http';

const store = useTradingStore();

// Animation triggers
const showContent = ref(false);
const showCards = ref(false);
const showLinks = ref(false);

// Rate limit monitoring
interface RateLimitStatus {
  name: string;
  current: number;
  max: number;
  safeLimit: number;
  percentage: number;
  status: 'safe' | 'warning' | 'danger' | 'critical';
  remaining: number;
}

const rateLimitData = ref<{
  health: { status: string; message: string };
  statuses: Record<string, RateLimitStatus>;
} | null>(null);

let rateLimitInterval: ReturnType<typeof setInterval> | null = null;

const fetchRateLimits = async () => {
  try {
    const data = await api.getRateLimits();
    rateLimitData.value = data;
  } catch (e) {
    console.error('Failed to fetch rate limits:', e);
  }
};

const rateLimitStatusList = computed(() => {
  if (!rateLimitData.value?.statuses) return [];
  return Object.entries(rateLimitData.value.statuses).map(([key, status]) => ({
    key,
    ...status,
  }));
});

const overallHealth = computed(() => {
  if (!rateLimitData.value?.health) return { status: 'unknown', message: 'Loading...' };
  return rateLimitData.value.health;
});

onMounted(() => {
  store.fetchPairs();
  store.fetchSignals();
  store.fetchOpenTrades();
  store.fetchClosedTrades();
  wsClient.connect();
  wsClient.onSignal((signal) => {
    store.addSignal(signal);
  });

  // Fetch rate limits
  fetchRateLimits();
  rateLimitInterval = setInterval(fetchRateLimits, 5000); // Every 5 seconds

  // Staggered animations
  setTimeout(() => showContent.value = true, 100);
  setTimeout(() => showCards.value = true, 300);
  setTimeout(() => showLinks.value = true, 500);
});

onUnmounted(() => {
  if (rateLimitInterval) {
    clearInterval(rateLimitInterval);
  }
});

const statusCards = computed(() => [
  { icon: '📊', label: 'Pairs Monitored', value: store.pairs.length, class: '' },
  { icon: '🚨', label: 'Signals Today', value: store.signals.length, class: '' },
  { icon: '📈', label: 'Open Positions', value: store.openTrades.length, class: '' },
  { icon: '⚡', label: 'System Status', value: 'ONLINE', class: 'online' },
]);

const systemInfo = [
  { icon: '📡', title: 'Data Source', value: 'Tiger API', detail: 'Real-time market data' },
  { icon: '🎯', title: 'Strategy', value: 'Statistical Arbitrage', detail: 'Correlation-based trading' },
  { icon: '⏱️', title: 'Sampling', value: '30s Interval', detail: '30m lookback window' },
];

const quickLinks = [
  { path: '/signals', icon: '🚨', text: 'View Signals' },
  { path: '/pairs', icon: '📊', text: 'Trading Pairs' },
  { path: '/trades', icon: '📈', text: 'Positions' },
  { path: '/backtest', icon: '🔬', text: 'Backtest' },
  { path: '/settings', icon: '⚙️', text: 'Settings' },
];
</script>

<template>
  <div class="home">
    <transition name="fade-down">
      <div class="welcome-banner" v-show="showContent">
        <div class="banner-decoration"></div>
        <h1>NEXUS TRADING SYSTEM</h1>
        <p class="subtitle">Statistical Arbitrage & Correlation Trading</p>
        <div class="banner-line"></div>
      </div>
    </transition>

    <transition-group name="card-stagger" tag="div" class="status-grid">
      <div class="status-card" v-for="(card, index) in statusCards" :key="card.label" v-show="showCards" :style="{ '--delay': index * 0.1 + 's' }">
        <div class="status-icon">{{ card.icon }}</div>
        <div class="status-info">
          <span class="status-label">{{ card.label }}</span>
          <span class="status-value" :class="card.class">{{ card.value }}</span>
        </div>
        <div class="card-shine"></div>
      </div>
    </transition-group>

    <transition name="fade-up">
      <div class="info-section" v-show="showContent">
        <h2>SYSTEM OVERVIEW</h2>
        <div class="info-grid">
          <div class="info-card" v-for="info in systemInfo" :key="info.title">
            <div class="info-icon">{{ info.icon }}</div>
            <h3>{{ info.title }}</h3>
            <p>{{ info.value }}</p>
            <p class="info-detail">{{ info.detail }}</p>
          </div>
        </div>
      </div>
    </transition>

    <!-- API Rate Limit Monitor -->
    <transition name="fade-up">
      <div class="rate-limit-section" v-show="showContent">
        <h2>API RATE LIMIT MONITOR</h2>
        <div class="rate-limit-card" :class="overallHealth.status">
          <div class="rate-limit-header">
            <div class="health-indicator" :class="overallHealth.status">
              <span class="health-dot"></span>
              <span class="health-label">{{ overallHealth.status.toUpperCase() }}</span>
            </div>
            <span class="health-message">{{ overallHealth.message }}</span>
          </div>

          <div class="rate-limit-bars">
            <div
              v-for="status in rateLimitStatusList"
              :key="status.key"
              class="rate-limit-item"
              :class="status.status"
            >
              <div class="limit-info">
                <span class="limit-name">{{ status.name }}</span>
                <span class="limit-count">{{ status.current }} / {{ status.safeLimit }}</span>
              </div>
              <div class="limit-bar-container">
                <div
                  class="limit-bar"
                  :style="{ width: Math.min(status.percentage, 100) + '%' }"
                  :class="status.status"
                ></div>
              </div>
              <span class="limit-remaining">{{ status.remaining }} remaining</span>
            </div>
          </div>

          <div class="rate-limit-footer">
            <span class="footer-note">⚠️ Safe limits are 50% of Tiger's actual limits</span>
          </div>
        </div>
      </div>
    </transition>

    <transition-group name="link-stagger" tag="div" class="quick-links">
      <RouterLink v-for="(link, index) in quickLinks" :key="link.path" :to="link.path" class="quick-link" v-show="showLinks" :style="{ '--delay': index * 0.08 + 's' }">
        <div class="link-icon-wrapper">
          <span class="link-icon">{{ link.icon }}</span>
        </div>
        <div class="link-content">
          <span class="link-text">{{ link.text }}</span>
          <span class="link-arrow">→</span>
        </div>
      </RouterLink>
    </transition-group>
  </div>
</template>

<style scoped>
.home {
  max-width: 1200px;
  padding: 0;
}

/* Welcome Banner */
.welcome-banner {
  background: linear-gradient(135deg, #ffffff 0%, #f8f8f5 100%);
  border: 1px solid #d4d4d4;
  box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  padding: 32px 24px;
  margin-bottom: 20px;
  text-align: center;
  position: relative;
  overflow: hidden;
  border-radius: 8px;
}

.banner-decoration {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #0056b3 0%, #1a7f37 50%, #c41e3a 100%);
}

.banner-line {
  width: 60px;
  height: 2px;
  background: #1a1a1a;
  margin: 16px auto 0;
  border-radius: 1px;
}

.welcome-banner h1 {
  font-size: 1.8em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 4px;
  text-transform: uppercase;
  margin-bottom: 10px;
  font-family: 'Times New Roman', Times, serif;
}

.subtitle {
  font-size: 0.95em;
  color: #5a5a5a;
  font-style: italic;
  letter-spacing: 0.5px;
}

/* Animation: Fade Down */
.fade-down-enter-active {
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-down-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-down-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}

.fade-down-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

/* Status Grid */
.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.status-card {
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border: 1px solid #d4d4d4;
  box-shadow: 0 3px 8px rgba(0,0,0,0.05);
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  animation: card-enter 0.5s ease-out forwards;
  animation-delay: var(--delay, 0s);
  opacity: 0;
}

@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(15px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.card-shine {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%);
  transition: left 0.6s ease;
}

.status-card:hover .card-shine {
  left: 100%;
}

.status-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0,0,0,0.08);
  border-color: #b4b4b4;
}

.status-icon {
  font-size: 2.2em;
  line-height: 1;
  transition: transform 0.3s ease;
}

.status-card:hover .status-icon {
  transform: scale(1.1);
}

.status-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-label {
  font-size: 0.7em;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
}

.status-value {
  font-size: 1.4em;
  font-weight: 700;
  color: #1a1a1a;
  font-family: 'Courier New', Courier, monospace;
}

.status-value.online {
  color: #1a7f37;
  animation: glow-green 2s ease-in-out infinite;
}

@keyframes glow-green {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}

/* Info Section */
.info-section {
  margin-bottom: 20px;
}

.fade-up-enter-active {
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-up-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.info-section h2 {
  font-size: 0.95em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-bottom: 16px;
  padding-left: 14px;
  border-left: 3px solid #c41e3a;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.info-card {
  background: linear-gradient(135deg, #ffffff 0%, #f8f8f5 100%);
  border: 1px solid #d4d4d4;
  box-shadow: 0 3px 8px rgba(0,0,0,0.05);
  padding: 20px;
  border-radius: 8px;
  transition: all 0.3s ease;
  position: relative;
}

.info-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0,0,0,0.08);
}

.info-icon {
  font-size: 1.5em;
  margin-bottom: 12px;
}

.info-card h3 {
  font-size: 0.75em;
  font-weight: 700;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 10px;
}

.info-card p {
  font-size: 1.05em;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 6px;
}

.info-detail {
  font-size: 0.85em;
  color: #8b8b8b;
  font-weight: 400;
}

/* Quick Links */
.quick-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.quick-link {
  display: flex;
  align-items: center;
  gap: 16px;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border: 1px solid #d4d4d4;
  box-shadow: 0 3px 8px rgba(0,0,0,0.05);
  padding: 18px 20px;
  text-decoration: none;
  color: #1a1a1a;
  border-radius: 8px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  animation: link-enter 0.4s ease-out forwards;
  animation-delay: var(--delay, 0s);
  opacity: 0;
}

@keyframes link-enter {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.quick-link:hover {
  transform: translateY(-2px) translateX(4px);
  box-shadow: 0 6px 20px rgba(0,0,0,0.1);
  border-color: #0056b3;
  background: linear-gradient(135deg, #f0f8ff 0%, #e8f4fc 100%);
}

.quick-link:hover .link-icon {
  transform: scale(1.2);
}

.quick-link:hover .link-arrow {
  transform: translateX(4px);
  opacity: 1;
}

.link-icon-wrapper {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #f0f0eb 0%, #e8e8e3 100%);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.quick-link:hover .link-icon-wrapper {
  background: linear-gradient(135deg, #e3f2fd 0%, #d1ecf1 100%);
}

.link-icon {
  font-size: 1.4em;
  line-height: 1;
  transition: transform 0.3s ease;
}

.link-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.link-text {
  font-size: 0.85em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.link-arrow {
  font-size: 1.1em;
  color: #0056b3;
  opacity: 0;
  transition: all 0.3s ease;
}

/* Rate Limit Monitor Section */
.rate-limit-section {
  margin-bottom: 20px;
}

.rate-limit-section h2 {
  font-size: 0.95em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-bottom: 16px;
  padding-left: 14px;
  border-left: 3px solid #0056b3;
}

.rate-limit-card {
  background: linear-gradient(135deg, #ffffff 0%, #f8f8f5 100%);
  border: 2px solid #d4d4d4;
  box-shadow: 0 3px 8px rgba(0,0,0,0.05);
  padding: 20px;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.rate-limit-card.healthy {
  border-color: #1a7f37;
}

.rate-limit-card.warning {
  border-color: #b36b00;
  background: linear-gradient(135deg, #fff8e6 0%, #fff5db 100%);
}

.rate-limit-card.danger {
  border-color: #c41e3a;
  background: linear-gradient(135deg, #fff0f0 0%, #ffe8e8 100%);
}

.rate-limit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e4e4e4;
}

.health-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.health-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  animation: pulse 2s ease-in-out infinite;
}

.health-indicator.healthy .health-dot {
  background: #1a7f37;
  box-shadow: 0 0 8px rgba(26, 127, 55, 0.5);
}

.health-indicator.warning .health-dot {
  background: #b36b00;
  box-shadow: 0 0 8px rgba(179, 107, 0, 0.5);
}

.health-indicator.danger .health-dot {
  background: #c41e3a;
  box-shadow: 0 0 8px rgba(196, 30, 58, 0.5);
  animation: pulse-danger 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.95); }
}

@keyframes pulse-danger {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.1); }
}

.health-label {
  font-size: 0.75em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.health-indicator.healthy .health-label { color: #1a7f37; }
.health-indicator.warning .health-label { color: #b36b00; }
.health-indicator.danger .health-label { color: #c41e3a; }

.health-message {
  font-size: 0.85em;
  color: #5a5a5a;
  font-style: italic;
}

.rate-limit-bars {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.rate-limit-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.limit-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.limit-name {
  font-size: 0.8em;
  font-weight: 600;
  color: #1a1a1a;
}

.limit-count {
  font-size: 0.85em;
  font-weight: 700;
  font-family: 'Courier New', Courier, monospace;
}

.rate-limit-item.safe .limit-count { color: #1a7f37; }
.rate-limit-item.warning .limit-count { color: #b36b00; }
.rate-limit-item.danger .limit-count { color: #c41e3a; }
.rate-limit-item.critical .limit-count { color: #c41e3a; animation: blink 0.5s infinite; }

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.limit-bar-container {
  height: 8px;
  background: #e8e8e8;
  border-radius: 4px;
  overflow: hidden;
}

.limit-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease, background 0.3s ease;
}

.limit-bar.safe {
  background: linear-gradient(90deg, #1a7f37 0%, #28a745 100%);
}

.limit-bar.warning {
  background: linear-gradient(90deg, #b36b00 0%, #d39e00 100%);
}

.limit-bar.danger {
  background: linear-gradient(90deg, #c41e3a 0%, #e85555 100%);
}

.limit-bar.critical {
  background: linear-gradient(90deg, #c41e3a 0%, #ff0000 100%);
  animation: pulse-bar 0.5s infinite;
}

@keyframes pulse-bar {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.limit-remaining {
  font-size: 0.7em;
  color: #8b8b8b;
}

.rate-limit-footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #e4e4e4;
}

.footer-note {
  font-size: 0.7em;
  color: #8b8b8b;
  font-style: italic;
}
</style>