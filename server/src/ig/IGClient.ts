import config from '../config';

interface IGConfig {
  baseUrl: string;
  apiKey: string;
  identifier: string;
  password: string;
}

interface LegacyConfig {
  ig?: {
    demo?: IGConfig;
    live?: IGConfig;
    environment?: 'demo' | 'live';
  };
}

const legacyConfig = (config as any as LegacyConfig).ig;
import axios from 'axios';

interface IGAuthResponse {
  accountId: string;
  clientId: string;
  lightstreamerEndpoint: string;
  oauthToken?: {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_type: string;
    expires_in: string;
  };
  currentAccountId?: string;
  timezoneOffset?: number;
}

interface MarketData {
  epic: string;
  instrumentName?: string;
  instrumentType?: string;
  marketStatus?: string;
  snapshot?: {
    bid: number;
    offer: number;
    ask: number;
    high: number;
    low: number;
    midOpen: number;
    change: number;
    changePct: number;
    updateTime: string;
    marketStatus: string;
  };
}

interface OptionChainResponse {
  markets: MarketData[];
}

export class IGClient {
  private baseUrl: string;
  private apiKey: string;
  private cstToken: string = '';
  private securityToken: string = '';
  private authToken: string = '';
  private isDemo: boolean = true;
  private isAuthenticated: boolean = false;

  constructor() {
    // IG configuration is optional - IG has been removed from the main config
    // This class is kept for backwards compatibility but should not be used
    const envConfig = legacyConfig?.[legacyConfig?.environment || 'demo'];

    if (!envConfig) {
      console.warn('⚠️ IG configuration not found - IGClient will not function');
      this.baseUrl = '';
      this.apiKey = '';
      return;
    }

    this.baseUrl = envConfig.baseUrl;
    this.apiKey = envConfig.apiKey;
    this.isDemo = (legacyConfig?.environment || 'demo') === 'demo';

    if (!this.apiKey) {
      throw new Error('IG_API_KEY not configured');
    }
  }

  async authenticate(): Promise<void> {
    const envConfig = legacyConfig?.[legacyConfig?.environment || 'demo'];

    if (!envConfig) {
      throw new Error('IG configuration not found - cannot authenticate');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/session`, {
        identifier: envConfig.identifier,
        password: envConfig.password,
      }, {
        headers: {
          'X-IG-API-KEY': this.apiKey,
          'Version': '2',
          'Accept': 'application/json; charset=UTF-8',
          'Content-Type': 'application/json; charset=UTF-8',
        },
      });

      // 从响应 headers 中提取 CST 和 X-SECURITY-TOKEN
      this.cstToken = response.headers['cst'] || '';
      this.securityToken = response.headers['x-security-token'] || '';
      this.authToken = response.data.oauthToken?.access_token || '';

      if (!this.cstToken || !this.securityToken) {
        throw new Error('登录成功，但未能获取 CST 或 X-SECURITY-TOKEN');
      }

      this.isAuthenticated = true;

      console.log(`✅ IG ${this.isDemo ? 'Demo' : 'Live'} Account Connected`);
      console.log(`   Account ID: ${response.data.accountId || response.data.currentAccountId}`);
      console.log(`   CST: ${this.cstToken.substring(0, 20)}...`);
      console.log(`   X-SECURITY-TOKEN: ${this.securityToken.substring(0, 20)}...`);
    } catch (error) {
      console.error('IG Authentication failed:', error);
      throw error;
    }
  }

  getAuthHeaders(): Record<string, string> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    return {
      'X-IG-API-KEY': this.apiKey,
      'CST': this.cstToken,
      'X-SECURITY-TOKEN': this.securityToken,
      'Version': '1',
      'Accept': 'application/json; charset=UTF-8',
      'Content-Type': 'application/json; charset=UTF-8',
    };
  }

  async getMarketData(epic: string): Promise<MarketData> {
    const response = await axios.get(`${this.baseUrl}/markets/${epic}`, {
      headers: this.getAuthHeaders(),
    });

    return response.data;
  }

  async searchMarkets(searchTerm: string): Promise<MarketData[]> {
    const response = await axios.get(`${this.baseUrl}/markets`, {
      params: { searchTerm },
      headers: this.getAuthHeaders(),
    });

    return response.data.markets || [];
  }

  async getPrices(epic: string, resolution: string = 'MINUTE', max: number = 60): Promise<any> {
    const url = `${this.baseUrl}/prices/${epic}?resolution=${resolution}&max=${max}`;

    const response = await fetch(url, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get prices: ${response.statusText}`);
    }

    return await response.json();
  }

  async getAccountInfo(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/accounts`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get account info: ${response.statusText}`);
    }

    return await response.json();
  }

  async placeOrder(order: {
    epic: string;
    direction: 'BUY' | 'SELL';
    size: number;
    orderType: 'MARKET' | 'LIMIT';
    level?: number;
    stopLevel?: number;
    limitLevel?: number;
  }): Promise<any> {
    const response = await fetch(`${this.baseUrl}/positions`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        epic: order.epic,
        direction: order.direction,
        size: order.size,
        orderType: order.orderType,
        level: order.level,
        guaranteedStop: false,
        stopLevel: order.stopLevel,
        limitLevel: order.limitLevel,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Order failed: ${errorText}`);
    }

    return await response.json();
  }

  get isConnected(): boolean {
    return this.isAuthenticated;
  }

  get demoMode(): boolean {
    return this.isDemo;
  }
}

export default IGClient;
