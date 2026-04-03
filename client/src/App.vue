<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import { ref, computed, onMounted, onUnmounted } from 'vue';

const collapsed = ref(false);

// Market time display
const marketTime = ref('');
const marketOpen = ref(false);

const updateMarketTime = () => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();

  // Forex market hours: Opens Sunday 22:00 UTC, closes Friday 21:00 UTC
  // For simplicity, consider Monday-Friday 8:00-17:00 UTC as main trading hours
  const day = now.getUTCDay();

  // Check if market is open (forex is 24/5, but we show "active" during main hours)
  const isWeekday = day >= 1 && day <= 5;
  marketOpen.value = isWeekday && (utcHour >= 8 && utcHour < 17);

  const hours = String(utcHour).padStart(2, '0');
  const minutes = String(utcMin).padStart(2, '0');
  marketTime.value = `${hours}:${minutes} UTC`;
};

let timeInterval: ReturnType<typeof setInterval>;

onMounted(() => {
  updateMarketTime();
  timeInterval = setInterval(updateMarketTime, 1000);
});

onUnmounted(() => {
  clearInterval(timeInterval);
});
</script>

<template>
  <div class="app" :class="{ 'collapsed': collapsed }">
    <!-- Sidebar Navigation -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo" :class="{ 'collapsed-logo': collapsed }">
          <span class="logo-text">NEXUS</span>
        </div>
      </div>

      <nav class="nav-menu">
        <RouterLink to="/" class="nav-item" v-slot="{ isActive }">
          <span class="nav-icon">🏠</span>
          <span class="nav-text" v-show="!collapsed">Home</span>
        </RouterLink>
        <RouterLink to="/dashboard" class="nav-item" v-slot="{ isActive }">
          <span class="nav-icon">📊</span>
          <span class="nav-text" v-show="!collapsed">Dashboard</span>
        </RouterLink>
        <RouterLink to="/pairs" class="nav-item" v-slot="{ isActive }">
          <span class="nav-icon">🔗</span>
          <span class="nav-text" v-show="!collapsed">Pairs</span>
        </RouterLink>
        <RouterLink to="/signals" class="nav-item" v-slot="{ isActive }">
          <span class="nav-icon">🚨</span>
          <span class="nav-text" v-show="!collapsed">Signals</span>
        </RouterLink>
        <RouterLink to="/trades" class="nav-item" v-slot="{ isActive }">
          <span class="nav-icon">📈</span>
          <span class="nav-text" v-show="!collapsed">Positions</span>
        </RouterLink>
        <RouterLink to="/backtest" class="nav-item" v-slot="{ isActive }">
          <span class="nav-icon">🔬</span>
          <span class="nav-text" v-show="!collapsed">Backtest</span>
        </RouterLink>
        <RouterLink to="/settings" class="nav-item" v-slot="{ isActive }">
          <span class="nav-icon">⚙️</span>
          <span class="nav-text" v-show="!collapsed">Settings</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <div class="connection-status">
          <span class="status-dot connected"></span>
          <span class="status-text" v-show="!collapsed">IG LIVE</span>
        </div>
        <button class="collapse-btn" @click="collapsed = !collapsed">
          {{ collapsed ? '→' : '←' }}
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content">
      <!-- Top Bar -->
      <header class="top-bar">
        <div class="market-status" :class="{ 'market-closed': !marketOpen }">
          <span class="status-indicator"></span>
          <span class="status-label">{{ marketOpen ? 'MARKET OPEN' : 'MARKET CLOSED' }}</span>
          <span class="market-time">{{ marketTime }}</span>
        </div>
        <div class="account-info">
          <span class="account-id">Z69RME</span>
          <span class="account-type">LIVE</span>
        </div>
      </header>

      <!-- Page Content with animation -->
      <div class="page-content">
        <RouterView v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </transition>
        </RouterView>
      </div>
    </main>
  </div>
</template>

<style>
@import './assets/main.css';
</style>

