// 共享的类型定义

export enum EntityType {
  PLAYER = 'player',
  ENEMY = 'enemy',
  ITEM = 'item',
}

export enum ItemType {
  HEALTH = 'health',
  DAMAGE = 'damage',
  SPEED = 'speed',
  ARMOR = 'armor',
}

export type WeaponType = 'rustySword' | 'ironSword' | 'battleAxe' | 'crystalBlade';

export interface Vector2 {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  health: number;
  maxHealth: number;
  damage: number;
  speed: number;
  armor: number;
  level: number;
  experience: number;
  experienceToNextLevel: number;
  weapon: WeaponType;
  weaponName: string;
  attackRange: number;
  attackCooldown: number;
  direction: 'up' | 'down' | 'left' | 'right';
}

export interface Enemy {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  health: number;
  maxHealth: number;
  damage: number;
  speed: number;
  type: 'goblin' | 'orc' | 'troll' | 'dragon';
  wave: number;
}

export interface Item {
  id: string;
  x: number;
  y: number;
  type: ItemType;
  value: number;
}

export interface GameState {
  players: Record<string, Player>;
  enemies: Record<string, Enemy>;
  items: Record<string, Item>;
  wave: number;
  score: number;
  gameActive: boolean;
  waveKills: number;
  killsToNextWave: number;
  recentAttacks: AttackEvent[];
}

export interface AttackEvent {
  id: string;
  playerId: string;
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
  weapon: WeaponType;
  range: number;
  hit: boolean;
  createdAt: number;
}

// WebSocket 消息类型
export type MessageType =
  | 'join'
  | 'joinSuccess'
  | 'move'
  | 'attack'
  | 'gameState'
  | 'playerUpdate'
  | 'enemyUpdate'
  | 'itemUpdate'
  | 'itemPickup'
  | 'playerDeath'
  | 'waveComplete'
  | 'chat';

export interface Message {
  type: MessageType;
  payload: any;
}

export interface JoinMessage extends Message {
  type: 'join';
  payload: {
    name: string;
  };
}

export interface JoinSuccessMessage extends Message {
  type: 'joinSuccess';
  payload: {
    playerId: string;
    player: Player;
  };
}

export interface MoveMessage extends Message {
  type: 'move';
  payload: {
    dx: number;
    dy: number;
    direction: 'up' | 'down' | 'left' | 'right';
  };
}

export interface AttackMessage extends Message {
  type: 'attack';
  payload: Record<string, never>;
}

export interface GameStateMessage extends Message {
  type: 'gameState';
  payload: GameState & { playerId: string };
}
