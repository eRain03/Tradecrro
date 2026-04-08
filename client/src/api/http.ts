/**
 * 自动检测API基础URL
 * 本地开发环境 (localhost:5173) → localhost:3001
 * 其他环境 → 使用 VITE_API_URL 环境变量
 */
function getApiBase(): string {
  const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();

  // 检测是否在本地开发环境 (Vite dev server on port 5173)
  if (typeof window !== 'undefined') {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isViteDev = window.location.port === '5173';
    if (isLocalhost && isViteDev) {
      return 'http://localhost:3001';
    }
  }

  // 生产/其他环境使用环境变量配置
  return envUrl ? envUrl.replace(/\/$/, '') : '';
}

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
  private getBaseUrl(): string {
    return getApiBase();
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.getBaseUrl()}${path}`, {
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

  // Rate Limit Monitoring
  async getRateLimits(): Promise<{
    health: {
      status: 'healthy' | 'warning' | 'danger';
      message: string;
    };
    statuses: Record<string, {
      name: string;
      current: number;
      max: number;
      safeLimit: number;
      percentage: number;
      status: 'safe' | 'warning' | 'danger' | 'critical';
      remaining: number;
    }>;
    timestamp: string;
  }> {
    return this.fetch('/api/monitoring/rate-limits');
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
