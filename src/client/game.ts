import { GameState, Player } from '../shared/types';

export class Game {
  gameState: GameState = {
    players: {},
    enemies: {},
    items: {},
    wave: 1,
    score: 0,
    gameActive: true,
  };
  currentPlayerId: string | null = null;
  lastMoveTime = 0;
  moveDebounce = 50; // ms

  get currentPlayer(): Player | null {
    if (!this.currentPlayerId) return null;
    return this.gameState.players[this.currentPlayerId] || null;
  }

  setGameState(state: GameState & { playerId?: string }): void {
    if (state.playerId) {
      this.currentPlayerId = state.playerId;
    }
    this.gameState = state;
  }

  update(deltaTime: number): void {
    // Client-side state management
    // The actual game logic is handled by the server
  }

  shouldSendMove(): boolean {
    const now = Date.now();
    if (now - this.lastMoveTime > this.moveDebounce) {
      this.lastMoveTime = now;
      return true;
    }
    return false;
  }
}
