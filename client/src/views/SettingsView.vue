<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../api/http';

const settings = ref<Record<string, string>>({});
const loading = ref(true);
const saving = ref(false);
const saveSuccess = ref(false);
const saveSuccessKey = ref('');

// Edit states for each editable setting
const editingMaxPairs = ref(false);
const maxPairsInput = ref('');

const editingScoreThreshold = ref(false);
const scoreThresholdInput = ref('');

const editingSamplingInterval = ref(false);
const samplingIntervalInput = ref('');

const editingLookbackWindow = ref(false);
const lookbackWindowInput = ref('');

const editingLagIntervals = ref(false);
const lagIntervalsInput = ref('');

const editingExpectedMove = ref(false);
const expectedMoveInput = ref('');

onMounted(async () => {
  try {
    settings.value = await api.getSettings();
    maxPairsInput.value = settings.value.max_pairs || '400';
    scoreThresholdInput.value = settings.value.score_threshold || '87';
    samplingIntervalInput.value = settings.value.sampling_interval || '30';
    lookbackWindowInput.value = settings.value.lookback_window || '30';
    lagIntervalsInput.value = settings.value.lag_intervals || '2';
    expectedMoveInput.value = settings.value.expected_move_threshold || '0.5';
  } catch (e) {
    console.error('Failed to load settings');
  } finally {
    loading.value = false;
  }
});

const showSaveSuccess = (key: string) => {
  saveSuccess.value = true;
  saveSuccessKey.value = key;
  setTimeout(() => {
    saveSuccess.value = false;
    saveSuccessKey.value = '';
  }, 2000);
};

// Max Pairs editing
const startEditMaxPairs = () => {
  editingMaxPairs.value = true;
  maxPairsInput.value = settings.value.max_pairs || '400';
};

const cancelEditMaxPairs = () => {
  editingMaxPairs.value = false;
  maxPairsInput.value = settings.value.max_pairs || '400';
};

const saveMaxPairs = async () => {
  const value = parseInt(maxPairsInput.value, 10);
  if (value < 1 || value > 10000 || !Number.isFinite(value)) {
    alert('Please enter a valid number between 1 and 10000');
    return;
  }
  await saveSetting('max_pairs', String(value));
  editingMaxPairs.value = false;
};

// Score Threshold editing
const startEditScoreThreshold = () => {
  editingScoreThreshold.value = true;
  scoreThresholdInput.value = settings.value.score_threshold || '87';
};

const cancelEditScoreThreshold = () => {
  editingScoreThreshold.value = false;
  scoreThresholdInput.value = settings.value.score_threshold || '87';
};

const saveScoreThreshold = async () => {
  const value = parseInt(scoreThresholdInput.value, 10);
  if (value < 1 || value > 100 || !Number.isFinite(value)) {
    alert('Please enter a valid number between 1 and 100');
    return;
  }
  await saveSetting('score_threshold', String(value));
  editingScoreThreshold.value = false;
};

// Sampling Interval editing
const startEditSamplingInterval = () => {
  editingSamplingInterval.value = true;
  samplingIntervalInput.value = settings.value.sampling_interval || '30';
};

const cancelEditSamplingInterval = () => {
  editingSamplingInterval.value = false;
  samplingIntervalInput.value = settings.value.sampling_interval || '30';
};

const saveSamplingInterval = async () => {
  const value = parseInt(samplingIntervalInput.value, 10);
  if (value < 5 || value > 300 || !Number.isFinite(value)) {
    alert('Please enter a valid number between 5 and 300 seconds');
    return;
  }
  await saveSetting('sampling_interval', String(value));
  editingSamplingInterval.value = false;
};

// Lookback Window editing
const startEditLookbackWindow = () => {
  editingLookbackWindow.value = true;
  lookbackWindowInput.value = settings.value.lookback_window || '30';
};

const cancelEditLookbackWindow = () => {
  editingLookbackWindow.value = false;
  lookbackWindowInput.value = settings.value.lookback_window || '30';
};

const saveLookbackWindow = async () => {
  const value = parseInt(lookbackWindowInput.value, 10);
  if (value < 5 || value > 240 || !Number.isFinite(value)) {
    alert('Please enter a valid number between 5 and 240 minutes');
    return;
  }
  await saveSetting('lookback_window', String(value));
  editingLookbackWindow.value = false;
};

// Lag Intervals editing
const startEditLagIntervals = () => {
  editingLagIntervals.value = true;
  lagIntervalsInput.value = settings.value.lag_intervals || '2';
};

const cancelEditLagIntervals = () => {
  editingLagIntervals.value = false;
  lagIntervalsInput.value = settings.value.lag_intervals || '2';
};

