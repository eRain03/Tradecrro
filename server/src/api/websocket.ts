import { WebSocket, WebSocketServer } from 'ws';
import config from '../config';
import { TradingSignal } from '../strategy/SignalGenerator';

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  initialize() {
    this.wss = new WebSocketServer({ port: config.server.wsPort });

    this.wss.on('connection', (ws) => {
      console.log('🔌 New client connected to WebSocket Server');
      this.clients.add(ws);

      ws.on('close', () => {
        console.log('🔌 Client disconnected from WebSocket Server');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    console.log(`🔌 WebSocket Server running on port ${config.server.wsPort}`);
  }

  broadcastSignal(signal: TradingSignal) {
    if (!this.wss || this.clients.size === 0) return;

    // Transform signal into frontend expected format
    const formattedSignal = {
      id: signal.id,
      timestamp: signal.timestamp,
      stockA: signal.stockA,
      stockB: signal.stockB,
      syncCorrelation: signal.score.syncCorrelation,
      lagCorrelation: signal.score.lagCorrelation,
      volumeRatioA: signal.score.volumeRatioA,
      volumeRatioB: signal.score.volumeRatioB,
      volumeScoreA: signal.score.volumeScoreA,
      volumeScoreB: signal.score.volumeScoreB,
      correlationScore: signal.score.correlationScore,
      volumeScore: signal.score.volumeScore,
      totalScore: signal.score.totalScore,
      triggered: signal.triggered,
      strategyUsed: signal.strategyType,
      strategyType: signal.strategyType,
      entryConfirmed: signal.entryConfirmed,
      entryReason: signal.entryReason,
      leaderMove: signal.leaderMove,
      laggerMove: signal.laggerMove,
      expectedMove: signal.expectedMove,
      leader: signal.score.leader,
      lagger: signal.score.lagger,
    };

    const message = JSON.stringify({
      type: 'SIGNAL',
      data: formattedSignal
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
}

export const wsService = new WebSocketService();
