<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useTradingStore } from '../stores/trading';
import api from '../api/http';

const store = useTradingStore();

onMounted(() => {
  store.fetchPairs();
});

// Form state
const showAddForm = ref(false);
const newStockA = ref('');
const newStockB = ref('');
const newStrategyType = ref('positive_lag');
const formError = ref('');
const formSuccess = ref('');

const toggleForm = () => {
  showAddForm.value = !showAddForm.value;
  resetForm();
};

const resetForm = () => {
  newStockA.value = '';
  newStockB.value = '';
  newStrategyType.value = 'positive_lag';
  formError.value = '';
  formSuccess.value = '';
};

const submitPair = async () => {
  formError.value = '';
  formSuccess.value = '';

  // Validate
  if (!newStockA.value.trim() || !newStockB.value.trim()) {
    formError.value = 'Both symbols are required';
    return;
  }

  if (newStockA.value.trim() === newStockB.value.trim()) {
    formError.value = 'Stock A and Stock B cannot be the same symbol';
    return;
  }

  try {
    await api.createPair({
      stockA: newStockA.value.trim().toUpperCase(),
      stockB: newStockB.value.trim().toUpperCase(),
      strategyType: newStrategyType.value,
      isActive: true,
    });
    formSuccess.value = 'Pair created successfully!';
    resetForm();
    store.fetchPairs();
    setTimeout(() => {
      showAddForm.value = false;
    }, 1500);
  } catch (error: any) {
    formError.value = error.message || 'Failed to create pair';
  }
};
</script>