const saveLagIntervals = async () => {
  const value = parseInt(lagIntervalsInput.value, 10);
  if (value < 1 || value > 20 || !Number.isFinite(value)) {
    alert('Please enter a valid number between 1 and 20 intervals');
    return;
  }
  await saveSetting('lag_intervals', String(value));
  editingLagIntervals.value = false;
};

// Expected Move Threshold editing
const startEditExpectedMove = () => {
  editingExpectedMove.value = true;
  expectedMoveInput.value = settings.value.expected_move_threshold || '0.5';
};

const cancelEditExpectedMove = () => {
  editingExpectedMove.value = false;
  expectedMoveInput.value = settings.value.expected_move_threshold || '0.5';
};

const saveExpectedMove = async () => {
  const value = parseFloat(expectedMoveInput.value);
  if (value < 0.01 || value > 50 || !Number.isFinite(value)) {
    alert('Please enter a valid number between 0.01 and 50 percent');
    return;
  }
  await saveSetting('expected_move_threshold', String(value));
  editingExpectedMove.value = false;
};

// Generic save function
const saveSetting = async (key: string, value: string) => {
  saving.value = true;
  try {
    await api.updateSetting(key, value);
    settings.value[key] = value;
    showSaveSuccess(key);
    // Refresh settings to get updated values
    settings.value = await api.getSettings();
  } catch (e) {
    console.error(`Failed to save ${key}`);
    alert('Failed to save setting');
  } finally {
    saving.value = false;
  }
};
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
              <span class="setting-desc">Minimum signal score to trigger (1-100)</span>
            </div>
            <div class="setting-value editable">
              <template v-if="!editingScoreThreshold">
                <span class="value-badge">{{ settings.score_threshold || '87' }}</span>
                <button class="edit-btn" @click="startEditScoreThreshold">EDIT</button>
              </template>
              <template v-else>
                <input
                  type="number"
                  v-model.number="scoreThresholdInput"
                  class="edit-input"
                  min="1"
                  max="100"
                />
                <button class="save-btn" @click="saveScoreThreshold" :disabled="saving">
                  {{ saving ? 'SAVING...' : 'SAVE' }}
                </button>
                <button class="cancel-btn" @click="cancelEditScoreThreshold">CANCEL</button>
              </template>
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
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Expected Move Threshold</span>
              <span class="setting-desc">Minimum volatility to enter trade (0.01-50%)</span>
            </div>
            <div class="setting-value editable">
              <template v-if="!editingExpectedMove">
                <span class="value-badge">{{ settings.expected_move_threshold || '0.5' }}%</span>
                <button class="edit-btn" @click="startEditExpectedMove">EDIT</button>
              </template>
              <template v-else>
                <input
                  type="number"
                  v-model.number="expectedMoveInput"
                  class="edit-input"
                  min="0.01"
                  max="50"
                  step="0.1"
                />
                <span class="input-unit">%</span>
                <button class="save-btn" @click="saveExpectedMove" :disabled="saving">
                  {{ saving ? 'SAVING...' : 'SAVE' }}
                </button>
                <button class="cancel-btn" @click="cancelEditExpectedMove">CANCEL</button>
              </template>
            </div>
          </div>
        </div>
        <div v-if="saveSuccess && (saveSuccessKey === 'score_threshold' || saveSuccessKey === 'expected_move_threshold')" class="save-success-message">
          ✓ Settings updated successfully
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
              <span class="setting-desc">How often to fetch price data (5-300 seconds)</span>
            </div>
            <div class="setting-value editable">
              <template v-if="!editingSamplingInterval">
                <span class="value-badge">{{ settings.sampling_interval || '30' }}s</span>
                <button class="edit-btn" @click="startEditSamplingInterval">EDIT</button>
              </template>
              <template v-else>
                <input
                  type="number"
                  v-model.number="samplingIntervalInput"
                  class="edit-input"
                  min="5"
                  max="300"
                />
                <span class="input-unit">s</span>
                <button class="save-btn" @click="saveSamplingInterval" :disabled="saving">
                  {{ saving ? 'SAVING...' : 'SAVE' }}
                </button>
                <button class="cancel-btn" @click="cancelEditSamplingInterval">CANCEL</button>
              </template>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Lookback Window</span>
              <span class="setting-desc">Historical data window for analysis (5-240 minutes)</span>
            </div>
            <div class="setting-value editable">
              <template v-if="!editingLookbackWindow">
                <span class="value-badge">{{ settings.lookback_window || '30' }}m</span>
                <button class="edit-btn" @click="startEditLookbackWindow">EDIT</button>
              </template>
              <template v-else>
                <input
                  type="number"
                  v-model.number="lookbackWindowInput"
                  class="edit-input"
                  min="5"
                  max="240"
                />
                <span class="input-unit">m</span>
                <button class="save-btn" @click="saveLookbackWindow" :disabled="saving">
                  {{ saving ? 'SAVING...' : 'SAVE' }}
                </button>
                <button class="cancel-btn" @click="cancelEditLookbackWindow">CANCEL</button>
              </template>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Lag Intervals</span>
              <span class="setting-desc">Price lag calculation periods (1-20)</span>
            </div>
            <div class="setting-value editable">
              <template v-if="!editingLagIntervals">
                <span class="value-badge">{{ settings.lag_intervals || '2' }}</span>
                <button class="edit-btn" @click="startEditLagIntervals">EDIT</button>
              </template>
              <template v-else>
                <input
                  type="number"
                  v-model.number="lagIntervalsInput"
                  class="edit-input"
                  min="1"
                  max="20"
                />
                <button class="save-btn" @click="saveLagIntervals" :disabled="saving">
                  {{ saving ? 'SAVING...' : 'SAVE' }}
                </button>
                <button class="cancel-btn" @click="cancelEditLagIntervals">CANCEL</button>
              </template>
            </div>
          </div>
        </div>
        <div v-if="saveSuccess && ['sampling_interval', 'lookback_window', 'lag_intervals'].includes(saveSuccessKey)" class="save-success-message">
          ✓ Data collection settings updated successfully
        </div>
      </div>

      <div class="settings-section">
        <div class="section-header">
          <h2>
            <span class="section-icon">◈</span>
            AI PAIR MINING
          </h2>
        </div>
        <div class="setting-list">
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Max Pairs Limit</span>
              <span class="setting-desc">Maximum number of active trading pairs</span>
            </div>
            <div class="setting-value editable">
              <template v-if="!editingMaxPairs">
                <span class="value-badge">{{ settings.max_pairs || '400' }}</span>
                <button class="edit-btn" @click="startEditMaxPairs">EDIT</button>
              </template>
              <template v-else>
                <input
                  type="number"
                  v-model.number="maxPairsInput"
                  class="edit-input"
                  min="1"
                  max="10000"
                />
                <button class="save-btn" @click="saveMaxPairs" :disabled="saving">
                  {{ saving ? 'SAVING...' : 'SAVE' }}
                </button>
                <button class="cancel-btn" @click="cancelEditMaxPairs">CANCEL</button>
              </template>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Current Pair Count</span>
              <span class="setting-desc">Number of currently active pairs</span>
            </div>
            <div class="setting-value">
              <span class="value-badge" :class="{ 'warning': parseInt(settings.current_pair_count || '0') >= parseInt(settings.max_pairs || '400') }">
                {{ settings.current_pair_count || '0' }} / {{ settings.max_pairs || '400' }}
              </span>
            </div>
          </div>
        </div>
        <div v-if="saveSuccess && saveSuccessKey === 'max_pairs'" class="save-success-message">
          ✓ Max pairs limit updated successfully
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

