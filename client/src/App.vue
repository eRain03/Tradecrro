<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import { ref } from 'vue';

const collapsed = ref(false);
</script>

<template>
  <div class="app" :class="{ 'collapsed': collapsed }">
    <!-- Sidebar Navigation -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo" :class="{ 'collapsed-logo': collapsed }">
          <span class="logo-text">STATARB</span>
        </div>
      </div>

      <nav class="nav-menu">
        <RouterLink to="/home" class="nav-item" v-slot="{ isActive }">
          <span class="nav-text" v-show="!collapsed">Home</span>
        </RouterLink>
        <RouterLink to="/dashboard" class="nav-item" v-slot="{ isActive }">
          <span class="nav-text" v-show="!collapsed">Dashboard</span>
        </RouterLink>
        <RouterLink to="/pairs" class="nav-item" v-slot="{ isActive }">
          <span class="nav-text" v-show="!collapsed">Pairs</span>
        </RouterLink>
        <RouterLink to="/signals" class="nav-item" v-slot="{ isActive }">
          <span class="nav-text" v-show="!collapsed">Signals</span>
        </RouterLink>
        <RouterLink to="/trades" class="nav-item" v-slot="{ isActive }">
          <span class="nav-text" v-show="!collapsed">Positions</span>
        </RouterLink>
        <RouterLink to="/backtest" class="nav-item" v-slot="{ isActive }">
          <span class="nav-text" v-show="!collapsed">Backtest</span>
        </RouterLink>
        <RouterLink to="/settings" class="nav-item" v-slot="{ isActive }">
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
        <div class="market-status">
          <span class="status-indicator"></span>
          <span>MARKET OPEN</span>
        </div>
        <div class="account-info">
          <span class="account-id">Z69RME</span>
          <span class="account-type">LIVE</span>
        </div>
      </header>

      <!-- Page Content -->
      <div class="page-content">
        <RouterView />
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
  background: #f5f5f0;
  transition: all 0.3s ease;
}

.app.collapsed {
  --sidebar-width: 70px;
}

/* Sidebar */
.sidebar {
  width: 200px;
  background: #ffffff;
  border-right: 1px solid #c4c4c4;
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  position: fixed;
  height: 100vh;
  z-index: 100;
}

.sidebar-header {
  padding: 20px 16px;
  border-bottom: 2px solid #1a1a1a;
  background: #ebebe6;
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
  letter-spacing: 2px;
  text-transform: uppercase;
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
  padding: 10px 16px;
  color: #5a5a5a;
  text-decoration: none;
  transition: all 0.2s;
  cursor: pointer;
  border-left: 3px solid transparent;
}

.nav-item:hover {
  background: #ebebe6;
  color: #1a1a1a;
}

.nav-item.router-link-active {
  background: #d1ecf1;
  color: #0056b3;
  border-left-color: #0056b3;
  font-weight: 600;
}

.nav-text {
  font-size: 0.9em;
  font-family: Arial, Helvetica, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid #c4c4c4;
  background: #ebebe6;
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
  border: 1px solid #8b8b8b;
  color: #5a5a5a;
  width: 24px;
  height: 24px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.collapse-btn:hover {
  background: #ebebe6;
}

/* Main Content */
.main-content {
  flex: 1;
  margin-left: 200px;
  transition: margin-left 0.3s ease;
  display: flex;
  flex-direction: column;
}

.app.collapsed .main-content {
  margin-left: 70px;
}

/* Top Bar */
.top-bar {
  height: 40px;
  background: #ffffff;
  border-bottom: 1px solid #c4c4c4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  position: sticky;
  top: 0;
  z-index: 50;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

.market-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75em;
  color: #1a7f37;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1a7f37;
  border: 1px solid #0f5a22;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.account-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.account-id {
  color: #5a5a5a;
  font-size: 0.8em;
  font-family: 'Courier New', Courier, monospace;
  font-weight: 600;
}

.account-type {
  background: #0056b3;
  color: #fff;
  padding: 2px 8px;
  border-radius: 2px;
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.page-content {
  flex: 1;
  padding: 20px;
  overflow: auto;
}
</style>
