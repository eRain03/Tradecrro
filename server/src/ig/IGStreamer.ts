import WebSocket from 'ws';
import IGClient from './IGClient';

export interface PriceUpdate {
  epic: string;
  bid: number;
  ask: number;
  timestamp: string;
}

export class IGStreamer {
  private ws: WebSocket | null = null;
  private igClient: IGClient;
  private subscriptions: Set<string> = new Set();
  private priceCallbacks: Map<string, ((data: PriceUpdate) => void)[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000;

  constructor(igClient: IGClient) {
    this.igClient = igClient;
  }

  async connect(): Promise<void> {
    if (!this.igClient.isConnected) {
      await this.igClient.authenticate();
    }

    try {
      // IG uses Lightstreamer for streaming
      // For demo purposes, we'll use polling-based price updates
      // In production, you would connect to IG's Lightstreamer endpoint

      console.log('📡 Price streaming initialized (polling mode)');
      this.startPolling();
    } catch (error) {
      console.error('Failed to connect to price stream:', error);
      throw error;
    }
  }

  private startPolling(): void {
    // Poll prices every 30 seconds for subscribed instruments
    setInterval(async () => {
      for (const epic of this.subscriptions) {
        try {
          const data = await this.igClient.getMarketData(epic);
          const snapshot = data.snapshot || data;
          const update: PriceUpdate = {
            epic,
            bid: (snapshot as any).bid || 0,
            ask: (snapshot as any).ask || (snapshot as any).offer || 0,
            timestamp: new Date().toISOString(),
          };
          this.notifySubscribers(epic, update);
        } catch (error) {
          console.error(`Failed to poll price for ${epic}:`, error);
        }
      }
    }, 30000); // Default 30 seconds
  }

  subscribe(epic: string, callback: (data: PriceUpdate) => void): void {
    if (!this.subscriptions.has(epic)) {
      this.subscriptions.add(epic);
      console.log(`📊 Subscribed to ${epic}`);
    }

    if (!this.priceCallbacks.has(epic)) {
      this.priceCallbacks.set(epic, []);
    }
    this.priceCallbacks.get(epic)!.push(callback);
  }

  unsubscribe(epic: string, callback?: (data: PriceUpdate) => void): void {
    if (callback) {
      const callbacks = this.priceCallbacks.get(epic);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    } else {
      this.priceCallbacks.delete(epic);
      this.subscriptions.delete(epic);
      console.log(`📊 Unsubscribed from ${epic}`);
    }
  }

  private notifySubscribers(epic: string, data: PriceUpdate): void {
    const callbacks = this.priceCallbacks.get(epic);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in price callback:', error);
        }
      });
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
    this.priceCallbacks.clear();
    console.log('📡 Price stream disconnected');
  }

  get subscribedInstruments(): string[] {
    return Array.from(this.subscriptions);
  }
}

export default IGStreamer;
