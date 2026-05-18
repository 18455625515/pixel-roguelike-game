import { PlayerEntity, EnemyEntity, ItemEntity, getRandomEnemyType, getDroppedItem } from './entities';
import { GameState, ItemType } from '../shared/types';

const SPAWN_RATE = 2; // enemies per second
const ENEMY_DETECTION_RANGE = 200;
const ATTACK_RANGE = 50;
const ITEM_PICKUP_RANGE = 40;

export class Game {
  players: Map<string, PlayerEntity> = new Map();
  enemies: Map<string, EnemyEntity> = new Map();
  items: Map<string, ItemEntity> = new Map();
  wave: number = 1;
  score: number = 0;
  gameActive: boolean = true;
  private waveTimer: number = 0;
  private spawnTimer: number = 0;
  private readonly WAVE_DURATION = 60; // 60 seconds per wave

  addPlayer(name: string): PlayerEntity {
    const player = new PlayerEntity(name);
    this.players.set(player.id, player);
    console.log(`Player joined: ${name} (${player.id})`);
    return player;
  }

  removePlayer(playerId: string): void {
    this.players.delete(playerId);
    console.log(`Player left: ${playerId}`);
  }

  movePlayer(playerId: string, dx: number, dy: number, deltaTime: number): void {
    const player = this.players.get(playerId);
    if (player) {
      player.move(dx, dy, deltaTime);
      if (dx !== 0 || dy !== 0) {
        if (Math.abs(dx) > Math.abs(dy)) {
          player.direction = dx > 0 ? 'right' : 'left';
        } else {
          player.direction = dy > 0 ? 'down' : 'up';
        }
      }
    }
  }

  update(deltaTime: number): void {
    this.waveTimer += deltaTime;
    this.spawnTimer += deltaTime;

    // Spawn new enemies
    const enemiesToSpawn = Math.floor(this.spawnTimer * SPAWN_RATE * (1 + this.wave * 0.1));
    if (enemiesToSpawn > 0) {
      for (let i = 0; i < enemiesToSpawn; i++) {
        const type = getRandomEnemyType(this.wave);
        const enemy = new EnemyEntity(type, this.wave);
        this.enemies.set(enemy.id, enemy);
      }
      this.spawnTimer = 0;
    }

    // Update enemy AI
    this.enemies.forEach((enemy, enemyId) => {
      let targetPlayer: PlayerEntity | null = null;
      let closestDistance = ENEMY_DETECTION_RANGE;

      // Find closest player
      this.players.forEach((player) => {
        const distance = this.getDistance(enemy, player);
        if (distance < closestDistance) {
          closestDistance = distance;
          targetPlayer = player;
        }
      });

      if (targetPlayer) {
        enemy.moveTowards(targetPlayer.x, targetPlayer.y, deltaTime);
      } else {
        enemy.wander(deltaTime);
      }
    });

    // Handle collisions and attacks
    this.players.forEach((player) => {
      this.enemies.forEach((enemy) => {
        const distance = this.getDistance(player, enemy);

        // Attack range
        if (distance < ATTACK_RANGE) {
          player.takeDamage(enemy.damage * deltaTime);
          enemy.takeDamage(player.damage * deltaTime);
        }

        // Item pickup
        this.items.forEach((item, itemId) => {
          const itemDistance = this.getDistance(player, item);
          if (itemDistance < ITEM_PICKUP_RANGE) {
            this.applyItem(player, item);
            this.items.delete(itemId);
          }
        });
      });
    });

    // Remove dead enemies and drop items
    this.enemies.forEach((enemy, enemyId) => {
      if (!enemy.isAlive()) {
        // Drop item
        const itemType = getDroppedItem(enemy);
        const itemValue = 10 + this.wave * 5;
        const item = new ItemEntity(enemy.x, enemy.y, itemType, itemValue);
        this.items.set(item.id, item);

        // Give experience to nearby players
        this.players.forEach((player) => {
          const distance = this.getDistance(player, enemy);
          if (distance < 300) {
            player.gainExperience(20 * this.wave);
            this.score += 10 * this.wave;
          }
        });

        this.enemies.delete(enemyId);
      }
    });

    // Remove dead players
    this.players.forEach((player, playerId) => {
      if (!player.isAlive()) {
        this.players.delete(playerId);
      }
    });

    // Wave progression
    if (this.waveTimer >= this.WAVE_DURATION) {
      this.wave++;
      this.waveTimer = 0;
      this.spawnTimer = 0;
      console.log(`Wave ${this.wave} started!`);
    }

    // Game over if no players
    if (this.players.size === 0) {
      this.gameActive = false;
    }
  }

  getState(): GameState & { players: Record<string, any> } {
    const players: Record<string, any> = {};
    this.players.forEach((player) => {
      players[player.id] = { ...player };
    });

    const enemies: Record<string, any> = {};
    this.enemies.forEach((enemy) => {
      enemies[enemy.id] = { ...enemy };
    });

    const items: Record<string, any> = {};
    this.items.forEach((item) => {
      items[item.id] = { ...item };
    });

    return {
      players,
      enemies,
      items,
      wave: this.wave,
      score: this.score,
      gameActive: this.gameActive,
    };
  }

  private getDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private applyItem(player: PlayerEntity, item: ItemEntity): void {
    switch (item.type) {
      case ItemType.HEALTH:
        player.heal(item.value);
        break;
      case ItemType.DAMAGE:
        player.damage += item.value;
        break;
      case ItemType.SPEED:
        player.speed += item.value;
        break;
      case ItemType.ARMOR:
        player.armor += item.value;
        break;
    }
  }
}
