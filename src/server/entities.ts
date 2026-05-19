import { v4 as uuidv4 } from 'uuid';
import { Player, Enemy, EnemyRank, Item, ItemRarity, ItemType, WeaponType } from '../shared/types';

const TILE_SIZE = 32;
const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;

interface WeaponStats {
  type: WeaponType;
  name: string;
  damageBonus: number;
  range: number;
  cooldown: number;
}

const WEAPONS: WeaponStats[] = [
  { type: 'rustySword', name: 'Rusty Sword', damageBonus: 0, range: 52, cooldown: 0.42 },
  { type: 'ironSword', name: 'Iron Sword', damageBonus: 8, range: 60, cooldown: 0.36 },
  { type: 'battleAxe', name: 'Battle Axe', damageBonus: 18, range: 58, cooldown: 0.52 },
  { type: 'crystalBlade', name: 'Crystal Blade', damageBonus: 28, range: 72, cooldown: 0.3 },
];

export class PlayerEntity implements Player {
  id: string;
  name: string;
  x: number;
  y: number;
  width = TILE_SIZE;
  height = TILE_SIZE;
  health: number;
  maxHealth = 100;
  damage = 10;
  speed = 150; // pixels per second
  armor = 0;
  level = 1;
  experience = 0;
  experienceToNextLevel = 100;
  weapon: WeaponType = 'rustySword';
  weaponName = 'Rusty Sword';
  attackRange = 52;
  attackCooldown = 0.42;
  direction: 'up' | 'down' | 'left' | 'right' = 'down';
  regeneration = 0;

  constructor(name: string) {
    this.id = uuidv4();
    this.name = name;
    this.x = Math.random() * (MAP_WIDTH - this.width);
    this.y = Math.random() * (MAP_HEIGHT - this.height);
    this.health = this.maxHealth;
  }

  takeDamage(damage: number): void {
    const actualDamage = Math.max(1, damage - this.armor);
    this.health = Math.max(0, this.health - actualDamage);
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  regenerate(deltaTime: number): void {
    if (this.regeneration <= 0 || !this.isAlive()) return;
    this.heal(this.regeneration * deltaTime);
  }

  gainExperience(amount: number): void {
    this.experience += amount;
    while (this.experience >= this.experienceToNextLevel) {
      this.experience -= this.experienceToNextLevel;
      this.levelUp();
    }
  }

  private levelUp(): void {
    this.level++;
    this.experienceToNextLevel = 100 + (this.level - 1) * 55;
    this.maxHealth += 14;
    this.health = Math.min(this.maxHealth, this.health + 30);
    this.damage += 3;
    this.speed += 4;
    this.updateWeapon();
  }

  getAttackDamage(): number {
    const weapon = this.getWeaponStats();
    return this.damage + weapon.damageBonus;
  }

  private updateWeapon(): void {
    let weapon = WEAPONS[0];
    if (this.level >= 7) {
      weapon = WEAPONS[3];
    } else if (this.level >= 5) {
      weapon = WEAPONS[2];
    } else if (this.level >= 3) {
      weapon = WEAPONS[1];
    }

    this.weapon = weapon.type;
    this.weaponName = weapon.name;
    this.attackRange = weapon.range;
    this.attackCooldown = weapon.cooldown;
  }

  private getWeaponStats(): WeaponStats {
    return WEAPONS.find((weapon) => weapon.type === this.weapon) ?? WEAPONS[0];
  }

  move(dx: number, dy: number, deltaTime: number): void {
    const distance = this.speed * deltaTime;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length > 0) {
      const normalizedDx = (dx / length) * distance;
      const normalizedDy = (dy / length) * distance;

      this.x = Math.max(0, Math.min(MAP_WIDTH - this.width, this.x + normalizedDx));
      this.y = Math.max(0, Math.min(MAP_HEIGHT - this.height, this.y + normalizedDy));
    }
  }

  isAlive(): boolean {
    return this.health > 0;
  }
}

export class EnemyEntity implements Enemy {
  id: string;
  x: number;
  y: number;
  width = TILE_SIZE;
  height = TILE_SIZE;
  health: number;
  maxHealth: number;
  damage: number;
  speed: number;
  type: 'goblin' | 'orc' | 'troll' | 'dragon';
  wave: number;
  rank: EnemyRank;
  private directionX: number = 1;
  private directionY: number = 0;
  private directionChangeTimer: number = 0;

  constructor(type: 'goblin' | 'orc' | 'troll' | 'dragon', wave: number, rank: EnemyRank = 'normal') {
    this.id = uuidv4();
    this.type = type;
    this.wave = wave;
    this.rank = rank;

    this.x = Math.random() * (MAP_WIDTH - this.width);
    this.y = Math.random() * (MAP_HEIGHT - this.height);

    const stats = this.getStatsForType(type, wave, rank);
    this.maxHealth = stats.maxHealth;
    this.health = this.maxHealth;
    this.damage = stats.damage;
    this.speed = stats.speed;
  }

