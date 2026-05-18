import { PlayerEntity, EnemyEntity, ItemEntity, getRandomEnemyType, getDroppedItem } from './entities';
import { AttackEvent, GameState, ItemType } from '../shared/types';

const BASE_SPAWN_INTERVAL = 2.8;
const MAX_ENEMIES_BASE = 7;
const ENEMY_DETECTION_RANGE = 240;
const CONTACT_DAMAGE_RANGE = 28;
const ENEMY_HIT_COOLDOWN = 1.1;
const ITEM_PICKUP_RANGE = 40;
const ATTACK_EVENT_TTL = 280;

export class Game {
  players: Map<string, PlayerEntity> = new Map();
  enemies: Map<string, EnemyEntity> = new Map();
  items: Map<string, ItemEntity> = new Map();
  wave: number = 1;
  score: number = 0;
  gameActive: boolean = true;
  private waveTimer: number = 0;
  private spawnTimer: number = 0;
  private attackCooldowns: Map<string, number> = new Map();
  private enemyHitCooldowns: Map<string, number> = new Map();
  private recentAttacks: AttackEvent[] = [];
  private waveKills = 0;

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

  attack(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.isAlive()) return;

    const cooldown = this.attackCooldowns.get(playerId) ?? 0;
    if (cooldown > 0) return;

    const target = this.findAttackTarget(player);
    if (!target) {
      this.recordAttack(player, false);
      this.attackCooldowns.set(playerId, player.attackCooldown);
      return;
    }

    target.enemy.takeDamage(player.getAttackDamage());
    this.recordAttack(player, true);
    this.attackCooldowns.set(playerId, player.attackCooldown);
  }

  update(deltaTime: number): void {
    this.tickCooldowns(deltaTime);
    this.recentAttacks = this.recentAttacks.filter((event) => Date.now() - event.createdAt < ATTACK_EVENT_TTL);

    if (this.players.size === 0) {
      this.enemies.clear();
      this.items.clear();
      this.spawnTimer = 0;
      this.waveKills = 0;
      this.gameActive = false;
      return;
    }

    this.gameActive = true;
    this.waveTimer += deltaTime;
    this.spawnTimer += deltaTime;

    // Spawn new enemies
    const maxEnemies = MAX_ENEMIES_BASE + Math.min(this.wave - 1, 6) + this.players.size * 2;
    const spawnInterval = Math.max(0.9, BASE_SPAWN_INTERVAL - this.wave * 0.12);
    if (this.spawnTimer >= spawnInterval && this.enemies.size < maxEnemies) {
      const enemiesToSpawn = Math.min(2, maxEnemies - this.enemies.size);
      for (let i = 0; i < enemiesToSpawn; i++) {
        const type = getRandomEnemyType(this.wave);
        const enemy = new EnemyEntity(type, this.wave);
        this.enemies.set(enemy.id, enemy);
      }
      this.spawnTimer = 0;
    }

    // Update enemy AI
    this.enemies.forEach((enemy, enemyId) => {
      let targetPlayer: PlayerEntity | undefined;
      let closestDistance = ENEMY_DETECTION_RANGE;

      // Find closest player
      this.players.forEach((player) => {
        const distance = this.getDistance(enemy, player);
        if (distance < closestDistance) {
          closestDistance = distance;
          targetPlayer = player;
        }
      });

      if (targetPlayer !== undefined) {
        enemy.moveTowards(targetPlayer.x, targetPlayer.y, deltaTime);
      } else {
        enemy.wander(deltaTime);
      }
    });

    // Handle collisions and attacks
    this.players.forEach((player) => {
      this.enemies.forEach((enemy) => {
        const distance = this.getDistance(player, enemy);

        // Contact damage range
        const hitKey = `${enemy.id}:${player.id}`;
        if (distance < CONTACT_DAMAGE_RANGE && !this.enemyHitCooldowns.has(hitKey)) {
          player.takeDamage(enemy.damage);
          this.enemyHitCooldowns.set(hitKey, ENEMY_HIT_COOLDOWN);
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

        this.waveKills++;
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
    if (this.waveKills >= this.getKillsToNextWave()) {
      this.wave++;
      this.waveKills = 0;
      this.waveTimer = 0;
      this.spawnTimer = 0;
      console.log(`Wave ${this.wave} started!`);
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
      waveKills: this.waveKills,
      killsToNextWave: this.getKillsToNextWave(),
      recentAttacks: this.recentAttacks,
    };
  }

  private getDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private findAttackTarget(player: PlayerEntity): { enemy: EnemyEntity; distance: number } | null {
    let target: { enemy: EnemyEntity; distance: number } | null = null;

    this.enemies.forEach((enemy) => {
      const distance = this.getDistance(player, enemy);
      if (distance > player.attackRange) return;
      if (!this.isInAttackArc(player, enemy)) return;
      if (!target || distance < target.distance) {
        target = { enemy, distance };
      }
    });

    return target;
  }

  private tickCooldowns(deltaTime: number): void {
    this.attackCooldowns.forEach((remaining, playerId) => {
      const next = remaining - deltaTime;
      if (next <= 0) {
        this.attackCooldowns.delete(playerId);
      } else {
        this.attackCooldowns.set(playerId, next);
      }
    });

    this.enemyHitCooldowns.forEach((remaining, key) => {
      const next = remaining - deltaTime;
      if (next <= 0) {
        this.enemyHitCooldowns.delete(key);
      } else {
        this.enemyHitCooldowns.set(key, next);
      }
    });
  }

  private isInAttackArc(player: PlayerEntity, enemy: EnemyEntity): boolean {
    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;
    const enemyCenterX = enemy.x + enemy.width / 2;
    const enemyCenterY = enemy.y + enemy.height / 2;
    const dx = enemyCenterX - playerCenterX;
    const dy = enemyCenterY - playerCenterY;
    const sideLimit = player.attackRange * 0.7;

    switch (player.direction) {
      case 'left':
        return dx <= 8 && Math.abs(dy) <= sideLimit;
      case 'right':
        return dx >= -8 && Math.abs(dy) <= sideLimit;
      case 'up':
        return dy <= 8 && Math.abs(dx) <= sideLimit;
      case 'down':
        return dy >= -8 && Math.abs(dx) <= sideLimit;
    }
  }

  private recordAttack(player: PlayerEntity, hit: boolean): void {
    this.recentAttacks.push({
      id: `${player.id}:${Date.now()}:${Math.random()}`,
      playerId: player.id,
      x: player.x + player.width / 2,
      y: player.y + player.height / 2,
      direction: player.direction,
      weapon: player.weapon,
      range: player.attackRange,
      hit,
      createdAt: Date.now(),
    });
  }

  private getKillsToNextWave(): number {
    return 6 + this.wave * 3;
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
