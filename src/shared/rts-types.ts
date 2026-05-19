export type TerrainType = 'grass' | 'forest' | 'mountain' | 'water' | 'road' | 'field' | 'bridge';
export type FactionStance = 'player' | 'ally' | 'neutral' | 'enemy';
export type ResourceType = 'food' | 'wood' | 'stone' | 'iron' | 'gold' | 'population';
export type UnitRole =
  | 'commander'
  | 'worker'
  | 'woodcutter'
  | 'stonecutter'
  | 'miner'
  | 'farmer'
  | 'trader'
  | 'swordsman'
  | 'spearman'
  | 'archer'
  | 'cavalry'
  | 'engineer'
  | 'guard';
export type BuildingType =
  | 'townHall'
  | 'house'
  | 'farm'
  | 'lumberCamp'
  | 'warehouse'
  | 'barracks'
  | 'market'
  | 'wall'
  | 'gate'
  | 'bridge'
  | 'tower';
export type OrderType = 'idle' | 'move' | 'attack' | 'gather' | 'build' | 'defend' | 'patrol' | 'trade';

export interface RtsVector {
  x: number;
  y: number;
}

export interface Tile {
  x: number;
  y: number;
  terrain: TerrainType;
  fertility: number;
  resource?: ResourceType;
  resourceAmount?: number;
  maxResourceAmount?: number;
  resourceRegenAt?: number;
  depletedTerrain?: TerrainType;
  depletedResource?: ResourceType;
}

export interface Faction {
  id: string;
  name: string;
  color: string;
  stance: FactionStance;
  resources: Record<ResourceType, number>;
  relations: Record<string, number>;
}

export interface UnitOrder {
  type: OrderType;
  target?: RtsVector;
  targetId?: string;
  targetTile?: { x: number; y: number };
  resource?: ResourceType;
  returning?: boolean;
  path?: RtsVector[];
  pathTarget?: RtsVector;
}

export interface Unit {
  id: string;
  factionId: string;
  role: UnitRole;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  health: number;
  maxHealth: number;
  damage: number;
  range: number;
  speed: number;
  morale: number;
  carrying?: ResourceType;
  carryingAmount: number;
  order: UnitOrder;
  selected: boolean;
  direction: 'up' | 'down' | 'left' | 'right';
  attackCooldown: number;
}

export interface Building {
  id: string;
  factionId: string;
  type: BuildingType;
  x: number;
  y: number;
  width: number;
  height: number;
  health: number;
  maxHealth: number;
  complete: boolean;
  progress: number;
  rallyPoint?: RtsVector;
  footprintTerrain?: TerrainType[];
}

export interface DiplomacyEvent {
  id: string;
  message: string;
  createdAt: number;
}

export interface CombatEvent {
  id: string;
  kind: 'melee' | 'arrow' | 'hit' | 'command' | 'gather' | 'deposit' | 'build';
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  createdAt: number;
  resource?: ResourceType;
  amount?: number;
}

export interface RtsGameState {
  mapWidth: number;
  mapHeight: number;
  tileSize: number;
  day: number;
  timeOfDay: number;
  factions: Record<string, Faction>;
  tiles: Tile[];
  units: Record<string, Unit>;
  buildings: Record<string, Building>;
  selectedUnitIds: string[];
  activeCommanderId: string | null;
  buildMode: BuildingType | null;
  diplomacyLog: DiplomacyEvent[];
  combatEvents: CombatEvent[];
}
