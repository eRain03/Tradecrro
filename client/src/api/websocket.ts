const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3002';

export interface PriceUpdate {
  epic: string;
  bid: number;
  ask: number;
  timestamp: string;
}

export interface TradingSignal {
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
  entryConfirmed: boolean;
  entryReason?: string;
  leaderMove?: number;
  laggerMove?: number;
  expectedMove?: number;
  isActive: boolean;
}

type MessageHandler = (data: any) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      this.attemptReconnect();
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }

  private handleMessage(message: { type: string; data: any }): void {
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message.data);
        } catch (error) {
          console.error('Error in message handler:', error);
        }
      });
    }
  }

  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  off(type: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  // Convenience methods
  onPriceUpdate(handler: (data: PriceUpdate) => void): void {
    this.on('PRICE_UPDATE', handler);
  }

  onSignal(handler: (data: TradingSignal) => void): void {
    this.on('SIGNAL', handler);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsClient = new WebSocketClient();
export default wsClient;