<template>
  <div class="pairs-view">
    <div class="view-header">
      <h1>
        <span class="title-separator">◆</span>
        TRADING PAIRS
        <span class="title-separator">◆</span>
      </h1>
      <div class="header-actions">
        <span class="pair-count">{{ store.pairs.length }} PAIRS</span>
        <button class="add-btn" @click="toggleForm">
          <span class="add-icon">+</span>
          ADD PAIR
        </button>
      </div>
    </div>

    <!-- Add Pair Form -->
    <div v-if="showAddForm" class="add-form-container">
      <form @submit.prevent="submitPair" class="add-form">
        <h3>CREATE NEW TRADING PAIR</h3>

        <div class="form-row">
          <div class="form-group">
            <label for="stockA">Stock A Symbol</label>
            <input
              id="stockA"
              v-model="newStockA"
              type="text"
              placeholder="e.g., AAPL"
              class="form-input"
              :class="{ 'input-error': formError }"
            />
          </div>

          <div class="form-group">
            <label for="stockB">Stock B Symbol</label>
            <input
              id="stockB"
              v-model="newStockB"
              type="text"
              placeholder="e.g., MSFT"
              class="form-input"
              :class="{ 'input-error': formError }"
            />
          </div>

          <div class="form-group">
            <label for="strategyType">Strategy Type</label>
            <select
              id="strategyType"
              v-model="newStrategyType"
              class="form-input"
            >
              <option value="positive_lag">Positive Lag (Lead-Lag)</option>
              <option value="negative_corr">Negative Correlation</option>
            </select>
          </div>
        </div>

        <div v-if="formError" class="form-message error">
          ⚠️ {{ formError }}
        </div>
        <div v-if="formSuccess" class="form-message success">
          ✓ {{ formSuccess }}
        </div>

        <div class="form-actions">
          <button type="button" class="btn-cancel" @click="toggleForm">CANCEL</button>
          <button type="submit" class="btn-submit">CREATE PAIR</button>
        </div>
      </form>
    </div>

    <div v-if="store.isLoading" class="loading-state">
      <span class="loading-spinner">⏳</span>
      <p>Loading pairs...</p>
    </div>

    <div v-else-if="store.pairs.length > 0" class="pairs-grid">
      <div v-for="pair in store.pairs" :key="pair.id" class="pair-card">
        <div class="pair-header">
          <div class="pair-symbols">
            <span class="symbol-a">{{ pair.stockA }}</span>
            <span class="vs-badge">/</span>
            <span class="symbol-b">{{ pair.stockB }}</span>
          </div>
          <span class="strategy-tag">{{ pair.strategyType }}</span>
        </div>

        <div class="pair-stats">
          <div class="stat-item">
            <span class="stat-label">Strategy</span>
            <span class="stat-value" style="font-size: 0.85em;">{{ pair.strategyType }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Status</span>
            <span class="stat-value" style="font-size: 0.85em;" :class="pair.isActive ? 'text-success' : 'text-error'">
              {{ pair.isActive ? 'ACTIVE' : 'INACTIVE' }}
            </span>
          </div>
        </div>

        <div class="pair-footer">
          <span class="status-indicator" :class="{ active: pair.isActive }">
            <span class="status-dot"></span>
            {{ pair.isActive ? 'Active' : 'Paused' }}
          </span>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <span class="empty-icon">---</span>
      <h2>NO PAIRS CONFIGURED</h2>
      <p>Add trading pairs to start monitoring</p>
    </div>
  </div>
</template>

<style scoped>
.pairs-view {
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
  gap: 12px;
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pair-count {
  background: #0056b3;
  color: #fff;
  padding: 6px 12px;
  border-radius: 2px;
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.5px;
  font-family: 'Courier New', Courier, monospace;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: #c41e3a;
  color: #fff;
  border: 2px solid #8b1e2a;
  cursor: pointer;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  transition: all 0.2s ease;
}

.add-btn:hover {
  background: #a01830;
  border-color: #6b1620;
}

.add-icon {
  font-size: 1.2em;
  line-height: 1;
}

/* Add Form */
.add-form-container {
  margin-bottom: 20px;
  background: #ffffff;
  border: 2px solid #1a1a1a;
  box-shadow: 3px 3px 6px rgba(0,0,0,0.08);
}

.add-form {
  padding: 20px;
}

.add-form h3 {
  font-size: 0.85em;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid #c41e3a;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 0.7em;
  font-weight: 700;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-input {
  padding: 10px 12px;
  border: 2px solid #c4c4c4;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.9em;
  font-weight: 600;
  background: #f8f9fa;
  transition: all 0.2s;
}

.form-input:focus {
  outline: none;
  border-color: #0056b3;
  background: #fff;
}

.form-input.input-error {
  border-color: #c41e3a;
  background: #f8d7da;
}

.form-message {
  padding: 10px 14px;
  margin-bottom: 16px;
  border-radius: 2px;
  font-size: 0.85em;
  font-weight: 600;
}

.form-message.error {
  background: #f8d7da;
  color: #8b1e2a;
  border: 1px solid #f5c6cb;
}

.form-message.success {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-cancel, .btn-submit {
  padding: 10px 20px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  border: 2px solid #c4c4c4;
  transition: all 0.2s;
}

.btn-cancel {
  background: #f8f9fa;
  color: #5a5a5a;
}

.btn-cancel:hover {
  background: #e9ecef;
  border-color: #8b8b8b;
}

.btn-submit {
  background: #c41e3a;
  color: #fff;
  border-color: #8b1e2a;
}

.btn-submit:hover {
  background: #a01830;
  border-color: #6b1620;
}

.loading-state, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  text-align: center;
}

.loading-spinner, .empty-icon {
  font-size: 2em;
  margin-bottom: 16px;
  opacity: 0.4;
  font-family: 'Courier New', Courier, monospace;
}

.loading-state p, .empty-state h2 {
  color: #5a5a5a;
  margin-bottom: 8px;
  font-size: 0.9em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.empty-state p {
  color: #8b8b8b;
  font-size: 0.85em;
}

/* Pairs Grid */
.pairs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

/* Pair Card */
.pair-card {
  background: #ffffff;
  border: 1px solid #c4c4c4;
  box-shadow: 2px 2px 4px rgba(0,0,0,0.04);
  padding: 14px;
}

.pair-card:hover {
  box-shadow: 3px 3px 6px rgba(0,0,0,0.08);
}

.pair-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebebe6;
}

.pair-symbols {
  display: flex;
  align-items: center;
  gap: 6px;
}

.symbol-a, .symbol-b {
  font-size: 1em;
  font-weight: 700;
  color: #1a1a1a;
  font-family: 'Courier New', Courier, monospace;
}

.vs-badge {
  color: #8b8b8b;
  font-size: 0.8em;
}

.strategy-tag {
  background: #d1ecf1;
  color: #0056b3;
  padding: 3px 8px;
  border: 1px solid #b8d9e8;
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* Pair Stats */
.pair-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid #ebebe6;
  border-bottom: 1px solid #ebebe6;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.stat-label {
  font-size: 0.65em;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.stat-value {
  font-size: 0.95em;
  font-weight: 600;
  color: #1a1a1a;
}

/* Pair Footer */
.pair-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  color: #5a5a5a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8b8b8b;
}

.status-indicator.active .status-dot {
  background: #1a7f37;
  border: 1px solid #0f5a22;
}

.status-indicator.active {
  color: #1a7f37;
  font-weight: 700;
}
</style>
