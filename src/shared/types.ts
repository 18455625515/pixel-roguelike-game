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
}

// WebSocket 消息类型
export type MessageType =
  | 'join'
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

export interface MoveMessage extends Message {
  type: 'move';
  payload: {
    dx: number;
    dy: number;
    direction: 'up' | 'down' | 'left' | 'right';
  };
}

export interface GameStateMessage extends Message {
  type: 'gameState';
  payload: GameState & { playerId: string };
}
