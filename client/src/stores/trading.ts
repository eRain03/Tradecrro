import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api, { type Signal, type Trade, type Pair } from '../api/http';

function getSignalDedupKey(signal: Signal): string {
  const secondTimestamp = signal.timestamp.slice(0, 19);
  return `${secondTimestamp}|${signal.stockA}|${signal.stockB}`;
}

function dedupeSignals(signalList: Signal[]): Signal[] {
  const seen = new Set<string>();

  return signalList.filter((signal) => {
    const key = getSignalDedupKey(signal);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export const useTradingStore = defineStore('trading', () => {
  // State
  const pairs = ref<Pair[]>([]);
  const signals = ref<Signal[]>([]);
  const openTrades = ref<Trade[]>([]);
  const closedTrades = ref<Trade[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const triggeredSignals = computed(() =>
    signals.value.filter((s) => s.triggered)
  );

  const totalPnl = computed(() => {
    return closedTrades.value.reduce((sum, trade) => {
      return sum + (trade.pnlAmount || 0);
    }, 0);
  });

  const winRate = computed(() => {
    const closed = closedTrades.value;
    if (closed.length === 0) return 0;
    const winners = closed.filter((t) => (t.pnlPct || 0) > 0).length;
    return (winners / closed.length) * 100;
  });

  // Actions
  async function fetchPairs() {
    try {
      isLoading.value = true;
      pairs.value = await api.getPairs();
    } catch (e) {
      error.value = 'Failed to fetch pairs';
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchSignals(limit = 100) {
    try {
      isLoading.value = true;
      signals.value = dedupeSignals(await api.getSignals(limit));
    } catch (e) {
      error.value = 'Failed to fetch signals';
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchOpenTrades() {
    try {
      openTrades.value = await api.getOpenTrades();
    } catch (e) {
      error.value = 'Failed to fetch open trades';
    }
  }

  async function fetchClosedTrades(limit = 100) {
    try {
      closedTrades.value = await api.getClosedTrades(limit);
    } catch (e) {
      error.value = 'Failed to fetch closed trades';
    }
  }

  async function closeTrade(tradeId: number, reason: string) {
    try {
      await api.closeTrade(tradeId, reason);
      await fetchOpenTrades();
      await fetchClosedTrades();
    } catch (e) {
      error.value = 'Failed to close trade';
    }
  }

  function addSignal(signal: Signal) {
    signals.value = dedupeSignals([signal, ...signals.value]);
    // Keep more signals to match all pairs (default 500)
    if (signals.value.length > 500) {
      signals.value = signals.value.slice(0, 500);
    }
  }

  function updateTrade(trade: Trade) {
    const index = openTrades.value.findIndex((t) => t.id === trade.id);
    if (index !== -1) {
      openTrades.value[index] = trade;
    } else {
      openTrades.value.push(trade);
    }
  }

  return {
    pairs,
    signals,
    openTrades,
    closedTrades,
    isLoading,
    error,
    triggeredSignals,
    totalPnl,
    winRate,
    fetchPairs,
    fetchSignals,
    fetchOpenTrades,
    fetchClosedTrades,
    closeTrade,
    addSignal,
    updateTrade,
  };
});
