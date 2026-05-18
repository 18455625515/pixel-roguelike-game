import { AttackEvent, GameState, Player, Enemy, Item } from '../shared/types';

const TILE_SIZE = 32;
const SPRITE_SIZE = 32;
const SPRITE_BASE_PATH = '/assets/sprites/';
const TILE_BASE_PATH = '/assets/tiles/';
const SPRITE_COLUMNS = ['idle', 'walk1', 'walk2', 'attack'] as const;
const SPRITE_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;

type SpriteColumn = (typeof SPRITE_COLUMNS)[number];
type SpriteDirection = (typeof SPRITE_DIRECTIONS)[number];
type SpriteName = 'player' | Enemy['type'];

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private pixelSize = 2; // For pixel art scaling
  private sprites: Partial<Record<SpriteName, HTMLImageElement>> = {};
  private loadedSprites = new Set<SpriteName>();
  private forestTiles: HTMLImageElement | null = null;
  private forestTilesLoaded = false;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.ctx.imageSmoothingEnabled = false;
    this.loadSprites();
    this.loadForestTiles();
  }

  render(gameState: GameState, currentPlayerId?: string | null, lastAttackTime = 0): void {
    // Clear background
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.drawForestBackground();

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
      this.drawPlayer(player, player.id === currentPlayerId, lastAttackTime);
    });

    this.drawAttackEvents(gameState.recentAttacks);

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

  private drawPlayer(player: Player, isCurrentPlayer: boolean, lastAttackTime: number): void {
    const isAttacking = isCurrentPlayer && Date.now() - lastAttackTime < 180;
    const frame = isAttacking ? 'attack' : this.getCharacterFrame(player.id, player.direction);
    if (isCurrentPlayer) {
      this.drawPlayerFocus(player);
      if (isAttacking) {
        this.drawAttackArc(player);
      }
    }

    if (this.drawSprite('player', player.x, player.y, player.direction, frame)) {
      this.drawCharacterOverlay(player.x, player.y, player.width, player.health, player.maxHealth, '#ff0000', '#ffffff');
      this.drawPlayerName(player);
      return;
    }

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

    this.drawCharacterOverlay(player.x, player.y, player.width, player.health, player.maxHealth, '#ff0000', '#ffffff');
    this.drawPlayerName(player);
  }

  private loadForestTiles(): void {
    const image = new Image();
    image.onload = () => {
      this.forestTilesLoaded = true;
    };
    image.onerror = () => {
      console.warn('Failed to load forest tiles');
    };
    image.src = `${TILE_BASE_PATH}forest.png`;
    this.forestTiles = image;
  }

  private drawForestBackground(): void {
    if (!this.forestTiles || !this.forestTilesLoaded) {
      this.drawGrid();
      return;
    }

    for (let y = 0; y < this.height; y += TILE_SIZE) {
      for (let x = 0; x < this.width; x += TILE_SIZE) {
        const tileIndex = this.getForestTileIndex(x / TILE_SIZE, y / TILE_SIZE);
        this.ctx.drawImage(
          this.forestTiles,
          tileIndex * SPRITE_SIZE,
          0,
          SPRITE_SIZE,
          SPRITE_SIZE,
          x,
          y,
          TILE_SIZE,
          TILE_SIZE
        );
      }
    }
  }

  private getForestTileIndex(tileX: number, tileY: number): number {
    const hash = (tileX * 73856093) ^ (tileY * 19349663);
    const value = Math.abs(hash % 100);

    if (value < 7) return 1;
    if (value < 15) return 2;
    if (value < 20) return 3;
    return 0;
  }

  private drawEnemy(enemy: Enemy): void {
    const frame = this.getCharacterFrame(enemy.id, 'down');
    if (this.drawSprite(enemy.type, enemy.x, enemy.y, 'down', frame)) {
      this.drawCharacterOverlay(enemy.x, enemy.y, enemy.width, enemy.health, enemy.maxHealth, '#ff6600', '#ffff00');
      return;
    }

    const colors = this.getEnemyColor(enemy.type);

    // Draw enemy body
    this.ctx.fillStyle = colors.body;
    this.ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);

    // Draw eyes
    this.ctx.fillStyle = colors.face;
    this.ctx.fillRect(enemy.x + 6, enemy.y + 8, 4, 4); // Left eye
    this.ctx.fillRect(enemy.x + 22, enemy.y + 8, 4, 4); // Right eye

    this.drawCharacterOverlay(enemy.x, enemy.y, enemy.width, enemy.health, enemy.maxHealth, '#ff6600', '#ffff00');
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

  private loadSprites(): void {
    const spriteNames: SpriteName[] = ['player', 'goblin', 'orc', 'troll', 'dragon'];

    spriteNames.forEach((name) => {
      const image = new Image();
      image.onload = () => {
        this.loadedSprites.add(name);
      };
      image.onerror = () => {
        console.warn(`Failed to load sprite: ${name}`);
      };
      image.src = `${SPRITE_BASE_PATH}${name}.png`;
      this.sprites[name] = image;
    });
  }

  private drawSprite(
    spriteName: SpriteName,
    x: number,
    y: number,
    direction: SpriteDirection,
    frame: SpriteColumn
  ): boolean {
    const sprite = this.sprites[spriteName];
    if (!sprite || !this.loadedSprites.has(spriteName)) {
      return false;
    }

    const sourceX = SPRITE_COLUMNS.indexOf(frame) * SPRITE_SIZE;
    const sourceY = SPRITE_DIRECTIONS.indexOf(direction) * SPRITE_SIZE;

    this.ctx.drawImage(
      sprite,
      sourceX,
      sourceY,
      SPRITE_SIZE,
      SPRITE_SIZE,
      Math.round(x),
      Math.round(y),
      TILE_SIZE,
      TILE_SIZE
    );

    return true;
  }

  private getCharacterFrame(id: string, direction: SpriteDirection): SpriteColumn {
    if (direction === 'up') {
      return 'idle';
    }

    const tick = Math.floor((Date.now() + this.hashId(id)) / 220) % 4;
    if (tick === 0) return 'idle';
    if (tick === 1) return 'walk1';
    if (tick === 2) return 'idle';
    return 'walk2';
  }

  private hashId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  private drawCharacterOverlay(
    x: number,
    y: number,
    width: number,
    health: number,
    maxHealth: number,
    fill: string,
    stroke: string
  ): void {
    const healthPercent = Math.max(0, Math.min(1, health / maxHealth));
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y - 8, width * healthPercent, 4);
    this.ctx.strokeStyle = stroke;
    this.ctx.strokeRect(x, y - 8, width, 4);
  }

  private drawPlayerName(player: Player): void {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '10px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(player.name, player.x + player.width / 2, player.y - 12);
  }

  private drawPlayerFocus(player: Player): void {
    const centerX = player.x + player.width / 2;
    const centerY = player.y + player.height / 2;
    const pulse = (Math.sin(Date.now() / 160) + 1) / 2;

    this.ctx.save();
    this.ctx.strokeStyle = `rgba(0, 255, 170, ${0.55 + pulse * 0.25})`;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(player.x - 3, player.y - 3, player.width + 6, player.height + 6);
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    this.ctx.beginPath();
    this.ctx.moveTo(centerX - 7, centerY);
    this.ctx.lineTo(centerX + 7, centerY);
    this.ctx.moveTo(centerX, centerY - 7);
    this.ctx.lineTo(centerX, centerY + 7);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawAttackEvents(attacks: AttackEvent[]): void {
    attacks.forEach((attack) => {
      const age = Date.now() - attack.createdAt;
      if (age > 280) return;

      const progress = age / 280;
      const alpha = 1 - progress;
      const palette = this.getWeaponEffectColors(attack.weapon, attack.hit);

      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.lineCap = 'square';
      this.ctx.lineJoin = 'miter';
      this.ctx.shadowColor = palette.glow;
      this.ctx.shadowBlur = attack.hit ? 12 : 5;

      this.drawWeaponSweep(attack, palette.primary, 10, progress);
      this.drawWeaponSweep(attack, palette.core, 4, progress);

      if (attack.hit) {
        this.drawHitBurst(attack, palette.hit, progress);
      }

      this.ctx.restore();
    });
  }

  private drawWeaponSweep(attack: AttackEvent, color: string, width: number, progress: number): void {
    const start = this.getAttackAngles(attack.direction);
    const sweep = 0.95;
    const currentStart = start - sweep * (0.45 - progress * 0.35);
    const currentEnd = start + sweep * (0.15 + progress * 0.55);

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.beginPath();
    this.ctx.arc(attack.x, attack.y, attack.range, currentStart, currentEnd);
    this.ctx.stroke();
  }

  private drawHitBurst(attack: AttackEvent, color: string, progress: number): void {
    const offset = attack.range * 0.72;
    const point = this.offsetByDirection(attack.x, attack.y, attack.direction, offset);
    const size = 6 + progress * 8;

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.moveTo(point.x - size, point.y);
    this.ctx.lineTo(point.x + size, point.y);
    this.ctx.moveTo(point.x, point.y - size);
    this.ctx.lineTo(point.x, point.y + size);
    this.ctx.stroke();
  }

  private drawAttackArc(player: Player): void {
    const centerX = player.x + player.width / 2;
    const centerY = player.y + player.height / 2;
    const range = player.attackRange;

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 230, 142, 0.35)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();

    if (player.direction === 'left') {
      this.ctx.arc(centerX, centerY, range, Math.PI * 0.72, Math.PI * 1.28);
    } else if (player.direction === 'right') {
      this.ctx.arc(centerX, centerY, range, Math.PI * -0.28, Math.PI * 0.28);
    } else if (player.direction === 'up') {
      this.ctx.arc(centerX, centerY, range, Math.PI * 1.22, Math.PI * 1.78);
    } else {
      this.ctx.arc(centerX, centerY, range, Math.PI * 0.22, Math.PI * 0.78);
    }

    this.ctx.stroke();
    this.ctx.restore();
  }

  private getAttackAngles(direction: 'up' | 'down' | 'left' | 'right'): number {
    switch (direction) {
      case 'left':
        return Math.PI;
      case 'right':
        return 0;
      case 'up':
        return Math.PI * 1.5;
      case 'down':
        return Math.PI * 0.5;
    }
  }

  private offsetByDirection(
    x: number,
    y: number,
    direction: 'up' | 'down' | 'left' | 'right',
    distance: number
  ): { x: number; y: number } {
    switch (direction) {
      case 'left':
        return { x: x - distance, y };
      case 'right':
        return { x: x + distance, y };
      case 'up':
        return { x, y: y - distance };
      case 'down':
        return { x, y: y + distance };
    }
  }

  private getWeaponEffectColors(
    weapon: string,
    hit: boolean
  ): { primary: string; core: string; glow: string; hit: string } {
    const fallback = hit ? '#ffd166' : '#b8c0c8';
    const colors: Record<string, { primary: string; core: string; glow: string; hit: string }> = {
      rustySword: { primary: '#b8c0c8', core: '#ffffff', glow: fallback, hit: '#ffd166' },
      ironSword: { primary: '#5ee0ff', core: '#e9fbff', glow: '#50d9ff', hit: '#9ff3ff' },
      battleAxe: { primary: '#ff6b5a', core: '#ffe1a8', glow: '#ff7a55', hit: '#ffcf5a' },
      crystalBlade: { primary: '#a66cff', core: '#f0e7ff', glow: '#be8cff', hit: '#ffffff' },
    };

    return colors[weapon] ?? colors.rustySword;
  }
}
