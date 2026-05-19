import { PlayerEntity, EnemyEntity, ItemEntity, getEnemyRank, getRandomEnemyType, getDroppedItem } from './entities';
import { AttackEvent, GameState, ItemType } from '../shared/types';

const BASE_SPAWN_INTERVAL = 2.8;
const MAX_ENEMIES_BASE = 7;
const ENEMY_DETECTION_RANGE = 240;
const CONTACT_DAMAGE_RANGE = 42;
const ENEMY_STOP_DISTANCE = 26;
const ENTITY_SEPARATION_DISTANCE = 30;
const PLAYER_SEPARATION_DISTANCE = 30;
const ENEMY_HIT_COOLDOWN = 1.1;
const ITEM_PICKUP_RANGE = 40;
const ATTACK_EVENT_TTL = 280;
const ATTACK_HALF_ANGLE = Math.PI * 0.28;

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
  private bossSpawnedForWave = false;

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
      this.bossSpawnedForWave = false;
      this.gameActive = false;
      return;
    }

    this.gameActive = true;
    this.waveTimer += deltaTime;
    this.spawnTimer += deltaTime;
    this.players.forEach((player) => player.regenerate(deltaTime));

    // Spawn new enemies
    const maxEnemies = MAX_ENEMIES_BASE + Math.min(this.wave - 1, 6) + this.players.size * 2;
    const spawnInterval = Math.max(0.9, BASE_SPAWN_INTERVAL - this.wave * 0.12);
    if (this.spawnTimer >= spawnInterval && this.enemies.size < maxEnemies) {
      const shouldSpawnBoss = this.shouldSpawnBoss();
      const enemiesToSpawn = shouldSpawnBoss ? 1 : Math.min(2, maxEnemies - this.enemies.size);
      for (let i = 0; i < enemiesToSpawn; i++) {
        const type = getRandomEnemyType(this.wave);
        const rank = getEnemyRank(this.wave, shouldSpawnBoss && i === 0);
        const enemy = new EnemyEntity(type, this.wave, rank);
        this.enemies.set(enemy.id, enemy);
      }
      if (shouldSpawnBoss) {
        this.bossSpawnedForWave = true;
      }
      this.spawnTimer = 0;
    }

    // Update enemy AI
    this.enemies.forEach((enemy, enemyId) => {
      let targetPlayer: PlayerEntity | undefined;
      let closestDistance = ENEMY_DETECTION_RANGE;

      // Find closest player
      this.players.forEach((player) => {
        const distance = this.getCenterDistance(enemy, player);
        if (distance < closestDistance) {
          closestDistance = distance;
          targetPlayer = player;
        }
      });

      if (targetPlayer !== undefined) {
        enemy.moveTowards(
          targetPlayer.x + targetPlayer.width / 2,
          targetPlayer.y + targetPlayer.height / 2,
          deltaTime,
          ENEMY_STOP_DISTANCE
        );
      } else {
        enemy.wander(deltaTime);
      }
    });

    this.resolveEntitySeparation();

    // Handle collisions and attacks
    this.players.forEach((player) => {
      this.enemies.forEach((enemy) => {
        const distance = this.getCenterDistance(player, enemy);

        // Contact damage range
        const hitKey = `${enemy.id}:${player.id}`;
        if (distance < CONTACT_DAMAGE_RANGE && !this.enemyHitCooldowns.has(hitKey)) {
          player.takeDamage(enemy.damage);
          this.enemyHitCooldowns.set(hitKey, ENEMY_HIT_COOLDOWN);
        }
      });

      // Item pickup
      this.items.forEach((item, itemId) => {
        const itemDistance = this.getPointToCenterDistance(player, item);
        if (itemDistance < ITEM_PICKUP_RANGE) {
          this.applyItem(player, item);
          this.items.delete(itemId);
        }
      });
    });

    // Remove dead enemies and drop items
    this.enemies.forEach((enemy, enemyId) => {
      if (!enemy.isAlive()) {
        // Drop item
        const drop = getDroppedItem(enemy);
        const item = new ItemEntity(enemy.x, enemy.y, drop.type, drop.value, drop.rarity);
        this.items.set(item.id, item);

        // Give experience to nearby players
        const rewardMultiplier = enemy.rank === 'boss' ? 5 : enemy.rank === 'elite' ? 2.2 : 1;
        this.players.forEach((player) => {
          const distance = this.getCenterDistance(player, enemy);
          if (distance < 300) {
            player.gainExperience(Math.floor(20 * this.wave * rewardMultiplier));
            this.score += Math.floor(10 * this.wave * rewardMultiplier);
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
      this.bossSpawnedForWave = false;
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

  private getCenterDistance(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ): number {
    const dx = a.x + a.width / 2 - (b.x + b.width / 2);
    const dy = a.y + a.height / 2 - (b.y + b.height / 2);
    return Math.sqrt(dx * dx + dy * dy);
  }

  private getPointToCenterDistance(
    entity: { x: number; y: number; width: number; height: number },
    point: { x: number; y: number }
  ): number {
    const dx = entity.x + entity.width / 2 - (point.x + 16);
    const dy = entity.y + entity.height / 2 - (point.y + 16);
    return Math.sqrt(dx * dx + dy * dy);
  }

  private findAttackTarget(player: PlayerEntity): { enemy: EnemyEntity; distance: number } | null {
    let target: { enemy: EnemyEntity; distance: number } | null = null;

    this.enemies.forEach((enemy) => {
      const distance = this.getCenterDistance(player, enemy);
      if (!this.isInAttackArc(player, enemy, distance)) return;
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

  private isInAttackArc(player: PlayerEntity, enemy: EnemyEntity, distance: number): boolean {
    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;
    const enemyCenterX = enemy.x + enemy.width / 2;
    const enemyCenterY = enemy.y + enemy.height / 2;
    const dx = enemyCenterX - playerCenterX;
    const dy = enemyCenterY - playerCenterY;
    const targetRadius = Math.max(enemy.width, enemy.height) / 2;
    if (distance > player.attackRange + targetRadius * 0.4) return false;

    const attackAngle = this.getDirectionAngle(player.direction);
    const targetAngle = Math.atan2(dy, dx);
    return Math.abs(this.getAngleDelta(attackAngle, targetAngle)) <= ATTACK_HALF_ANGLE;
  }

  private getDirectionAngle(direction: 'up' | 'down' | 'left' | 'right'): number {
    switch (direction) {
      case 'left':
        return Math.PI;
      case 'right':
        return 0;
      case 'up':
        return -Math.PI / 2;
      case 'down':
        return Math.PI / 2;
    }
  }

  private getAngleDelta(a: number, b: number): number {
    return Math.atan2(Math.sin(b - a), Math.cos(b - a));
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

  private shouldSpawnBoss(): boolean {
    return this.wave >= 5 && this.wave % 5 === 0 && !this.bossSpawnedForWave;
  }

  private resolveEntitySeparation(): void {
    this.enemies.forEach((enemy) => {
      this.players.forEach((player) => {
        this.pushApart(enemy, player, PLAYER_SEPARATION_DISTANCE, 1);
      });
    });

    const enemies = Array.from(this.enemies.values());
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) {
        this.pushApart(enemies[i], enemies[j], ENTITY_SEPARATION_DISTANCE, 0.5);
      }
    }
  }

  private pushApart(
    movable: { x: number; y: number; width: number; height: number },
    anchor: { x: number; y: number; width: number; height: number },
    minDistance: number,
    strength: number
  ): void {
    const movableCenterX = movable.x + movable.width / 2;
    const movableCenterY = movable.y + movable.height / 2;
    const anchorCenterX = anchor.x + anchor.width / 2;
    const anchorCenterY = anchor.y + anchor.height / 2;
    let dx = movableCenterX - anchorCenterX;
    let dy = movableCenterY - anchorCenterY;
    let distance = Math.sqrt(dx * dx + dy * dy);

    if (distance >= minDistance) return;

    if (distance === 0) {
      dx = Math.random() - 0.5;
      dy = Math.random() - 0.5;
      distance = Math.sqrt(dx * dx + dy * dy);
    }

    const push = (minDistance - distance) * strength;
    movable.x = this.clamp(movable.x + (dx / distance) * push, 0, 800 - movable.width);
    movable.y = this.clamp(movable.y + (dy / distance) * push, 0, 600 - movable.height);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
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
      case ItemType.RANGE:
        player.attackRange += item.value;
        break;
      case ItemType.VITALITY:
        player.regeneration += item.value;
        player.maxHealth += Math.round(item.value * 12);
        player.heal(Math.round(item.value * 20));
        break;
    }
  }
}
