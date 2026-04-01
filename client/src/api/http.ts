const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface Pair {
  id: number;
  stockA: string;
  stockB: string;
  strategyType: string;
  isActive: boolean;
}

export interface Signal {
  id: number;
  timestamp: string;
  stockA: string;
  stockB: string;
  syncCorrelation: number;
  lagCorrelation: number;
  volumeRatioA: number;
  volumeRatioB: number;
  volumeScoreA: number;
  volumeScoreB: number;
  correlationScore: number;
  volumeScore: number;
  totalScore: number;
  triggered: boolean;
  strategyUsed: string;
  strategyType?: 'positive_lag' | 'negative_corr';
  isActive: boolean;
  entryConfirmed: boolean;
  entryReason?: string;
  leaderMove?: number;
  laggerMove?: number;
  expectedMove?: number;
  score?: {
    syncCorrelation: number;
    lagCorrelation: number;
    volumeRatioA: number;
    volumeRatioB: number;
    volumeScoreA: number;
    volumeScoreB: number;
    correlationScore: number;
    volumeScore: number;
    totalScore: number;
  };
  zScore?: number;
  spreadPct?: number;
}

export interface Trade {
  id: number;
  stockSymbol: string;
  optionEpic: string;
  strikePrice: number;
  entryPrice: number;
  exitPrice?: number;
  positionSize: number;
  entryTime: string;
  exitTime?: string;
  pnlPct?: number;
  pnlAmount?: number;
  status: string;
  exitReason?: string;
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return await response.json();
  }

  // Health check
  async health(): Promise<{ status: string; timestamp: string }> {
    return this.fetch('/health');
  }

  // Pairs
  async getPairs(): Promise<Pair[]> {
    return this.fetch('/api/pairs');
  }

  async createPair(pair: Omit<Pair, 'id'>): Promise<Pair> {
    // Validate before sending
    if (pair.stockA === pair.stockB) {
      throw new Error('Invalid pair: stockA and stockB cannot be the same symbol');
    }

    return this.fetch('/api/pairs', {
      method: 'POST',
      body: JSON.stringify(pair),
    });
  }

  // Signals
  async getSignals(limit: number = 100): Promise<Signal[]> {
    return this.fetch(`/api/signals?limit=${limit}`);
  }

  async getTriggeredSignals(limit: number = 50): Promise<Signal[]> {
    return this.fetch(`/api/signals/triggered?limit=${limit}`);
  }

  // Trades
  async getOpenTrades(): Promise<Trade[]> {
    return this.fetch('/api/trades/open');
  }

  async getClosedTrades(limit: number = 100): Promise<Trade[]> {
    return this.fetch(`/api/trades/closed?limit=${limit}`);
  }

  async closeTrade(tradeId: number, reason: string): Promise<Trade> {
    return this.fetch(`/api/trades/${tradeId}/close`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Settings
  async getSettings(): Promise<Record<string, string>> {
    return this.fetch('/api/settings');
  }

  async updateSetting(key: string, value: string): Promise<void> {
    return this.fetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    });
  }
}

export const api = new ApiClient();
export default api;