<style scoped>
.app {
  display: flex;
  min-height: 100vh;
  background: linear-gradient(135deg, #f5f5f0 0%, #e8e8e3 100%);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.app.collapsed {
  --sidebar-width: 70px;
}

/* Sidebar */
.sidebar {
  width: 200px;
  background: #ffffff;
  border-right: 1px solid #d4d4d4;
  display: flex;
  flex-direction: column;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: fixed;
  height: 100vh;
  z-index: 100;
  box-shadow: 2px 0 8px rgba(0,0,0,0.06);
}

.sidebar-header {
  padding: 20px 16px;
  border-bottom: 2px solid #1a1a1a;
  background: linear-gradient(180deg, #f0f0eb 0%, #ebebe6 100%);
}

.logo {
  display: flex;
  align-items: center;
}

.logo-text {
  font-family: 'Times New Roman', Times, serif;
  font-size: 1.4em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 3px;
  text-transform: uppercase;
  transition: all 0.3s ease;
}

.app.collapsed .logo-text {
  font-size: 1em;
  letter-spacing: 1px;
}

.nav-menu {
  flex: 1;
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  color: #5a5a5a;
  text-decoration: none;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  border-left: 3px solid transparent;
  position: relative;
  overflow: hidden;
}

.nav-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent 0%, rgba(0,86,179,0.05) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.nav-item:hover::before {
  opacity: 1;
}

.nav-icon {
  font-size: 1.1em;
  margin-right: 12px;
  transition: transform 0.3s ease;
}

.nav-item:hover .nav-icon {
  transform: scale(1.15);
}

.app.collapsed .nav-icon {
  margin-right: 0;
}

.nav-item:hover {
  background: #f0f0eb;
  color: #1a1a1a;
}

.nav-item.router-link-active {
  background: linear-gradient(90deg, #e3f2fd 0%, #d1ecf1 100%);
  color: #0056b3;
  border-left-color: #0056b3;
  font-weight: 600;
}

.nav-item.router-link-active::before {
  opacity: 1;
}

.nav-text {
  font-size: 0.85em;
  font-family: Arial, Helvetica, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  white-space: nowrap;
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid #d4d4d4;
  background: linear-gradient(180deg, #ebebe6 0%, #f0f0eb 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1a7f37;
  border: 1px solid #0f5a22;
  animation: pulse-dot 2s infinite ease-in-out;
}

@keyframes pulse-dot {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(26, 127, 55, 0.4);
  }
  50% {
    transform: scale(1.1);
    box-shadow: 0 0 0 4px rgba(26, 127, 55, 0);
  }
}

.status-text {
  font-size: 0.75em;
  color: #1a7f37;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.collapse-btn {
  background: #ffffff;
  border: 1px solid #b4b4b4;
  color: #5a5a5a;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.collapse-btn:hover {
  background: #f0f0eb;
  transform: scale(1.05);
}

/* Main Content */
.main-content {
  flex: 1;
  margin-left: 200px;
  transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
}

.app.collapsed .main-content {
  margin-left: 70px;
}

/* Top Bar */
.top-bar {
  height: 44px;
  background: #ffffff;
  border-bottom: 1px solid #d4d4d4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  position: sticky;
  top: 0;
  z-index: 50;
  box-shadow: 0 2px 6px rgba(0,0,0,0.04);
}

.market-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.75em;
  color: #1a7f37;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 6px 12px;
  background: rgba(26, 127, 55, 0.08);
  border-radius: 6px;
  transition: all 0.3s ease;
}

.market-status.market-closed {
  color: #8b8b8b;
  background: rgba(139, 139, 139, 0.08);
}

.market-status.market-closed .status-indicator {
  background: #8b8b8b;
  border-color: #6b6b6b;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1a7f37;
  border: 1px solid #0f5a22;
  animation: pulse 2s infinite ease-in-out;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(0.9);
  }
}

.status-label {
  font-size: 0.85em;
}

.market-time {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.9em;
  color: inherit;
  font-weight: 600;
  padding-left: 8px;
  border-left: 1px solid rgba(26, 127, 55, 0.3);
}

.market-status.market-closed .market-time {
  border-left-color: rgba(139, 139, 139, 0.3);
}

.account-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.account-id {
  color: #5a5a5a;
  font-size: 0.85em;
  font-family: 'Courier New', Courier, monospace;
  font-weight: 600;
}

.account-type {
  background: linear-gradient(135deg, #0056b3 0%, #004494 100%);
  color: #fff;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  box-shadow: 0 1px 3px rgba(0,86,179,0.3);
}

.page-content {
  flex: 1;
  padding: 24px;
  overflow: auto;
}

/* Page transition animations */
.fade-slide-enter-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