  private getStatsForType(
    type: 'goblin' | 'orc' | 'troll' | 'dragon',
    wave: number,
    rank: EnemyRank
  ): { maxHealth: number; damage: number; speed: number } {
    const waveMultiplier = 1 + wave * 0.2;
    const rankStats = {
      normal: { health: 1, damage: 1, speed: 1 },
      elite: { health: 2.4, damage: 1.45, speed: 1.1 },
      boss: { health: 5.5, damage: 2.1, speed: 0.92 },
    };
    const stats = {
      goblin: { maxHealth: 20, damage: 3, speed: 42 },
      orc: { maxHealth: 40, damage: 6, speed: 52 },
      troll: { maxHealth: 80, damage: 10, speed: 34 },
      dragon: { maxHealth: 150, damage: 15, speed: 64 },
    };

    const baseStats = stats[type];
    const rankMultiplier = rankStats[rank];
    return {
      maxHealth: Math.floor(baseStats.maxHealth * waveMultiplier * rankMultiplier.health),
      damage: Math.floor(baseStats.damage * waveMultiplier * rankMultiplier.damage),
      speed: Math.min((baseStats.speed + wave * 2) * rankMultiplier.speed, baseStats.speed + 24),
    };
  }

  takeDamage(damage: number): void {
    this.health = Math.max(0, this.health - damage);
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  moveTowards(targetX: number, targetY: number, deltaTime: number, stopDistance = 0): void {
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    const dx = targetX - centerX;
    const dy = targetY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > stopDistance) {
      const moveDistance = Math.min(this.speed * deltaTime, distance - stopDistance);
      const normalizedDx = (dx / distance) * moveDistance;
      const normalizedDy = (dy / distance) * moveDistance;

      this.x = Math.max(0, Math.min(MAP_WIDTH - this.width, this.x + normalizedDx));
      this.y = Math.max(0, Math.min(MAP_HEIGHT - this.height, this.y + normalizedDy));
    }
  }

  wander(deltaTime: number): void {
    this.directionChangeTimer -= deltaTime;

    if (this.directionChangeTimer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      this.directionX = Math.cos(angle);
      this.directionY = Math.sin(angle);
      this.directionChangeTimer = 2 + Math.random() * 2;
    }

    const moveDistance = this.speed * deltaTime;
    this.x = Math.max(0, Math.min(MAP_WIDTH - this.width, this.x + this.directionX * moveDistance));
    this.y = Math.max(0, Math.min(MAP_HEIGHT - this.height, this.y + this.directionY * moveDistance));
  }
}

export class ItemEntity implements Item {
  id: string;
  x: number;
  y: number;
  type: ItemType;
  value: number;
  rarity: ItemRarity;

  constructor(x: number, y: number, type: ItemType, value: number, rarity: ItemRarity = 'common') {
    this.id = uuidv4();
    this.x = x;
    this.y = y;
    this.type = type;
    this.value = value;
    this.rarity = rarity;
  }
}

export function getRandomEnemyType(wave: number): 'goblin' | 'orc' | 'troll' | 'dragon' {
  if (wave < 3) return 'goblin';
  if (wave < 5) return Math.random() > 0.5 ? 'goblin' : 'orc';
  if (wave < 8) return Math.random() > 0.5 ? 'orc' : 'troll';
  return 'dragon';
}

export function getEnemyRank(wave: number, forceBoss = false): EnemyRank {
  if (forceBoss) return 'boss';
  const eliteChance = Math.min(0.08 + wave * 0.015, 0.24);
  return Math.random() < eliteChance ? 'elite' : 'normal';
}

export function getDroppedItem(enemy: EnemyEntity): { type: ItemType; rarity: ItemRarity; value: number } {
  const rand = Math.random();
  const rarity = getDropRarity(enemy);
  const valueMultiplier = rarity === 'epic' ? 2.5 : rarity === 'rare' ? 1.65 : 1;
  let type: ItemType;

  if (rand < 0.36) type = ItemType.HEALTH;
  else if (rand < 0.57) type = ItemType.DAMAGE;
  else if (rand < 0.73) type = ItemType.SPEED;
  else if (rand < 0.88) type = ItemType.ARMOR;
  else if (rand < 0.96) type = ItemType.RANGE;
  else type = ItemType.VITALITY;

  const baseValue: Record<ItemType, number> = {
    [ItemType.HEALTH]: 24 + enemy.wave * 6,
    [ItemType.DAMAGE]: 2 + enemy.wave,
    [ItemType.SPEED]: 5,
    [ItemType.ARMOR]: 1 + enemy.wave * 0.35,
    [ItemType.RANGE]: 5,
    [ItemType.VITALITY]: 0.35,
  };

  return {
    type,
    rarity,
    value: Math.max(1, Math.round(baseValue[type] * valueMultiplier * 10) / 10),
  };
}

function getDropRarity(enemy: EnemyEntity): ItemRarity {
  if (enemy.rank === 'boss') return 'epic';
  if (enemy.rank === 'elite') return Math.random() < 0.55 ? 'rare' : 'common';
  const roll = Math.random();
  if (roll < 0.04) return 'epic';
  if (roll < 0.18) return 'rare';
  return 'common';
}