/* Editable settings */
.setting-value.editable {
  display: flex;
  align-items: center;
  gap: 8px;
}

.edit-btn {
  padding: 4px 8px;
  background: #f8f9fa;
  border: 1px solid #c4c4c4;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.65em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s;
}

.edit-btn:hover {
  background: #e9ecef;
  border-color: #8b8b8b;
}

.edit-input {
  padding: 5px 8px;
  border: 2px solid #0056b3;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.85em;
  font-weight: 700;
  width: 80px;
  text-align: center;
}

.edit-input:focus {
  outline: none;
  border-color: #003d7a;
}

.input-unit {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.85em;
  font-weight: 700;
  color: #5a5a5a;
}

.save-btn {
  padding: 4px 10px;
  background: #1a7f37;
  color: #fff;
  border: 1px solid #0f5a22;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.65em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s;
}

.save-btn:hover:not(:disabled) {
  background: #155724;
}

.save-btn:disabled {
  background: #8b8b8b;
  cursor: not-allowed;
}

.cancel-btn {
  padding: 4px 8px;
  background: #f8f9fa;
  border: 1px solid #c4c4c4;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.65em;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-btn:hover {
  background: #e9ecef;
}

.value-badge.warning {
  background: #fff3cd;
  color: #856404;
  border-color: #856404;
}

.save-success-message {
  padding: 10px 16px;
  margin: 8px 16px;
  background: #d4edda;
  color: #1a7f37;
  border: 1px solid #c3e6cb;
  font-size: 0.85em;
  font-weight: 600;
  font-family: 'Courier New', Courier, monospace;
}
</style>
