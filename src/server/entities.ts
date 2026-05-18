import { v4 as uuidv4 } from 'uuid';
import { Player, Enemy, Item, ItemType, WeaponType } from '../shared/types';

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
  private directionX: number = 1;
  private directionY: number = 0;
  private directionChangeTimer: number = 0;

  constructor(type: 'goblin' | 'orc' | 'troll' | 'dragon', wave: number) {
    this.id = uuidv4();
    this.type = type;
    this.wave = wave;

    this.x = Math.random() * (MAP_WIDTH - this.width);
    this.y = Math.random() * (MAP_HEIGHT - this.height);

    const stats = this.getStatsForType(type, wave);
    this.maxHealth = stats.maxHealth;
    this.health = this.maxHealth;
    this.damage = stats.damage;
    this.speed = stats.speed;
  }

  private getStatsForType(
    type: 'goblin' | 'orc' | 'troll' | 'dragon',
    wave: number
  ): { maxHealth: number; damage: number; speed: number } {
    const waveMultiplier = 1 + wave * 0.2;
    const stats = {
      goblin: { maxHealth: 20, damage: 3, speed: 42 },
      orc: { maxHealth: 40, damage: 6, speed: 52 },
      troll: { maxHealth: 80, damage: 10, speed: 34 },
      dragon: { maxHealth: 150, damage: 15, speed: 64 },
    };

    const baseStats = stats[type];
    return {
      maxHealth: Math.floor(baseStats.maxHealth * waveMultiplier),
      damage: Math.floor(baseStats.damage * waveMultiplier),
      speed: Math.min(baseStats.speed + wave * 2, baseStats.speed + 18),
    };
  }

  takeDamage(damage: number): void {
    this.health = Math.max(0, this.health - damage);
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  moveTowards(targetX: number, targetY: number, deltaTime: number): void {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0) {
      const moveDistance = this.speed * deltaTime;
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

  constructor(x: number, y: number, type: ItemType, value: number) {
    this.id = uuidv4();
    this.x = x;
    this.y = y;
    this.type = type;
    this.value = value;
  }
}

export function getRandomEnemyType(wave: number): 'goblin' | 'orc' | 'troll' | 'dragon' {
  if (wave < 3) return 'goblin';
  if (wave < 5) return Math.random() > 0.5 ? 'goblin' : 'orc';
  if (wave < 8) return Math.random() > 0.5 ? 'orc' : 'troll';
  return 'dragon';
}

export function getDroppedItem(enemy: EnemyEntity): ItemType {
  const rand = Math.random();
  if (rand < 0.5) return ItemType.HEALTH;
  if (rand < 0.75) return ItemType.DAMAGE;
  if (rand < 0.9) return ItemType.SPEED;
  return ItemType.ARMOR;
}
