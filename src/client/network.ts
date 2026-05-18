import { Game } from './game';
import { Message } from '../shared/types';

export class NetworkManager {
  private ws: WebSocket | null = null;
  private game: Game;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(game: Game) {
    this.game = game;
  }

  connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('Connected to server');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const message: Message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('Disconnected from server');
      this.attemptReconnect();
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff
      console.log(`Reconnecting in ${delay}ms...`);
      setTimeout(() => this.connect(), delay);
    }
  }

  join(playerName: string): void {
    this.connect();
    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const message: Message = {
          type: 'join',
          payload: { name: playerName },
        };
        this.ws.send(JSON.stringify(message));
      }
    }, 100);
  }

  move(dx: number, dy: number): void {
    if (!this.game.shouldSendMove()) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    let direction: 'up' | 'down' | 'left' | 'right' = 'down';
    if (Math.abs(dx) > Math.abs(dy)) {
      direction = dx > 0 ? 'right' : 'left';
    } else {
      direction = dy > 0 ? 'down' : 'up';
    }

    const message: Message = {
      type: 'move',
      payload: { dx, dy, direction },
    };
    this.ws.send(JSON.stringify(message));
  }

  attack(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.game.markAttack();
    const message: Message = {
      type: 'attack',
      payload: {},
    };
    this.ws.send(JSON.stringify(message));
  }

  private handleMessage(message: Message): void {
    switch (message.type) {
      case 'joinSuccess':
        const playerId = message.payload.playerId;
        this.game.currentPlayerId = playerId;
        console.log('Joined game with ID:', playerId);
        break;

      case 'gameState':
        this.game.setGameState(message.payload);
        break;

      default:
        console.log('Unknown message:', message);
    }
  }
}
