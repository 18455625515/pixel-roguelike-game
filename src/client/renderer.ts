import { GameState, Player, Enemy, Item } from '../shared/types';

const TILE_SIZE = 32;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private pixelSize = 2; // For pixel art scaling

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
  }

  render(gameState: GameState): void {
    // Clear background
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Draw grid
    this.drawGrid();

    // Draw items
    Object.values(gameState.items).forEach((item) => {
      this.drawItem(item);
    });

    // Draw enemies
    Object.values(gameState.enemies).forEach((enemy) => {
      this.drawEnemy(enemy);
    });

    // Draw players
    Object.values(gameState.players).forEach((player) => {
      this.drawPlayer(player);
    });

    // Draw UI
    this.drawUI(gameState);
  }

  private drawGrid(): void {
    this.ctx.strokeStyle = '#2a2a2a';
    this.ctx.lineWidth = 1;

    for (let i = 0; i < this.width; i += TILE_SIZE) {
      this.ctx.beginPath();
      this.ctx.moveTo(i, 0);
      this.ctx.lineTo(i, this.height);
      this.ctx.stroke();
    }

    for (let i = 0; i < this.height; i += TILE_SIZE) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, i);
      this.ctx.lineTo(this.width, i);
      this.ctx.stroke();
    }
  }

  private drawPlayer(player: Player): void {
    const colors = this.getPlayerColor(player);

    // Draw character body
    this.ctx.fillStyle = colors.body;
    this.ctx.fillRect(player.x, player.y, player.width, player.height);

    // Draw face/eyes based on direction
    this.ctx.fillStyle = colors.face;
    switch (player.direction) {
      case 'up':
        this.ctx.fillRect(player.x + 8, player.y + 4, 4, 4); // Left eye
        this.ctx.fillRect(player.x + 20, player.y + 4, 4, 4); // Right eye
        break;
      case 'down':
        this.ctx.fillRect(player.x + 8, player.y + 24, 4, 4); // Left eye
        this.ctx.fillRect(player.x + 20, player.y + 24, 4, 4); // Right eye
        break;
      case 'left':
        this.ctx.fillRect(player.x + 4, player.y + 10, 4, 4); // Eye
        break;
      case 'right':
        this.ctx.fillRect(player.x + 24, player.y + 10, 4, 4); // Eye
        break;
    }

    // Draw health bar
    const healthPercent = player.health / player.maxHealth;
    this.ctx.fillStyle = '#ff0000';
    this.ctx.fillRect(player.x, player.y - 8, player.width * healthPercent, 4);
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.strokeRect(player.x, player.y - 8, player.width, 4);

    // Draw player name
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '10px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(player.name, player.x + player.width / 2, player.y - 12);
  }

  private drawEnemy(enemy: Enemy): void {
    const colors = this.getEnemyColor(enemy.type);

    // Draw enemy body
    this.ctx.fillStyle = colors.body;
    this.ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);

    // Draw eyes
    this.ctx.fillStyle = colors.face;
    this.ctx.fillRect(enemy.x + 6, enemy.y + 8, 4, 4); // Left eye
    this.ctx.fillRect(enemy.x + 22, enemy.y + 8, 4, 4); // Right eye

    // Draw health bar
    const healthPercent = enemy.health / enemy.maxHealth;
    this.ctx.fillStyle = '#ff6600';
    this.ctx.fillRect(enemy.x, enemy.y - 8, enemy.width * healthPercent, 4);
    this.ctx.strokeStyle = '#ffff00';
    this.ctx.strokeRect(enemy.x, enemy.y - 8, enemy.width, 4);
  }

  private drawItem(item: Item): void {
    const colors = this.getItemColor(item.type);
    const size = 12;
    const x = item.x + (TILE_SIZE - size) / 2;
    const y = item.y + (TILE_SIZE - size) / 2;

    // Draw item
    this.ctx.fillStyle = colors.body;
    this.ctx.fillRect(x, y, size, size);
    this.ctx.strokeStyle = colors.outline;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, size, size);
  }

  private drawUI(gameState: GameState): void {
    // Draw background for UI
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(0, this.height - 60, this.width, 60);

    // Draw stats
    this.ctx.fillStyle = '#00ff00';
    this.ctx.font = 'bold 12px monospace';
    this.ctx.textAlign = 'left';

    let yOffset = this.height - 50;
    this.ctx.fillText(`Wave: ${gameState.wave} | Score: ${gameState.score}`, 10, yOffset);
    this.ctx.fillText(`Enemies: ${Object.keys(gameState.enemies).length} | Players: ${Object.keys(gameState.players).length}`, 10, yOffset + 15);
  }

  private getPlayerColor(player: Player): { body: string; face: string } {
    const colors = [
      { body: '#ff6b6b', face: '#000000' },
      { body: '#4ecdc4', face: '#000000' },
      { body: '#45b7d1', face: '#000000' },
      { body: '#f9ca24', face: '#000000' },
    ];
    const index = player.id.charCodeAt(0) % colors.length;
    return colors[index];
  }

  private getEnemyColor(
    type: 'goblin' | 'orc' | 'troll' | 'dragon'
  ): { body: string; face: string } {
    const colors = {
      goblin: { body: '#90ee90', face: '#000000' },
      orc: { body: '#6b8e23', face: '#000000' },
      troll: { body: '#8b4513', face: '#000000' },
      dragon: { body: '#dc143c', face: '#ffff00' },
    };
    return colors[type];
  }

  private getItemColor(type: string): { body: string; outline: string } {
    const colors: Record<string, { body: string; outline: string }> = {
      health: { body: '#ff69b4', outline: '#ff1493' },
      damage: { body: '#ff4500', outline: '#ff0000' },
      speed: { body: '#00ff00', outline: '#00aa00' },
      armor: { body: '#c0c0c0', outline: '#808080' },
    };
    return colors[type] || { body: '#ffffff', outline: '#cccccc' };
  }
}
