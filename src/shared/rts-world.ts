import {
  Building,
  BuildingType,
  Faction,
  ResourceType,
  RtsGameState,
  RtsVector,
  TerrainType,
  Tile,
  Unit,
  UnitRole,
} from './rts-types';
import { BUILDING_CATALOG } from './building-catalog';
import { MapBuildingData, MapData, MapTileData, MapUnitData } from './map-data';
import { MinHeap } from './pathfinding';
import { FACTION_START_HINTS, isWorldLand, worldLandScore } from './world-map';

const TILE_SIZE = 32;
const MAP_WIDTH = 280;
const MAP_HEIGHT = 170;
const DAY_DURATION_SECONDS = 210;
const ALLY_COUNTER_ATTACK_RANGE = 340;
const PATHFIND_MAX_ITERATIONS = 1600;
const PATHFIND_FRAME_BUDGET = 8;
const AI_THINK_INTERVAL = 0.4;
const UNIT_SPATIAL_CELL = 64;
const MAX_PATH_WAYPOINTS = 40;
const DIRECT_PATH_TILE_THRESHOLD = 14;
const ECONOMY_GATHER_ASSIGN_PER_TICK = 6;
const MAX_ACTIVE_UNITS_SOFT = 120;
const UNIT_SIZE = 32;
const UNIT_COLLISION_RADIUS = 13;
const COMBAT_EVENT_TTL = 650;
const FOREST_REGEN_SECONDS = 45;
const QUARRY_REGEN_SECONDS = 120;
const CITY_HEAL_RADIUS = 260;
const CITY_HEAL_PER_SECOND = 8;
const AUTO_AGGRO_RANGE = 210;
const TRUCE_DURATION_SECONDS = 300;
const WORKER_FLEE_RANGE = 280;
const WORKER_FLEE_DISTANCE = 160;
const BUILD_WORK_PER_SECOND = 18;
const BUILD_WORK_RANGE = 72;
const STUCK_UNBLOCK_SECONDS = 0.8;
const STUCK_SIDE_STEP = TILE_SIZE * 1.15;
const FRIENDLY_COLLISION_FACTOR = 0.28;

const NPC_FACTION_IDS = ['north', 'village', 'miners', 'south', 'raiders'] as const;

const RESOURCE_TYPES: ResourceType[] = ['food', 'wood', 'stone', 'iron', 'gold', 'population'];

const BUILDING_COSTS: Record<BuildingType, Partial<Record<ResourceType, number>>> = {
  townHall: { wood: 120, stone: 80 },
  house: { wood: 35 },
  farm: { wood: 20 },
  lumberCamp: { wood: 30 },
  warehouse: { wood: 45, stone: 15 },
  barracks: { wood: 80, stone: 35 },
  market: { wood: 70, gold: 30 },
  smithy: { wood: 55, stone: 40, iron: 20 },
  stable: { wood: 65, food: 40, gold: 25 },
  wall: { stone: 12 },
  gate: { wood: 25, stone: 20 },
  bridge: { wood: 45, stone: 10 },
  tower: { wood: 40, stone: 55 },
};

const BUILDING_STATS: Record<BuildingType, { width: number; height: number; maxHealth: number }> = {
  townHall: { width: 3, height: 3, maxHealth: 900 },
  house: { width: 2, height: 2, maxHealth: 240 },
  farm: { width: 3, height: 3, maxHealth: 160 },
  lumberCamp: { width: 2, height: 2, maxHealth: 260 },
  warehouse: { width: 2, height: 2, maxHealth: 340 },
  barracks: { width: 3, height: 2, maxHealth: 500 },
  market: { width: 3, height: 2, maxHealth: 420 },
  smithy: { width: 2, height: 2, maxHealth: 480 },
  stable: { width: 3, height: 2, maxHealth: 440 },
  wall: { width: 1, height: 1, maxHealth: 380 },
  gate: { width: 1, height: 1, maxHealth: 450 },
  bridge: { width: 1, height: 1, maxHealth: 260 },
  tower: { width: 1, height: 1, maxHealth: 520 },
};

const UNIT_STATS: Record<UnitRole, { maxHealth: number; damage: number; range: number; speed: number; cost: Partial<Record<ResourceType, number>> }> = {
  commander: { maxHealth: 180, damage: 16, range: 48, speed: 130, cost: {} },
  worker: { maxHealth: 70, damage: 4, range: 28, speed: 105, cost: { food: 20, gold: 8 } },
  woodcutter: { maxHealth: 70, damage: 4, range: 28, speed: 105, cost: { food: 20, gold: 8 } },
  stonecutter: { maxHealth: 76, damage: 5, range: 28, speed: 96, cost: { food: 22, gold: 10 } },
  miner: { maxHealth: 74, damage: 5, range: 28, speed: 98, cost: { food: 22, gold: 12 } },
  farmer: { maxHealth: 65, damage: 3, range: 26, speed: 100, cost: { food: 15, gold: 6 } },
  trader: { maxHealth: 75, damage: 2, range: 24, speed: 95, cost: { food: 20, gold: 20 } },
  swordsman: { maxHealth: 110, damage: 13, range: 34, speed: 88, cost: { food: 35, iron: 15, gold: 18 } },
  spearman: { maxHealth: 95, damage: 11, range: 54, speed: 84, cost: { food: 30, wood: 12, iron: 8, gold: 14 } },
  archer: { maxHealth: 72, damage: 9, range: 150, speed: 92, cost: { food: 25, wood: 25, gold: 16 } },
  cavalry: { maxHealth: 135, damage: 18, range: 46, speed: 145, cost: { food: 55, iron: 25, gold: 42 } },
  engineer: { maxHealth: 80, damage: 5, range: 28, speed: 90, cost: { food: 25, wood: 20, gold: 20 } },
  guard: { maxHealth: 125, damage: 12, range: 58, speed: 78, cost: { food: 40, wood: 10, iron: 20, gold: 22 } },
};

export class RtsWorld {
  state: RtsGameState;
  /** 玩家主城中心（世界坐标），用于初始镜头 */
  playerBaseCenter: RtsVector = { x: 0, y: 0 };
  private nextId = 1;
  private spawnTimer = 0;
  private economyTimer = 0;
  private stuckUnits = new Map<string, { seconds: number; lastX: number; lastY: number }>();
  /** 建筑修建工位：buildingId -> 已占用的 slot 索引 */
  private buildSlotsTaken = new Map<string, Set<number>>();
  /** 单位当前占用的修建工位 */
  private buildSlotByUnit = new Map<string, { buildingId: string; slot: number }>();
  /** 资源格采集预约：tileKey -> unitId */
  private gatherTileReserved = new Map<string, string>();
  private pathfindBudget = PATHFIND_FRAME_BUDGET;
  private unitSpatial = new Map<string, Unit[]>();
  private unitListCache: Unit[] = [];
  private unitCount = 0;
  private aiThinkTimers = new Map<string, number>();
  private attackRetargetTimers = new Map<string, number>();
  private collisionParity = false;
  private economyGatherCursor = 0;
  /** 地图编辑器模式下暂停模拟 */
  simulationPaused = false;
  /** 开局时在场、需全部摧毁其大本营才算胜利的 NPC 阵营 */
  private npcFactionsInPlay = new Set<string>();

  constructor(options?: { mapData?: MapData; editorMode?: boolean }) {
    this.simulationPaused = options?.editorMode ?? false;
    if (options?.mapData) {
      this.state = this.createStateFromMapData(options.mapData);
    } else {
      this.state = this.createInitialState();
    }
  }

  exportMapData(name?: string): MapData {
    const tiles: MapTileData[] = [];
    this.state.tiles.forEach((tile) => {
      const isDefaultGrass = tile.terrain === 'grass' && !tile.resource && (tile.fertility ?? 0.8) >= 0.7;
      if (isDefaultGrass) return;
      tiles.push({
        x: tile.x,
        y: tile.y,
        terrain: tile.terrain,
        fertility: tile.fertility,
        resource: tile.resource,
        resourceAmount: tile.resourceAmount,
      });
    });

    const buildings: MapBuildingData[] = Object.values(this.state.buildings).map((b) => ({
      factionId: b.factionId,
      type: b.type,
      tileX: Math.floor(b.x / TILE_SIZE),
      tileY: Math.floor(b.y / TILE_SIZE),
      complete: b.complete,
    }));

    const units: MapUnitData[] = Object.values(this.state.units).map((u) => ({
      factionId: u.factionId,
      role: u.role,
      tileX: Math.floor(u.x / TILE_SIZE),
      tileY: Math.floor(u.y / TILE_SIZE),
    }));

    const hall = Object.values(this.state.buildings).find((b) => b.factionId === 'player' && b.type === 'townHall');

    return {
      version: 1,
      name: name ?? '自定义地图',
      mapWidth: this.state.mapWidth,
      mapHeight: this.state.mapHeight,
      tileSize: this.state.tileSize,
      tiles,
      buildings,
      units,
      playerStart: hall
        ? { tileX: Math.floor(hall.x / TILE_SIZE), tileY: Math.floor(hall.y / TILE_SIZE) }
        : undefined,
    };
  }

  editorSetTerrain(tileX: number, tileY: number, terrain: TerrainType): boolean {
    const tile = this.getTile(tileX, tileY);
    if (!tile) return false;
    tile.terrain = terrain;
    if (terrain === 'water' || terrain === 'mountain') {
      tile.resource = undefined;
      tile.resourceAmount = undefined;
    }
    if (terrain === 'field') tile.fertility = 0.85;
    if (terrain === 'grass') tile.fertility = 0.75 + Math.random() * 0.2;
    return true;
  }

  editorSetResource(tileX: number, tileY: number, resource: ResourceType | null, amount = 100): boolean {
    const tile = this.getTile(tileX, tileY);
    if (!tile || tile.terrain === 'water') return false;
    if (!resource) {
      tile.resource = undefined;
      tile.resourceAmount = undefined;
      return true;
    }
    tile.resource = resource;
    tile.resourceAmount = amount;
    tile.maxResourceAmount = amount;
    if (resource === 'wood' && tile.terrain !== 'forest') tile.terrain = 'forest';
    if ((resource === 'stone' || resource === 'iron') && tile.terrain !== 'mountain') tile.terrain = 'mountain';
    return true;
  }

  editorPlaceBuilding(factionId: string, type: BuildingType, tileX: number, tileY: number, complete = true): Building | null {
    const stats = BUILDING_STATS[type];
    if (!this.canPlaceBuilding(tileX, tileY, stats.width, stats.height, type)) return null;
    const building = this.createBuilding(factionId, type, tileX * TILE_SIZE, tileY * TILE_SIZE, complete);
    this.state.buildings[building.id] = building;
    return building;
  }

  editorPlaceUnit(factionId: string, role: UnitRole, tileX: number, tileY: number): Unit | null {
    const pos = this.findUnitSpawnNear(tileX, tileY, Object.keys(this.state.units).length);
    const unit = this.createUnit(factionId, role, pos.x, pos.y);
    this.state.units[unit.id] = unit;
    return unit;
  }

  editorRemoveAt(world: RtsVector): void {
    const unit = this.getUnitAt(world);
    if (unit) {
      delete this.state.units[unit.id];
      return;
    }
    const building = this.getBuildingAt(world);
    if (building) {
      this.restoreTerrainForBuilding(building);
      delete this.state.buildings[building.id];
    }
  }

  editorResizeMap(mapWidth: number, mapHeight: number): void {
    const old = this.state.tiles;
    const oldW = this.state.mapWidth;
    const tiles: Tile[] = [];
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const prev = x < oldW && y < this.state.mapHeight ? old[y * oldW + x] : null;
        tiles.push(
          prev ?? {
            x,
            y,
            terrain: 'grass',
            fertility: 0.8,
          }
        );
      }
    }
    this.state.mapWidth = mapWidth;
    this.state.mapHeight = mapHeight;
    this.state.tiles = tiles;
  }

  update(deltaTime: number): void {
    if (this.simulationPaused) return;
    if (this.state.gameOutcome !== 'playing') return;

    if (this.state.truceRemaining > 0) {
      const prev = this.state.truceRemaining;
      this.state.truceRemaining = Math.max(0, this.state.truceRemaining - deltaTime);
      if (prev > 0 && this.state.truceRemaining === 0) {
        this.log('停战结束：各方势力将开始争夺边境。');
      }
    }

    this.state.timeOfDay += deltaTime;
    if (this.state.timeOfDay >= DAY_DURATION_SECONDS) {
      this.state.timeOfDay = 0;
      this.state.day++;
      this.log(`第 ${this.state.day} 天：斥候报告边境附近有动静。`);
    }

    this.state.combatEvents = this.state.combatEvents.filter((event) => Date.now() - event.createdAt < COMBAT_EVENT_TTL);
    this.economyTimer += deltaTime;
    if (this.economyTimer >= 1) {
      this.economyTimer = 0;
      this.tickEconomy();
      this.tickTowers();
      this.tickResourceRegrowth();
      this.tickCityHealing();
    }

    this.rebuildUnitSpatialIndex();
    this.spawnTimer += deltaTime;
    if (
      !this.isTruceActive() &&
      this.spawnTimer >= Math.max(14, 34 - this.state.day * 2) &&
      this.unitCount < MAX_ACTIVE_UNITS_SOFT
    ) {
      this.spawnTimer = 0;
      this.spawnRaid();
    }

    this.unitListCache.forEach((unit) => this.updateUnit(unit, deltaTime));
    this.collisionParity = !this.collisionParity;
    if (this.unitCount < 55 || this.collisionParity) {
      this.resolveUnitCollisions();
    }
    if (this.unitCount < 90) {
      this.ejectTrappedUnits();
    }
    this.removeDeadEntities();
  }

  private rebuildUnitSpatialIndex(): void {
    this.pathfindBudget = PATHFIND_FRAME_BUDGET;
    this.unitSpatial.clear();
    this.unitListCache = Object.values(this.state.units);
    this.unitCount = this.unitListCache.length;

    this.unitListCache.forEach((unit) => {
      const center = this.centerOf(unit);
      const cx = Math.floor(center.x / UNIT_SPATIAL_CELL);
      const cy = Math.floor(center.y / UNIT_SPATIAL_CELL);
      const key = `${cx}:${cy}`;
      const bucket = this.unitSpatial.get(key);
      if (bucket) bucket.push(unit);
      else this.unitSpatial.set(key, [unit]);
    });
  }

  private queryUnitsNear(
    center: RtsVector,
    radius: number,
    filter: (candidate: Unit) => boolean
  ): Unit[] {
    const cells = Math.ceil(radius / UNIT_SPATIAL_CELL);
    const cx = Math.floor(center.x / UNIT_SPATIAL_CELL);
    const cy = Math.floor(center.y / UNIT_SPATIAL_CELL);
    const radiusSq = radius * radius;
    const matches: Unit[] = [];

    for (let ox = -cells; ox <= cells; ox++) {
      for (let oy = -cells; oy <= cells; oy++) {
        const bucket = this.unitSpatial.get(`${cx + ox}:${cy + oy}`);
        if (!bucket) continue;
        bucket.forEach((candidate) => {
          if (!filter(candidate)) return;
          const dx = this.centerOf(candidate).x - center.x;
          const dy = this.centerOf(candidate).y - center.y;
          if (dx * dx + dy * dy <= radiusSq) matches.push(candidate);
        });
      }
    }
    return matches;
  }

  private assignPath(unit: Unit, target: RtsVector): void {
    const start = this.centerOf(unit);
    const distTiles = Math.hypot(target.x - start.x, target.y - start.y) / TILE_SIZE;
    if (distTiles <= DIRECT_PATH_TILE_THRESHOLD) {
      unit.order.path = [target];
      unit.order.pathTarget = target;
      unit.order.target = target;
      return;
    }

    if (this.pathfindBudget > 0) {
      this.pathfindBudget -= 1;
      unit.order.path = this.simplifyPath(this.findPath(start, target));
    } else {
      unit.order.path = [target];
    }
    unit.order.pathTarget = target;
    unit.order.target = target;
  }

  private simplifyPath(path: RtsVector[]): RtsVector[] {
    if (path.length <= MAX_PATH_WAYPOINTS) return path;
    const step = Math.ceil(path.length / MAX_PATH_WAYPOINTS);
    const simplified: RtsVector[] = [];
    for (let i = 0; i < path.length; i += step) simplified.push(path[i]);
    const last = path[path.length - 1];
    if (simplified[simplified.length - 1] !== last) simplified.push(last);
    return simplified;
  }

  selectUnitsInRect(start: RtsVector, end: RtsVector): void {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const selected: string[] = [];

    Object.values(this.state.units).forEach((unit) => {
      unit.selected =
        unit.factionId === 'player' &&
        unit.x + unit.width >= minX &&
        unit.x <= maxX &&
        unit.y + unit.height >= minY &&
        unit.y <= maxY;
      if (unit.selected) selected.push(unit.id);
    });

    this.state.selectedUnitIds = selected;
  }

  selectSingleUnit(world: RtsVector): void {
    let found: Unit | undefined;
    Object.values(this.state.units).forEach((unit) => {
      if (
        unit.factionId === 'player' &&
        world.x >= unit.x &&
        world.x <= unit.x + unit.width &&
        world.y >= unit.y &&
        world.y <= unit.y + unit.height
      ) {
        found = unit;
      }
    });

    Object.values(this.state.units).forEach((unit) => {
      unit.selected = found?.id === unit.id;
    });
    this.state.selectedUnitIds = found ? [found.id] : [];
  }

  commandSelectedMove(target: RtsVector): void {
    this.state.selectedUnitIds.forEach((id, index) => {
      const unit = this.state.units[id];
      if (!unit) return;
      const offsetTarget = {
        x: target.x + (index % 4) * 22,
        y: target.y + Math.floor(index / 4) * 22,
      };
      this.setUnitOrder(unit, { type: 'move', target: offsetTarget });
      this.assignPath(unit, offsetTarget);
    });
  }

  commandSelectedAttack(targetId: string, lockedTarget = false): void {
    this.state.selectedUnitIds.forEach((id) => {
      const unit = this.state.units[id];
      if (!unit || this.isPacifistWorker(unit)) return;
      unit.order = { type: 'attack', targetId, lockedTarget };
    });
  }

  commandSelectedGather(world: RtsVector): boolean {
    const tile = this.getTileAtWorld(world);
    if (!tile) return false;
    const gatherResource = this.getGatherResourceForTile(tile);
    if (!gatherResource || !this.tileHasGatherable(tile, gatherResource)) return false;

    let assigned = false;
    this.state.selectedUnitIds.forEach((id) => {
      const unit = this.state.units[id];
      if (!unit || !this.isGatherer(unit)) return;
      if (!this.canUnitGatherTile(unit, tile, gatherResource)) return;
      const reserved = this.reserveGatherTile(tile, unit.id);
      if (!reserved) return;
      const assignedTarget = reserved.standPoint;
      assigned = true;
      this.setUnitOrder(unit, {
        type: 'gather',
        target: assignedTarget,
        targetTile: { x: tile.x, y: tile.y },
        resource: gatherResource,
      });
      this.assignPath(unit, assignedTarget);
    });
    return assigned;
  }

  commandSelectedBuild(targetId: string): boolean {
    const building = this.state.buildings[targetId];
    if (!building || building.complete || building.factionId !== 'player') return false;
    let assigned = false;
    this.state.selectedUnitIds.forEach((id) => {
      const unit = this.state.units[id];
      if (!unit || !this.isBuilder(unit)) return;
      const assignedTarget = this.assignBuildSlot(unit, building);
      if (!assignedTarget) return;
      assigned = true;
      this.setUnitOrder(unit, {
        type: 'build',
        targetId: building.id,
        target: assignedTarget,
      });
      this.assignPath(unit, assignedTarget);
    });
    return assigned;
  }

  setBuildMode(type: BuildingType | null): void {
    this.state.buildMode = type;
  }

  placeBuilding(type: BuildingType, world: RtsVector): boolean {
    const tileX = Math.floor(world.x / TILE_SIZE);
    const tileY = Math.floor(world.y / TILE_SIZE);
    const stats = BUILDING_STATS[type];
    const faction = this.state.factions.player;
    const cost = BUILDING_COSTS[type];

    if (!this.canAfford(faction, cost)) {
      this.log(`资源不足，无法建造 ${type}。`);
      return false;
    }

    if (!this.canPlaceBuilding(tileX, tileY, stats.width, stats.height, type)) {
      this.log(`这里不能建造 ${type}。`);
      return false;
    }

    this.payCost(faction, cost);
    const building = this.createBuilding('player', type, tileX * TILE_SIZE, tileY * TILE_SIZE, false);
    this.state.buildings[building.id] = building;
    this.relocateUnitsOutsideBuilding(building);
    this.log(`已放置 ${type}。`);
    return true;
  }

  getRecruitCostText(role: UnitRole): string {
    const cost = UNIT_STATS[role].cost;
    const parts = RESOURCE_TYPES.filter((r) => (cost[r] ?? 0) > 0).map((r) => `${this.resourceShortName(r)}${cost[r]}`);
    return parts.length > 0 ? parts.join(' ') : '免费';
  }

  getPopulationStats(factionId: string): { used: number; cap: number } {
    const used = Object.values(this.state.units).filter((unit) => unit.factionId === factionId).length;
    let cap = 12;
    Object.values(this.state.buildings).forEach((building) => {
      if (building.factionId !== factionId || !building.complete) return;
      if (building.type === 'townHall') cap += 10;
      if (building.type === 'house') cap += 6;
      if (building.type === 'farm') cap += 2;
    });
    return { used, cap };
  }

  getBuildingCatalogEntry(type: BuildingType) {
    return BUILDING_CATALOG[type];
  }

  canAffordRecruit(role: UnitRole): boolean {
    const pop = this.getPopulationStats('player');
    if (pop.used >= pop.cap) return false;
    return this.canAfford(this.state.factions.player, UNIT_STATS[role].cost);
  }

  recruit(role: UnitRole): boolean {
    if (this.state.gameOutcome !== 'playing') return false;
    if (!this.factionHasSettlement('player')) {
      this.log('主城已被摧毁，无法招募单位。');
      return false;
    }

    const faction = this.state.factions.player;
    const stats = UNIT_STATS[role];
    const pop = this.getPopulationStats('player');
    if (pop.used >= pop.cap) {
      this.log(`人口已满（${pop.used}/${pop.cap}），请先建造民居。`);
      return false;
    }

    const needsStable = role === 'cavalry';
    const barracks = Object.values(this.state.buildings).find((building) => {
      if (!building.complete || building.factionId !== 'player') return false;
      if (needsStable) return building.type === 'stable' || building.type === 'barracks';
      return building.type === 'barracks' || building.type === 'townHall';
    });

    if (!barracks) {
      this.log(needsStable ? '需要马厩或兵营才能招募骑兵。' : '需要主城或兵营才能招募。');
      return false;
    }
    if (!this.canAfford(faction, stats.cost)) {
      this.log(`资源不足，无法招募 ${role}。`);
      return false;
    }

    this.payCost(faction, stats.cost);
    const hallTileX = Math.floor(barracks.x / TILE_SIZE);
    const hallTileY = Math.floor(barracks.y / TILE_SIZE);
    const slot = Object.keys(this.state.units).length;
    const unit = this.spawnUnitSafe('player', role, hallTileX + 2, hallTileY + 2, slot);
    if (!unit) {
      RESOURCE_TYPES.forEach((resource) => {
        faction.resources[resource] += stats.cost[resource] ?? 0;
      });
      this.log('主城不可用，招募失败。');
      return false;
    }
    this.log(`已招募 ${role}。`);
    return true;
  }

  toggleCommanderControl(): void {
    this.state.activeCommanderId = this.state.activeCommanderId ? null : this.findPlayerCommander()?.id ?? null;
  }

  moveCommander(dx: number, dy: number, deltaTime: number): void {
    if (!this.state.activeCommanderId) return;
    const commander = this.state.units[this.state.activeCommanderId];
    if (!commander) return;
    this.moveUnitByVector(commander, dx, dy, deltaTime);
  }

  getUnitAt(world: RtsVector): Unit | null {
    return (
      Object.values(this.state.units).find(
        (unit) => world.x >= unit.x && world.x <= unit.x + unit.width && world.y >= unit.y && world.y <= unit.y + unit.height
      ) ?? null
    );
  }

  getBuildingAt(world: RtsVector): Building | null {
    return (
      Object.values(this.state.buildings).find(
        (building) =>
          world.x >= building.x &&
          world.x <= building.x + building.width &&
          world.y >= building.y &&
          world.y <= building.y + building.height
      ) ?? null
    );
  }

  getResourceAt(world: RtsVector): ResourceType | null {
    const tile = this.getTileAtWorld(world);
    return tile?.resource && (tile.resourceAmount ?? 0) > 0 ? tile.resource : null;
  }

  getTileInfoAt(world: RtsVector): Tile | null {
    return this.getTileAtWorld(world);
  }

  canPreviewBuilding(type: BuildingType, world: RtsVector): boolean {
    const stats = BUILDING_STATS[type];
    return this.canPlaceBuilding(Math.floor(world.x / TILE_SIZE), Math.floor(world.y / TILE_SIZE), stats.width, stats.height, type);
  }

  recycleBuildingAt(world: RtsVector): boolean {
    const building = this.getBuildingAt(world);
    if (!building || building.factionId !== 'player' || building.type === 'townHall') return false;

    const refund = BUILDING_COSTS[building.type];
    RESOURCE_TYPES.forEach((resource) => {
      this.state.factions.player.resources[resource] += Math.floor((refund[resource] ?? 0) / 2);
    });
    this.restoreTerrainForBuilding(building);
    delete this.state.buildings[building.id];
    this.log(`已回收 ${building.type}，返还一半材料。`);
    return true;
  }

  private createStateFromMapData(data: MapData): RtsGameState {
    const factions = this.createDefaultFactions();
    const mapWidth = data.mapWidth;
    const mapHeight = data.mapHeight;
    const tiles: Tile[] = [];

    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        tiles.push({ x, y, terrain: 'grass', fertility: 0.78 + Math.random() * 0.18 });
      }
    }

    data.tiles.forEach((entry) => {
      const tile = tiles[entry.y * mapWidth + entry.x];
      if (!tile) return;
      tile.terrain = entry.terrain;
      if (entry.fertility !== undefined) tile.fertility = entry.fertility;
      if (entry.resource) {
        tile.resource = entry.resource;
        tile.resourceAmount = entry.resourceAmount ?? 100;
        tile.maxResourceAmount = tile.resourceAmount;
      }
    });

    const state: RtsGameState = {
      mapWidth,
      mapHeight,
      tileSize: data.tileSize || TILE_SIZE,
      day: 1,
      timeOfDay: 0,
      factions,
      tiles,
      units: {},
      buildings: {},
      selectedUnitIds: [],
      activeCommanderId: null,
      buildMode: null,
      diplomacyLog: [{
        id: `map-load-${Date.now()}`,
        message: `已加载地图：${data.name}`,
        createdAt: Date.now(),
      }],
      combatEvents: [],
      truceRemaining: 0,
      gameOutcome: 'playing',
    };

    this.state = state;

    data.buildings.forEach((entry) => {
      this.editorPlaceBuilding(entry.factionId, entry.type, entry.tileX, entry.tileY, entry.complete ?? true);
    });

    data.units.forEach((entry, index) => {
      this.spawnUnitSafe(entry.factionId, entry.role, entry.tileX, entry.tileY, index);
    });

    if (data.playerStart) {
      this.playerBaseCenter = {
        x: data.playerStart.tileX * TILE_SIZE + TILE_SIZE * 1.5,
        y: data.playerStart.tileY * TILE_SIZE + TILE_SIZE * 1.5,
      };
    } else {
      const hall = Object.values(this.state.buildings).find((b) => b.factionId === 'player' && b.type === 'townHall');
      if (hall) this.playerBaseCenter = this.centerOf(hall);
    }

    if (!this.simulationPaused) {
      this.seedMissingFactionsOnCustomMap();
      this.captureNpcFactionsInPlay();
    } else if (Object.keys(this.state.units).length === 0 && Object.keys(this.state.buildings).length === 0) {
      this.log('自定义地图为空，请先在编辑器中放置内容。');
    }

    return state;
  }

  /** 自定义地图试玩：为编辑器未放置的阵营在远处自动生成据点 */
  private seedMissingFactionsOnCustomMap(): void {
    const npcFactions = ['north', 'village', 'miners', 'south', 'raiders'] as const;
    const missing = npcFactions.filter((id) => !this.factionHasSettlement(id));
    if (missing.length === 0) return;

    const centers = this.collectSettlementCenters();
    const minDist = Math.max(
      26,
      Math.min(58, Math.floor(Math.min(this.state.mapWidth, this.state.mapHeight) * 0.32))
    );
    const footprint = 12;
    let seeded = 0;

    missing.forEach((factionId) => {
      const hint = FACTION_START_HINTS[factionId];
      const preferred = this.uvToTile(hint.u, hint.v);
      const anchor = this.findFarSettlementAnchor(preferred, footprint, footprint, centers, minDist);
      if (!anchor) return;
      this.seedFactionOutpost(factionId, anchor.x, anchor.y);
      centers.push({
        x: anchor.x + Math.floor(footprint / 2),
        y: anchor.y + Math.floor(footprint / 2),
      });
      seeded++;
    });

    if (seeded > 0) {
      this.state.truceRemaining = TRUCE_DURATION_SECONDS;
      this.log(`已自动生成 ${seeded} 个远方势力（彼此相距约 ${minDist} 格以上），开局停战 5 分钟。`);
    } else if (missing.length > 0) {
      this.log('地图空间不足，部分势力未能生成，请扩大地图或清理障碍。');
    }
  }

  private factionHasSettlement(factionId: string): boolean {
    return Object.values(this.state.buildings).some(
      (building) =>
        building.factionId === factionId && (building.type === 'townHall' || building.type === 'market')
    );
  }

  private captureNpcFactionsInPlay(): void {
    this.npcFactionsInPlay.clear();
    NPC_FACTION_IDS.forEach((id) => {
      if (this.factionHasSettlement(id)) this.npcFactionsInPlay.add(id);
    });
  }

  private canFactionSpawnUnits(factionId: string): boolean {
    if (this.simulationPaused) return true;
    return this.factionHasSettlement(factionId);
  }

  private isHeadquartersType(type: BuildingType): boolean {
    return type === 'townHall' || type === 'market';
  }

  private onHeadquartersDestroyed(factionId: string, factionName: string): void {
    this.log(`${factionName} 的大本营已被摧毁，该势力无法再生成部队。`);

    if (factionId === 'player') {
      if (this.state.gameOutcome === 'playing') {
        this.state.gameOutcome = 'defeat';
        this.log('你的主城陷落，战役失败。');
      }
      return;
    }

    if (this.npcFactionsInPlay.has(factionId) && !this.factionHasSettlement(factionId)) {
      this.checkVictoryCondition();
    }
  }

  private checkVictoryCondition(): void {
    if (this.state.gameOutcome !== 'playing') return;
    if (this.npcFactionsInPlay.size === 0) return;

    const remaining = [...this.npcFactionsInPlay].filter((id) => this.factionHasSettlement(id));
    if (remaining.length > 0) return;

    this.state.gameOutcome = 'victory';
    this.log('所有敌方大本营均已陷落，战役胜利！');
  }

  getRemainingNpcHeadquarters(): string[] {
    return [...this.npcFactionsInPlay].filter((id) => this.factionHasSettlement(id));
  }

  private collectSettlementCenters(): Array<{ x: number; y: number }> {
    const centers: Array<{ x: number; y: number }> = [];
    const pushCenter = (x: number, y: number) => {
      if (centers.some((c) => this.tileDistance(c, { x, y }) < 4)) return;
      centers.push({ x, y });
    };

    const playerHall = Object.values(this.state.buildings).find(
      (b) => b.factionId === 'player' && b.type === 'townHall'
    );
    if (playerHall) {
      pushCenter(
        Math.floor(this.centerOf(playerHall).x / TILE_SIZE),
        Math.floor(this.centerOf(playerHall).y / TILE_SIZE)
      );
    } else if (this.playerBaseCenter.x > 0 || this.playerBaseCenter.y > 0) {
      pushCenter(
        Math.floor(this.playerBaseCenter.x / TILE_SIZE),
        Math.floor(this.playerBaseCenter.y / TILE_SIZE)
      );
    } else {
      pushCenter(Math.floor(this.state.mapWidth / 2), Math.floor(this.state.mapHeight / 2));
    }

    Object.values(this.state.buildings).forEach((building) => {
      if (building.type !== 'townHall' && building.type !== 'market') return;
      pushCenter(
        Math.floor(this.centerOf(building).x / TILE_SIZE),
        Math.floor(this.centerOf(building).y / TILE_SIZE)
      );
    });

    return centers;
  }

  private findFarSettlementAnchor(
    preferred: { x: number; y: number },
    footprintW: number,
    footprintH: number,
    avoidCenters: Array<{ x: number; y: number }>,
    minDist: number
  ): { x: number; y: number } | null {
    const tryMinDist = (dist: number) => {
      const candidates: Array<{ x: number; y: number; score: number }> = [];

      const consider = (tx: number, ty: number) => {
        const anchor = this.findSettlementAnchor(tx, ty, footprintW, footprintH);
        if (!anchor) return;
        const center = {
          x: anchor.x + Math.floor(footprintW / 2),
          y: anchor.y + Math.floor(footprintH / 2),
        };
        const score = Math.min(...avoidCenters.map((c) => this.tileDistance(center, c)));
        if (score >= dist) candidates.push({ x: anchor.x, y: anchor.y, score });
      };

      consider(preferred.x, preferred.y);
      const mw = this.state.mapWidth;
      const mh = this.state.mapHeight;
      const step = Math.max(3, Math.floor(Math.min(mw, mh) / 22));
      for (let y = 4; y < mh - footprintH - 4; y += step) {
        for (let x = 4; x < mw - footprintW - 4; x += step) {
          consider(x, y);
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      return candidates[0] ?? null;
    };

    return tryMinDist(minDist) ?? tryMinDist(minDist * 0.75) ?? tryMinDist(minDist * 0.55);
  }

  private tileDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private createDefaultFactions(): Record<string, Faction> {
    const factions: Record<string, Faction> = {
      player: this.createFaction('player', 'Freehold', '#50d9ff', 'player', {
        food: 180,
        wood: 220,
        stone: 120,
        iron: 65,
        gold: 120,
        population: 10,
      }),
      north: this.createFaction('north', 'Northwatch', '#8fd16a', 'ally', {
        food: 220,
        wood: 160,
        stone: 80,
        iron: 60,
        gold: 180,
        population: 18,
      }),
      raiders: this.createFaction('raiders', 'Red March', '#ff5261', 'enemy', {
        food: 160,
        wood: 160,
        stone: 90,
        iron: 110,
        gold: 90,
        population: 25,
      }),
      village: this.createFaction('village', 'Mill Village', '#ffd166', 'neutral', {
        food: 340,
        wood: 90,
        stone: 40,
        iron: 25,
        gold: 75,
        population: 20,
      }),
      miners: this.createFaction('miners', 'Stoneford', '#b7b3a1', 'neutral', {
        food: 140,
        wood: 80,
        stone: 320,
        iron: 160,
        gold: 110,
        population: 16,
      }),
      south: this.createFaction('south', 'South Banner', '#d98c5f', 'enemy', {
        food: 210,
        wood: 130,
        stone: 110,
        iron: 130,
        gold: 95,
        population: 22,
      }),
    };

    factions.player.relations = { north: 68, raiders: -100, village: 28, miners: 20, south: -75 };
    factions.north.relations = { player: 68, raiders: -70, village: 35, miners: 22, south: -45 };
    factions.raiders.relations = { player: -100, north: -70, village: -45, miners: -35, south: 15 };
    factions.village.relations = { player: 28, north: 35, raiders: -45, miners: 40, south: -20 };
    factions.miners.relations = { player: 20, north: 22, raiders: -35, village: 40, south: -35 };
    factions.south.relations = { player: -75, north: -45, raiders: 15, village: -20, miners: -35 };
    return factions;
  }

  private createInitialState(): RtsGameState {
    const factions = this.createDefaultFactions();
    const state: RtsGameState = {
      mapWidth: MAP_WIDTH,
      mapHeight: MAP_HEIGHT,
      tileSize: TILE_SIZE,
      day: 1,
      timeOfDay: 0,
      factions,
      tiles: this.generateTiles(),
      units: {},
      buildings: {},
      selectedUnitIds: [],
      activeCommanderId: null,
      buildMode: null,
      diplomacyLog: [],
      combatEvents: [],
      truceRemaining: TRUCE_DURATION_SECONDS,
      gameOutcome: 'playing',
    };

    this.state = state;
    this.seedSettlements();
    this.captureNpcFactionsInPlay();
    return state;
  }

  private createFaction(
    id: string,
    name: string,
    color: string,
    stance: Faction['stance'],
    resources: Record<ResourceType, number>
  ): Faction {
    return { id, name, color, stance, resources, relations: {} };
  }

  private generateTiles(): Tile[] {
    const tiles: Tile[] = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const u = x / MAP_WIDTH;
        const v = y / MAP_HEIGHT;
        const land = worldLandScore(u, v);
        let terrain: TerrainType = isWorldLand(u, v) ? 'grass' : 'water';

        if (terrain === 'grass') {
          const himalaya = Math.hypot(u - 0.62, v - 0.34) < 0.035;
          const rockies = Math.hypot(u - 0.2, v - 0.22) < 0.04;
          const alps = Math.hypot(u - 0.49, v - 0.27) < 0.022;
          const amazon = u > 0.2 && u < 0.3 && v > 0.55 && v < 0.72 && Math.sin(x * 0.35) > 0.2;
          const siberia = u > 0.58 && u < 0.78 && v < 0.28 && Math.sin(y * 0.2 + x * 0.08) > 0.35;
          if (himalaya || rockies || alps) terrain = 'mountain';
          else if (amazon || siberia || (Math.sin(x * 0.28 + y * 0.11) + Math.cos(y * 0.25) > 1.15 && land < 0.72)) {
            terrain = 'forest';
          }
        }

        const silkRoad = Math.abs(v - (0.34 + Math.sin(u * 9) * 0.04)) < 0.012 && u > 0.4 && u < 0.75;
        const mediterranean = Math.abs(u - 0.48) < 0.018 && v > 0.28 && v < 0.38;
        if ((silkRoad || mediterranean) && terrain === 'grass') terrain = 'road';
        if (silkRoad && terrain === 'water') terrain = 'bridge';

        const resource =
          terrain === 'forest' ? 'wood' : terrain === 'mountain' ? ((x + y) % 3 === 0 ? 'iron' : 'stone') : undefined;
        const amount = resource === 'wood' ? 120 : resource === 'iron' ? 220 : resource === 'stone' ? 190 : undefined;

        tiles.push({
          x,
          y,
          terrain,
          fertility: terrain === 'grass' ? 0.72 + Math.random() * 0.28 : terrain === 'forest' ? 0.42 : 0.12,
          resource,
          resourceAmount: amount,
          maxResourceAmount: amount,
        });
      }
    }
    return tiles;
  }

  private isSpawnableTerrain(tile: Tile | null): boolean {
    if (!tile) return false;
    return tile.terrain === 'grass' || tile.terrain === 'road' || tile.terrain === 'field';
  }

  private isSettlementFootprintClear(tileX: number, tileY: number, width: number, height: number): boolean {
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const tile = this.getTile(tileX + dx, tileY + dy);
        if (!this.isSpawnableTerrain(tile)) return false;
      }
    }
    return true;
  }

  private findSettlementAnchor(preferredTileX: number, preferredTileY: number, footprintW: number, footprintH: number): { x: number; y: number } | null {
    const mapWidth = this.state.mapWidth;
    const mapHeight = this.state.mapHeight;
    const tryPoint = (tx: number, ty: number) => {
      if (tx < 2 || ty < 2 || tx + footprintW >= mapWidth - 2 || ty + footprintH >= mapHeight - 2) return null;
      if (!this.isSettlementFootprintClear(tx, ty, footprintW, footprintH)) return null;
      return { x: tx, y: ty };
    };

    const direct = tryPoint(preferredTileX, preferredTileY);
    if (direct) return direct;

    for (let radius = 1; radius <= 24; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const hit = tryPoint(preferredTileX + dx, preferredTileY + dy);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  private uvToTile(u: number, v: number): { x: number; y: number } {
    return {
      x: Math.floor(u * (this.state.mapWidth - 8)) + 4,
      y: Math.floor(v * (this.state.mapHeight - 8)) + 4,
    };
  }

  private placeInitialBuilding(factionId: string, type: BuildingType, tileX: number, tileY: number): Building | null {
    const stats = BUILDING_STATS[type];
    const anchor = this.findSettlementAnchor(tileX, tileY, stats.width + 1, stats.height + 1);
    if (!anchor) return null;
    const building = this.createBuilding(factionId, type, anchor.x * TILE_SIZE, anchor.y * TILE_SIZE);
    this.state.buildings[building.id] = building;
    return building;
  }

  private findUnitSpawnNear(tileX: number, tileY: number, slot: number): RtsVector {
    const ring = [
      { dx: 0, dy: 0 },
      { dx: 2, dy: 0 },
      { dx: -2, dy: 0 },
      { dx: 0, dy: 2 },
      { dx: 0, dy: -2 },
      { dx: 2, dy: 2 },
      { dx: -2, dy: 2 },
      { dx: 2, dy: -2 },
      { dx: -2, dy: -2 },
      { dx: 4, dy: 0 },
      { dx: -4, dy: 0 },
      { dx: 0, dy: 4 },
      { dx: 0, dy: -4 },
    ];
    const pick = ring[slot % ring.length];
    const baseX = tileX + pick.dx;
    const baseY = tileY + pick.dy;

    for (let radius = 0; radius <= 14; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const tx = baseX + dx;
          const ty = baseY + dy;
          const tile = this.getTile(tx, ty);
          if (!this.isSpawnableTerrain(tile)) continue;
          const x = tx * TILE_SIZE + 4;
          const y = ty * TILE_SIZE + 4;
          if (this.isWorldPointBlockedForSpawn(x, y)) continue;
          return { x, y };
        }
      }
    }

    return { x: tileX * TILE_SIZE + 8, y: tileY * TILE_SIZE + 8 };
  }

  private isWorldPointBlockedForSpawn(x: number, y: number): boolean {
    const center = { x: x + UNIT_SIZE / 2, y: y + UNIT_SIZE / 2 };
    const blockedByBuilding = Object.values(this.state.buildings).some((building) => {
      return (
        center.x > building.x &&
        center.x < building.x + building.width &&
        center.y > building.y &&
        center.y < building.y + building.height
      );
    });
    if (blockedByBuilding) return true;

    return Object.values(this.state.units).some((unit) => {
      return (
        x < unit.x + unit.width &&
        x + UNIT_SIZE > unit.x &&
        y < unit.y + unit.height &&
        y + UNIT_SIZE > unit.y
      );
    });
  }

  private spawnUnitSafe(factionId: string, role: UnitRole, nearTileX: number, nearTileY: number, slot: number): Unit | null {
    if (!this.canFactionSpawnUnits(factionId)) return null;
    const pos = this.findUnitSpawnNear(nearTileX, nearTileY, slot);
    const unit = this.createUnit(factionId, role, pos.x, pos.y);
    this.state.units[unit.id] = unit;
    return unit;
  }

  private seedSettlements(): void {
    const playerHint = this.uvToTile(FACTION_START_HINTS.player.u, FACTION_START_HINTS.player.v);
    const anchor = this.findSettlementAnchor(playerHint.x, playerHint.y, 12, 12) ?? playerHint;
    const px = anchor.x;
    const py = anchor.y;

    const playerHall = this.placeInitialBuilding('player', 'townHall', px, py);
    if (!playerHall) {
      this.log('地图生成异常：无法放置主城。');
      return;
    }

    this.playerBaseCenter = this.centerOf(playerHall);
    this.placeInitialWallRingAround(playerHall, 'player');
    this.placeInitialBuilding('player', 'warehouse', px + 5, py + 1);
    this.placeInitialBuilding('player', 'barracks', px, py - 5);
    this.placeInitialBuilding('player', 'house', px + 5, py - 3);
    this.placeInitialBuilding('player', 'farm', px - 5, py + 2);
    this.placeInitialBuilding('player', 'lumberCamp', px + 2, py + 5);
    this.placeInitialBuilding('player', 'tower', px - 4, py - 1);

    const starterRoles: UnitRole[] = [
      'commander',
      'worker',
      'engineer',
      'farmer',
      'woodcutter',
      'stonecutter',
      'miner',
      'swordsman',
      'spearman',
      'archer',
      'guard',
      'trader',
    ];
    starterRoles.forEach((role, index) => {
      this.spawnUnitSafe('player', role, px + 4, py + 4, index);
    });

    (Object.keys(FACTION_START_HINTS) as Array<keyof typeof FACTION_START_HINTS>)
      .filter((id) => id !== 'player')
      .forEach((factionId) => {
        const hint = FACTION_START_HINTS[factionId];
        const tile = this.uvToTile(hint.u, hint.v);
        this.seedFactionOutpost(factionId, tile.x, tile.y);
      });

    this.log('边境城邦建立于欧陆平原。开局停战 5 分钟，各阵营已修筑城墙。');
  }

  private placeInitialWallRingAround(hall: Building, factionId: string): void {
    const hallTileX = Math.floor(hall.x / TILE_SIZE);
    const hallTileY = Math.floor(hall.y / TILE_SIZE);
    const hallW = Math.ceil(hall.width / TILE_SIZE);
    const hallH = Math.ceil(hall.height / TILE_SIZE);
    const topY = hallTileY - 1;
    const bottomY = hallTileY + hallH;
    const leftX = hallTileX - 1;
    const rightX = hallTileX + hallW;
    const gateKeys = new Set([
      `${hallTileX + Math.floor(hallW / 2)},${topY}`,
      `${hallTileX + Math.floor(hallW / 2)},${bottomY}`,
      `${leftX},${hallTileY + Math.floor(hallH / 2)}`,
      `${rightX},${hallTileY + Math.floor(hallH / 2)}`,
    ]);

    const placements: Array<{ x: number; y: number; type: 'wall' | 'gate' }> = [];
    for (let x = leftX; x <= rightX; x++) {
      placements.push({ x, y: topY, type: gateKeys.has(`${x},${topY}`) ? 'gate' : 'wall' });
      placements.push({ x, y: bottomY, type: gateKeys.has(`${x},${bottomY}`) ? 'gate' : 'wall' });
    }
    for (let y = hallTileY; y < hallTileY + hallH; y++) {
      placements.push({ x: leftX, y, type: gateKeys.has(`${leftX},${y}`) ? 'gate' : 'wall' });
      placements.push({ x: rightX, y, type: gateKeys.has(`${rightX},${y}`) ? 'gate' : 'wall' });
    }

    placements.forEach((slot) => {
      if (!this.canPlaceBuilding(slot.x, slot.y, 1, 1, slot.type)) return;
      const building = this.createBuilding(factionId, slot.type, slot.x * TILE_SIZE, slot.y * TILE_SIZE);
      this.state.buildings[building.id] = building;
    });
  }

  private isTruceActive(): boolean {
    return this.state.truceRemaining > 0;
  }

  private isNpcFaction(factionId: string): boolean {
    return factionId !== 'player';
  }

  private isNpcPeaceBlocked(attackerFactionId: string, defenderFactionId: string): boolean {
    if (!this.isTruceActive()) return false;
    return this.isNpcFaction(attackerFactionId) && this.isNpcFaction(defenderFactionId);
  }

  private getFactionCorePoint(factionId: string): RtsVector | null {
    const core = Object.values(this.state.buildings).find(
      (building) => building.factionId === factionId && (building.type === 'townHall' || building.type === 'market')
    );
    return core ? this.centerOf(core) : null;
  }

  private seedFactionOutpost(factionId: string, tileX: number, tileY: number): void {
    const hallType: BuildingType = factionId === 'village' ? 'market' : 'townHall';
    const hall = this.placeInitialBuilding(factionId, hallType, tileX, tileY);
    if (!hall) return;
    this.placeInitialWallRingAround(hall, factionId);

    const extras: BuildingType[] =
      factionId === 'raiders' || factionId === 'south'
        ? ['barracks', 'tower', 'house']
        : factionId === 'miners'
          ? ['warehouse', 'smithy', 'house']
          : ['house', 'warehouse', 'lumberCamp'];
    extras.forEach((type, index) => {
      this.placeInitialBuilding(factionId, type, tileX + 4 + index * 2, tileY + 3);
    });

    const roles: UnitRole[] =
      factionId === 'raiders' || factionId === 'south'
        ? ['swordsman', 'spearman', 'archer', 'cavalry', 'guard', 'guard', 'archer']
        : factionId === 'miners'
          ? ['guard', 'spearman', 'worker', 'engineer', 'stonecutter', 'miner']
          : ['guard', 'archer', 'trader', 'spearman', 'farmer', 'woodcutter'];
    roles.forEach((role, index) => {
      const unit = this.spawnUnitSafe(factionId, role, tileX + 3, tileY + 5, index);
      if (!unit) return;
      const corePoint = this.centerOf(hall);
      unit.order = { type: 'defend', target: corePoint };
    });
  }

  private createUnit(factionId: string, role: UnitRole, x: number, y: number): Unit {
    const stats = UNIT_STATS[role];
    return {
      id: this.id('unit'),
      factionId,
      role,
      name: role,
      x,
      y,
      width: UNIT_SIZE,
      height: UNIT_SIZE,
      health: stats.maxHealth,
      maxHealth: stats.maxHealth,
      damage: stats.damage,
      range: stats.range,
      speed: stats.speed,
      morale: 80,
      carryingAmount: 0,
      order: { type: 'idle' },
      selected: false,
      direction: 'down',
      attackCooldown: 0,
    };
  }

  private createBuilding(factionId: string, type: BuildingType, x: number, y: number, complete = true): Building {
    const stats = BUILDING_STATS[type];
    const footprintTerrain: TerrainType[] = [];
    for (let yy = 0; yy < stats.height; yy++) {
      for (let xx = 0; xx < stats.width; xx++) {
        footprintTerrain.push(this.getTile(Math.floor(x / TILE_SIZE) + xx, Math.floor(y / TILE_SIZE) + yy)?.terrain ?? 'grass');
      }
    }
    const building = {
      id: this.id('building'),
      factionId,
      type,
      x,
      y,
      width: stats.width * TILE_SIZE,
      height: stats.height * TILE_SIZE,
      health: complete ? stats.maxHealth : Math.max(30, stats.maxHealth * 0.25),
      maxHealth: stats.maxHealth,
      complete,
      progress: complete ? 1 : 0,
      footprintTerrain,
    };
    if (complete) this.paintTerrainForBuilding(building);
    return building;
  }

  private updateUnit(unit: Unit, deltaTime: number): void {
    unit.attackCooldown = Math.max(0, unit.attackCooldown - deltaTime);
    if (unit.factionId !== 'player') {
      this.updateAiUnit(unit, deltaTime);
    } else {
      this.updatePlayerAutoDefense(unit);
    }

    if (unit.order.type === 'move' && unit.order.target) {
      this.moveAlongPath(unit, deltaTime, 4);
    } else if (unit.order.type === 'attack') {
      this.updateAttackOrder(unit, deltaTime);
    } else if (unit.order.type === 'build') {
      this.updateBuildOrder(unit, deltaTime);
    } else if (unit.order.type === 'defend') {
      this.updateDefendOrder(unit, deltaTime);
    } else if (unit.order.type === 'gather') {
      this.updateGatherOrder(unit, deltaTime);
    }
  }

  private updateAiUnit(unit: Unit, deltaTime: number): void {
    if (this.isTruceActive() && this.isNpcFaction(unit.factionId)) {
      if (unit.order.type === 'attack') {
        const corePoint = this.getFactionCorePoint(unit.factionId);
        if (corePoint) unit.order = { type: 'defend', target: corePoint };
        else unit.order = { type: 'idle' };
      }
      return;
    }

    const thinkLeft = (this.aiThinkTimers.get(unit.id) ?? 0) - deltaTime;
    if (thinkLeft > 0) {
      this.aiThinkTimers.set(unit.id, thinkLeft);
      return;
    }
    this.aiThinkTimers.set(unit.id, AI_THINK_INTERVAL + Math.random() * 0.12);

    if (unit.health < unit.maxHealth * 0.35) {
      const core = this.findNearestBuilding(unit, (building) => building.factionId === unit.factionId && building.type === 'townHall');
      if (core) {
        const corePoint = this.centerOf(core);
        this.setUnitOrder(unit, { type: 'move', target: corePoint });
        this.assignPath(unit, corePoint);
        return;
      }
    }

    const enemies = this.getEnemyFactionIds(unit.factionId);
    const nearbyHostile = this.findNearestEnemyUnit(unit, enemies, AUTO_AGGRO_RANGE + unit.range + 80);
    if (nearbyHostile && this.distance(unit, nearbyHostile) <= AUTO_AGGRO_RANGE + unit.range) {
      unit.order = { type: 'attack', targetId: nearbyHostile.id };
      return;
    }

    if (unit.factionId === 'raiders') {
      const target =
        this.findNearestEnemyUnit(unit, enemies, 520) ?? this.findNearestEnemyBuilding(unit, enemies);
      if (target) unit.order = { type: 'attack', targetId: target.id };
    }
  }

  private updatePlayerAutoDefense(unit: Unit): void {
    if (this.isPacifistWorker(unit)) {
      const enemies = this.getEnemyFactionIds(unit.factionId);
      const threat = this.findNearestEnemyUnit(unit, enemies, WORKER_FLEE_RANGE);
      if (threat && this.distance(unit, threat) <= WORKER_FLEE_RANGE) {
        this.fleeFromNearestEnemy(unit);
      } else if (unit.order.type === 'attack') {
        this.setUnitOrder(unit, { type: 'idle' });
      }
      return;
    }

    if (this.isGatherer(unit) && unit.order.type === 'gather') return;
    if (unit.order.type === 'move' || unit.order.type === 'attack') return;

    const enemies = this.getEnemyFactionIds(unit.factionId);
    const nearbyHostile = this.findNearestEnemyUnit(unit, enemies, AUTO_AGGRO_RANGE + unit.range + 60);
    if (nearbyHostile && this.distance(unit, nearbyHostile) <= AUTO_AGGRO_RANGE + unit.range) {
      unit.order = { type: 'attack', targetId: nearbyHostile.id };
    }
  }

  private isPacifistWorker(unit: Unit): boolean {
    return unit.role === 'worker';
  }

  private fleeFromNearestEnemy(unit: Unit): void {
    const enemies = this.getEnemyFactionIds(unit.factionId);
    const threat = this.findNearestEnemyUnit(unit, enemies, WORKER_FLEE_RANGE + 120);
    if (!threat) {
      if (unit.order.type === 'attack') this.setUnitOrder(unit, { type: 'idle' });
      return;
    }

    const center = this.centerOf(unit);
    const threatCenter = this.centerOf(threat);
    let dx = center.x - threatCenter.x;
    let dy = center.y - threatCenter.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const target = {
      x: this.clamp(center.x + dx * WORKER_FLEE_DISTANCE, unit.width / 2, MAP_WIDTH * TILE_SIZE - unit.width / 2),
      y: this.clamp(center.y + dy * WORKER_FLEE_DISTANCE, unit.height / 2, MAP_HEIGHT * TILE_SIZE - unit.height / 2),
    };

    if (unit.order.type !== 'move' || !unit.order.target || this.pointDistance(unit.order.target, target) > 48) {
      this.setUnitOrder(unit, { type: 'move', target });
      this.assignPath(unit, target);
    }
  }

  private getEnemyFactionIds(factionId: string): string[] {
    return Object.values(this.state.factions)
      .filter((faction) => faction.id !== factionId && (this.state.factions[factionId].relations[faction.id] ?? 0) < -20)
      .map((faction) => faction.id);
  }

  private updateAttackOrder(unit: Unit, deltaTime: number): void {
    if (this.isPacifistWorker(unit)) {
      this.fleeFromNearestEnemy(unit);
      return;
    }

    const target = unit.order.targetId ? this.state.units[unit.order.targetId] ?? this.state.buildings[unit.order.targetId] : null;
    if (target && 'factionId' in target && this.isNpcPeaceBlocked(unit.factionId, target.factionId)) {
      const corePoint = this.getFactionCorePoint(unit.factionId);
      unit.order = corePoint ? { type: 'defend', target: corePoint } : { type: 'idle' };
      return;
    }

    const retargetLeft = (this.attackRetargetTimers.get(unit.id) ?? 0) - deltaTime;
    if (retargetLeft <= 0) {
      this.attackRetargetTimers.set(unit.id, 0.28);
      this.retargetNearbyEnemyUnit(unit);
    } else {
      this.attackRetargetTimers.set(unit.id, retargetLeft);
    }
    const attackTarget = unit.order.targetId ? this.state.units[unit.order.targetId] ?? this.state.buildings[unit.order.targetId] : null;
    if (!attackTarget) {
      unit.order = { type: 'idle' };
      return;
    }

    const distance = this.distance(unit, attackTarget);
    if (distance > unit.range) {
      const targetPoint = this.centerOf(attackTarget);
      this.ensurePath(unit, targetPoint);
      this.moveAlongPath(unit, deltaTime, Math.max(12, unit.range * 0.75));
      return;
    }

    if (unit.attackCooldown <= 0) {
      attackTarget.health -= unit.damage;
      if ('role' in attackTarget) {
        this.forceCounterAttack(attackTarget, unit);
      }
      unit.attackCooldown = unit.role === 'archer' ? 1.35 : unit.role === 'cavalry' ? 1.05 : 0.85;
      this.faceTarget(unit, this.centerOf(attackTarget));
      this.addCombatEvent(unit.role === 'archer' ? 'arrow' : 'melee', this.centerOf(unit), this.centerOf(attackTarget));
    }
  }

  private retargetNearbyEnemyUnit(unit: Unit): void {
    if (unit.order.lockedTarget && unit.order.targetId && this.state.buildings[unit.order.targetId]) return;
    if (this.isTruceActive() && this.isNpcFaction(unit.factionId)) return;

    const enemies = this.getEnemyFactionIds(unit.factionId);
    const nearest = this.findNearestEnemyUnit(unit, enemies, unit.range + 120);
    if (!nearest) return;

    const currentTarget = unit.order.targetId ? this.state.units[unit.order.targetId] ?? this.state.buildings[unit.order.targetId] : null;
    const nearestDistance = this.distance(unit, nearest);
    const shouldCounter =
      nearestDistance <= Math.max(unit.range + 28, 72) ||
      (currentTarget ? nearestDistance + 24 < this.distance(unit, currentTarget) : nearestDistance <= AUTO_AGGRO_RANGE);

    if (!shouldCounter) return;

    unit.order.targetId = nearest.id;
    unit.order.lockedTarget = false;
    unit.order.path = undefined;
    unit.order.pathTarget = undefined;
  }

  private forceCounterAttack(defender: Unit, attacker: Unit): void {
    if (defender.factionId === attacker.factionId) return;
    if (this.isNpcPeaceBlocked(attacker.factionId, defender.factionId)) return;
    if (this.isPacifistWorker(defender)) return;
    if (defender.order.lockedTarget && defender.order.targetId && this.state.buildings[defender.order.targetId]) return;
    defender.order = { type: 'attack', targetId: attacker.id, lockedTarget: false };
    defender.order.path = undefined;
    defender.order.pathTarget = undefined;
    this.rallyNearbyAllies(defender, attacker);
  }

  /** 友军待机/驻守时，队友受击则协同反击（无需自身被攻击）。 */
  private rallyNearbyAllies(defender: Unit, attacker: Unit): void {
    if (this.isNpcPeaceBlocked(attacker.factionId, defender.factionId)) return;
    const defenderCenter = this.centerOf(defender);
    this.queryUnitsNear(defenderCenter, ALLY_COUNTER_ATTACK_RANGE, (ally) => {
      if (ally.id === defender.id || ally.id === attacker.id) return false;
      if (ally.factionId !== defender.factionId) return false;
      if (this.isPacifistWorker(ally)) return false;
      if (!['idle', 'defend'].includes(ally.order.type)) return false;
      if (ally.order.lockedTarget && ally.order.targetId && this.state.buildings[ally.order.targetId]) return false;
      return true;
    }).forEach((ally) => {
      if (this.isPacifistWorker(ally)) return;
      ally.order = { type: 'attack', targetId: attacker.id, lockedTarget: false };
      ally.order.path = undefined;
      ally.order.pathTarget = undefined;
    });
  }

  private updateDefendOrder(unit: Unit, deltaTime: number): void {
    if (!this.isTruceActive()) {
      const hostile = this.findNearestEnemyUnit(unit, ['raiders'], 260);
      if (hostile && this.distance(unit, hostile) < 230) {
        unit.order = { type: 'attack', targetId: hostile.id };
        return;
      }
    }
    if (unit.order.target) {
      this.ensurePath(unit, unit.order.target);
      this.moveAlongPath(unit, deltaTime, 10);
    }
  }

  private updateGatherOrder(unit: Unit, deltaTime: number): void {
    if (!unit.order.target || !unit.order.resource || !unit.order.targetTile) return;
    const nearStorage = this.findNearestStorage(unit.factionId, unit);

    if (unit.carryingAmount >= 12 && nearStorage) {
      this.releaseGatherTile(unit.id);
      const storagePoint = unit.order.returning && unit.order.target ? unit.order.target : this.getDepositStandPoint(nearStorage, unit);
      if (!unit.order.returning) {
        unit.order.returning = true;
        unit.order.target = storagePoint;
      }
      this.ensurePath(unit, storagePoint);
      if (this.moveAlongPath(unit, deltaTime, 12)) {
        const deliveredResource = unit.carrying ?? unit.order.resource;
        const deliveredAmount = unit.carryingAmount;
        this.state.factions[unit.factionId].resources[deliveredResource] += deliveredAmount;
        this.addCombatEvent('deposit', this.centerOf(unit), this.centerOf(nearStorage), deliveredResource, deliveredAmount);
        unit.carryingAmount = 0;
        unit.carrying = undefined;
        unit.order.returning = false;
        const nextTile = this.getTile(unit.order.targetTile.x, unit.order.targetTile.y);
        if (nextTile && this.tileHasGatherable(nextTile, unit.order.resource)) {
          const reserved = this.reserveGatherTile(nextTile, unit.id);
          if (reserved) {
            unit.order.target = reserved.standPoint;
            unit.order.path = undefined;
            unit.order.pathTarget = undefined;
          }
        } else {
          this.setUnitOrder(unit, { type: 'idle' });
        }
      }
      return;
    }

    unit.order.returning = false;
    this.ensurePath(unit, unit.order.target);
    const atSite = this.moveAlongPath(unit, deltaTime, 14) || this.pointDistance(this.centerOf(unit), unit.order.target) <= 18;
    if (!atSite) return;

    const tile = this.getTile(unit.order.targetTile.x, unit.order.targetTile.y);
    if (!tile || !this.tileHasGatherable(tile, unit.order.resource)) {
      this.setUnitOrder(unit, { type: 'idle' });
      return;
    }

    let gathered = 0;
    if (unit.order.resource === 'food' && tile.terrain === 'field') {
      gathered = Math.min(4 * deltaTime, Math.max(0, tile.fertility * 24));
      tile.fertility = Math.max(0, tile.fertility - gathered / 24);
    } else {
      gathered = Math.min(5 * deltaTime, tile.resourceAmount ?? 0);
      tile.resourceAmount = Math.max(0, (tile.resourceAmount ?? 0) - gathered);
    }

    unit.carrying = unit.order.resource;
    unit.carryingAmount += gathered;
    if (gathered > 0.2 && Math.floor((unit.carryingAmount - gathered) * 2) !== Math.floor(unit.carryingAmount * 2)) {
      this.addCombatEvent('gather', this.centerOf(unit), this.tileCenter(tile), unit.order.resource, gathered);
    }

    if (unit.order.resource === 'food' && tile.terrain === 'field' && tile.fertility <= 0.05) {
      this.depleteFieldTile(tile);
    } else if ((tile.resourceAmount ?? 0) <= 0 && tile.resource === unit.order.resource) {
      this.depleteResourceTile(tile);
    }
  }

  private updateBuildOrder(unit: Unit, deltaTime: number): void {
    const building = unit.order.targetId ? this.state.buildings[unit.order.targetId] : null;
    if (!building || building.complete) {
      if (building?.complete) this.relocateUnitOutsideBuilding(unit, building);
      this.setUnitOrder(unit, { type: 'idle' });
      return;
    }

    if (this.isUnitCenterInsideBuilding(unit, building, true)) {
      const exit = unit.order.target ?? this.getExteriorSpawnPoint(unit, building);
      this.ensurePath(unit, exit);
      this.moveAlongPath(unit, deltaTime, 10);
      return;
    }

    const site = unit.order.target ?? this.getBuildingStandPoint(building);
    const distToSite = this.pointDistance(this.centerOf(unit), site);
    const distToEdge = this.distanceToBuildingEdge(unit, building);
    const inWorkRange = distToEdge <= BUILD_WORK_RANGE || distToSite <= 22;

    if (!inWorkRange) {
      this.ensurePath(unit, site);
      this.moveAlongPath(unit, deltaTime, 10);
      return;
    }

    const workRate = unit.role === 'engineer' ? BUILD_WORK_PER_SECOND * 1.7 : BUILD_WORK_PER_SECOND;
    const progressGain = (workRate * deltaTime) / building.maxHealth;
    building.progress = Math.min(1, building.progress + progressGain);
    building.health = Math.min(building.maxHealth, Math.max(building.health, building.maxHealth * building.progress));

    if (Math.floor((building.progress - progressGain) * 10) !== Math.floor(building.progress * 10)) {
      this.addCombatEvent('build', this.centerOf(unit), this.centerOf(building));
    }

    if (building.progress >= 1) {
      building.complete = true;
      building.health = building.maxHealth;
      this.paintTerrainForBuilding(building);
      this.relocateUnitsOutsideBuilding(building);
      this.addCombatEvent('deposit', this.centerOf(building), this.centerOf(building), undefined, 1);
      this.setUnitOrder(unit, { type: 'idle' });
    }
  }

  private tickEconomy(): void {
    const faction = this.state.factions.player;
    Object.values(this.state.buildings).forEach((building) => {
      if (building.factionId !== 'player') return;
      if (!building.complete) return;
      if (building.type === 'farm') faction.resources.food += 4;
      if (building.type === 'market') faction.resources.gold += 2;
      if (building.type === 'lumberCamp') faction.resources.wood += 2;
      if (building.type === 'smithy') faction.resources.iron += 1;
    });

    if (this.unitCount > 80) return;

    const idleBuilders = this.unitListCache.filter(
      (unit) => unit.factionId === 'player' && this.isBuilder(unit) && unit.order.type === 'idle'
    );
    idleBuilders.slice(0, 3).forEach((unit) => {
      const blueprint = this.findNearestBlueprint(unit);
      if (!blueprint) return;
      const target = this.assignBuildSlot(unit, blueprint);
      if (!target) return;
      this.setUnitOrder(unit, { type: 'build', targetId: blueprint.id, target });
      this.assignPath(unit, target);
    });

    const idleGatherers = this.unitListCache.filter(
      (unit) => unit.factionId === 'player' && this.isGatherer(unit) && unit.order.type === 'idle'
    );
    if (!idleGatherers.length) return;

    let assigned = 0;
    for (let i = 0; i < idleGatherers.length && assigned < ECONOMY_GATHER_ASSIGN_PER_TICK; i++) {
      const index = (this.economyGatherCursor + i) % idleGatherers.length;
      const unit = idleGatherers[index];
      const resource = this.getGatherResourceForUnit(unit);
      const tile = this.findNearestResourceTile(unit, resource);
      if (!tile) continue;
      const reserved = this.reserveGatherTile(tile, unit.id);
      if (!reserved) continue;
      this.setUnitOrder(unit, {
        type: 'gather',
        target: reserved.standPoint,
        targetTile: { x: tile.x, y: tile.y },
        resource,
      });
      this.assignPath(unit, reserved.standPoint);
      assigned += 1;
    }
    this.economyGatherCursor = (this.economyGatherCursor + assigned) % Math.max(1, idleGatherers.length);
  }

  private isGatherer(unit: Unit): boolean {
    return ['woodcutter', 'stonecutter', 'miner', 'farmer'].includes(unit.role);
  }

  private isBuilder(unit: Unit): boolean {
    return ['worker', 'engineer'].includes(unit.role);
  }

  private getGatherResourceForUnit(unit: Unit): ResourceType {
    if (unit.role === 'farmer') return 'food';
    if (unit.role === 'woodcutter') return 'wood';
    if (unit.role === 'stonecutter') return 'stone';
    if (unit.role === 'miner') return 'iron';
    return 'wood';
  }

  private canUnitGatherTile(unit: Unit, tile: Tile, resource: ResourceType): boolean {
    if (unit.role === 'farmer') return resource === 'food';
    if (unit.role === 'woodcutter') return resource === 'wood';
    if (unit.role === 'stonecutter') return resource === 'stone';
    if (unit.role === 'miner') return resource === 'iron';
    return false;
  }

  private getGatherResourceForTile(tile: Tile): ResourceType | null {
    if (tile.terrain === 'field' && tile.fertility > 0.08) return 'food';
    return tile.resource ?? null;
  }

  private tileHasGatherable(tile: Tile, resource: ResourceType): boolean {
    if (resource === 'food' && tile.terrain === 'field') return tile.fertility > 0.08;
    return tile.resource === resource && (tile.resourceAmount ?? 0) > 0;
  }

  private getMostNeededGatherResource(): ResourceType {
    const resources = this.state.factions.player.resources;
    if (resources.wood < 180) return 'wood';
    if (resources.stone < 130) return 'stone';
    if (resources.iron < 90) return 'iron';
    return 'wood';
  }

  private tickTowers(): void {
    if (this.isTruceActive()) return;
    Object.values(this.state.buildings).forEach((building) => {
      if (building.type !== 'tower') return;
      if (!building.complete) return;
      const target = this.findNearestEnemyUnit(building, ['raiders'], 220);
      if (target && this.distance(building, target) < 210) {
        target.health -= 14;
      }
    });
  }

  private tickResourceRegrowth(): void {
    const now = Date.now();
    this.state.tiles.forEach((tile) => {
      if (tile.resourceRegenAt && now >= tile.resourceRegenAt) {
        tile.terrain = tile.depletedTerrain ?? 'forest';
        tile.resource = tile.depletedResource ?? 'wood';
        tile.resourceAmount = tile.maxResourceAmount ?? (tile.resource === 'wood' ? 90 : tile.resource === 'iron' ? 180 : 160);
        tile.resourceRegenAt = undefined;
        tile.depletedTerrain = undefined;
        tile.depletedResource = undefined;
      }
    });
  }

  private depleteResourceTile(tile: Tile): void {
    const depletedResource = tile.resource;
    const depletedTerrain = tile.terrain;
    if (!depletedResource) return;

    tile.resource = undefined;
    tile.resourceAmount = 0;
    tile.depletedResource = depletedResource;
    tile.depletedTerrain = depletedTerrain;

    if (depletedResource === 'wood') {
      tile.terrain = 'grass';
      tile.resourceRegenAt = Date.now() + FOREST_REGEN_SECONDS * 1000;
      return;
    }

    if (depletedResource === 'stone' || depletedResource === 'iron') {
      tile.terrain = 'grass';
      tile.resourceRegenAt = Date.now() + QUARRY_REGEN_SECONDS * 1000;
    }
  }

  private tickCityHealing(): void {
    if (this.unitCount > 75) return;
    this.unitListCache.forEach((unit) => {
      if (unit.health >= unit.maxHealth) return;
      const core = this.findNearestBuilding(unit, (building) => building.factionId === unit.factionId && building.type === 'townHall');
      if (core && this.distance(unit, core) <= CITY_HEAL_RADIUS) {
        unit.health = Math.min(unit.maxHealth, unit.health + CITY_HEAL_PER_SECOND);
      }
    });
  }

  private spawnRaid(): void {
    if (!this.canFactionSpawnUnits('raiders')) return;

    const hq = Object.values(this.state.buildings).find(
      (building) => building.factionId === 'raiders' && building.type === 'townHall'
    );
    if (!hq) return;

    const spawnTileX = Math.floor(hq.x / TILE_SIZE) + 3;
    const spawnTileY = Math.floor(hq.y / TILE_SIZE) + 3;
    const count = Math.min(2 + Math.floor(this.state.day / 3), this.unitCount > 90 ? 4 : 7);
    const roles: UnitRole[] = ['swordsman', 'spearman', 'archer', 'cavalry'];
    let spawned = 0;

    for (let i = 0; i < count; i++) {
      const unit = this.spawnUnitSafe('raiders', roles[i % roles.length], spawnTileX + i, spawnTileY, i);
      if (!unit) break;
      spawned++;
      const target = this.findPlayerCore();
      if (target) unit.order = { type: 'attack', targetId: target.id };
    }

    if (spawned > 0) {
      this.log(`赤潮军阀从大本营派出 ${spawned} 名袭击者。`);
    }
  }

  private removeDeadEntities(): void {
    Object.entries(this.state.units).forEach(([id, unit]) => {
      if (unit.health <= 0) {
        if (this.state.activeCommanderId === id) {
          this.state.activeCommanderId = null;
          this.log('将领倒下了，但城邦仍在继续作战。');
        }
        this.releaseBuildSlot(id);
        this.releaseGatherTile(id);
        delete this.state.units[id];
      }
    });
    Object.entries(this.state.buildings).forEach(([id, building]) => {
      if (building.health <= 0) {
        const wasHeadquarters = this.isHeadquartersType(building.type);
        const factionId = building.factionId;
        const factionName = this.state.factions[factionId]?.name ?? factionId;
        const label = this.getBuildingLabel(building.type);
        this.restoreTerrainForBuilding(building);
        delete this.state.buildings[id];
        if (wasHeadquarters) {
          this.onHeadquartersDestroyed(factionId, factionName);
        } else {
          this.log(`${label} 被摧毁了。`);
        }
      }
    });
  }

  private moveToward(unit: Unit, target: RtsVector, deltaTime: number, stopDistance: number): boolean {
    const center = this.centerOf(unit);
    const dx = target.x - center.x;
    const dy = target.y - center.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= stopDistance) return true;
    return this.moveUnitByVector(unit, dx, dy, deltaTime);
  }

  private ensurePath(unit: Unit, target: RtsVector): void {
    const previous = unit.order.pathTarget;
    if (
      unit.order.path &&
      previous &&
      Math.abs(previous.x - target.x) < TILE_SIZE &&
      Math.abs(previous.y - target.y) < TILE_SIZE
    ) {
      return;
    }

    this.assignPath(unit, target);
  }

  private moveAlongPath(unit: Unit, deltaTime: number, stopDistance: number): boolean {
    const target = unit.order.target;
    if (!target) return true;

    if (!unit.order.path || unit.order.path.length === 0) {
      this.assignPath(unit, target);
    }

    const nextPoint = unit.order.path?.[0] ?? target;
    if (this.pointDistance(this.centerOf(unit), target) <= stopDistance) {
      unit.order.path = [];
      return true;
    }

    if (this.pointDistance(this.centerOf(unit), nextPoint) <= Math.max(8, stopDistance * 0.5)) {
      unit.order.path?.shift();
    }

    const currentTarget = unit.order.path?.[0] ?? target;
    const moved = this.moveToward(unit, currentTarget, deltaTime, 4);
    if (moved) {
      this.stuckUnits.delete(unit.id);
      return false;
    }

    if (this.tryUnstickUnit(unit, currentTarget, target, deltaTime)) {
      return false;
    }

    if (unit.order.path && unit.order.path.length > 1) {
      unit.order.path.shift();
    } else {
      this.assignPath(unit, target);
    }
    return false;
  }

  private tryUnstickUnit(unit: Unit, currentTarget: RtsVector, finalTarget: RtsVector, deltaTime: number): boolean {
    const state = this.stuckUnits.get(unit.id) ?? { seconds: 0, lastX: unit.x, lastY: unit.y };
    const drift = Math.hypot(unit.x - state.lastX, unit.y - state.lastY);
    state.seconds = drift < 1 ? state.seconds + deltaTime : 0;
    state.lastX = unit.x;
    state.lastY = unit.y;
    this.stuckUnits.set(unit.id, state);

    if (state.seconds < STUCK_UNBLOCK_SECONDS) return false;

    const center = this.centerOf(unit);
    const dx = currentTarget.x - center.x;
    const dy = currentTarget.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    const perpendicular = { x: -dy / length, y: dx / length };
    const firstSide = Math.random() < 0.5 ? 1 : -1;
    const candidates = [firstSide, -firstSide].map((side) => ({
      x: this.clamp(center.x + perpendicular.x * STUCK_SIDE_STEP * side, unit.width / 2, MAP_WIDTH * TILE_SIZE - unit.width / 2),
      y: this.clamp(center.y + perpendicular.y * STUCK_SIDE_STEP * side, unit.height / 2, MAP_HEIGHT * TILE_SIZE - unit.height / 2),
    }));

    const sideStep = candidates.find((candidate) => this.canUnitStandAt(unit, candidate));
    if (!sideStep) {
      state.seconds = 0;
      return false;
    }

    const tail = this.pathfindBudget > 0 ? this.simplifyPath(this.findPath(sideStep, finalTarget)) : [finalTarget];
    unit.order.path = [sideStep, ...tail];
    unit.order.pathTarget = finalTarget;
    this.stuckUnits.delete(unit.id);
    return true;
  }

  private moveUnitByVector(unit: Unit, dx: number, dy: number, deltaTime: number): boolean {
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length <= 0) return false;
    const speed = this.getTerrainSpeed(unit) * unit.speed;
    const beforeX = unit.x;
    const beforeY = unit.y;
    const nextX = this.clamp(unit.x + (dx / length) * speed * deltaTime, 0, MAP_WIDTH * TILE_SIZE - unit.width);
    const nextY = this.clamp(unit.y + (dy / length) * speed * deltaTime, 0, MAP_HEIGHT * TILE_SIZE - unit.height);
    this.tryMoveUnit(unit, nextX, nextY);
    unit.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    return Math.abs(unit.x - beforeX) > 0.01 || Math.abs(unit.y - beforeY) > 0.01;
  }

  private tryMoveUnit(unit: Unit, nextX: number, nextY: number): void {
    const originalX = unit.x;
    const originalY = unit.y;

    unit.x = nextX;
    if (this.isUnitBlocked(unit)) unit.x = originalX;

    unit.y = nextY;
    if (this.isUnitBlocked(unit)) unit.y = originalY;
  }

  private isUnitBlocked(unit: Unit): boolean {
    const samplePoints = [
      { x: unit.x + 5, y: unit.y + 5 },
      { x: unit.x + unit.width - 5, y: unit.y + 5 },
      { x: unit.x + 5, y: unit.y + unit.height - 5 },
      { x: unit.x + unit.width - 5, y: unit.y + unit.height - 5 },
      this.centerOf(unit),
    ];

    return samplePoints.some((point) => {
      const tile = this.getTileAtWorld(point);
      if (!tile || !this.isTileWalkable(tile.x, tile.y)) return true;
      return this.isPointBlockedByBuilding(point, unit.factionId);
    });
  }

  private canUnitStandAt(unit: Unit, center: RtsVector): boolean {
    const left = center.x - unit.width / 2;
    const top = center.y - unit.height / 2;
    const samplePoints = [
      { x: left + 5, y: top + 5 },
      { x: left + unit.width - 5, y: top + 5 },
      { x: left + 5, y: top + unit.height - 5 },
      { x: left + unit.width - 5, y: top + unit.height - 5 },
      center,
    ];

    const terrainBlocked = samplePoints.some((point) => {
      const tile = this.getTileAtWorld(point);
      if (!tile || !this.isTileWalkable(tile.x, tile.y)) return true;
      return this.isPointBlockedByBuilding(point, unit.factionId);
    });
    if (terrainBlocked) return false;

    return !Object.values(this.state.units).some((other) => {
      if (other.id === unit.id) return false;
      let minDist = UNIT_COLLISION_RADIUS * 2.2;
      if (other.factionId === unit.factionId && ['build', 'gather', 'move'].includes(other.order.type)) {
        minDist *= 0.55;
      }
      return this.pointDistance(center, this.centerOf(other)) < minDist;
    });
  }

  private getTerrainSpeed(unit: Unit): number {
    const tile = this.getTileAtWorld(this.centerOf(unit));
    if (!tile) return 1;
    if (tile.terrain === 'road') return 1.25;
    if (tile.terrain === 'bridge') return 1.15;
    if (tile.terrain === 'forest') return unit.role === 'cavalry' ? 0.55 : 0.82;
    if (tile.terrain === 'mountain' || tile.terrain === 'water') return 0;
    return 1;
  }

  private resolveUnitCollisions(): void {
    const cellSize = TILE_SIZE * 2;
    const buckets = new Map<string, Unit[]>();

    Object.values(this.state.units).forEach((unit) => {
      const cx = Math.floor(this.centerOf(unit).x / cellSize);
      const cy = Math.floor(this.centerOf(unit).y / cellSize);
      const key = `${cx}:${cy}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(unit);
      else buckets.set(key, [unit]);
    });

    buckets.forEach((units, key) => {
      const [cx, cy] = key.split(':').map(Number);
      const neighbors: Unit[] = [...units];
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          if (ox === 0 && oy === 0) continue;
          const nearby = buckets.get(`${cx + ox}:${cy + oy}`);
          if (nearby) neighbors.push(...nearby);
        }
      }

      for (let i = 0; i < units.length; i++) {
        for (let j = 0; j < neighbors.length; j++) {
          const a = units[i];
          const b = neighbors[j];
          if (a.id >= b.id) continue;
          const ac = this.centerOf(a);
          const bc = this.centerOf(b);
          let dx = ac.x - bc.x;
          let dy = ac.y - bc.y;
          let distance = Math.sqrt(dx * dx + dy * dy);
          let minDistance = UNIT_COLLISION_RADIUS * 2;
          if (a.factionId === b.factionId) {
            const bothWorking = ['build', 'gather', 'move'].includes(a.order.type) && ['build', 'gather', 'move'].includes(b.order.type);
            if (bothWorking) minDistance *= FRIENDLY_COLLISION_FACTOR;
          }
          if (distance >= minDistance) continue;
          if (distance === 0) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            distance = Math.sqrt(dx * dx + dy * dy);
          }
          const push = (minDistance - distance) * (a.factionId === b.factionId ? 0.35 : 0.5);
          this.tryMoveUnit(a, a.x + (dx / distance) * push, a.y + (dy / distance) * push);
          this.tryMoveUnit(b, b.x - (dx / distance) * push, b.y - (dy / distance) * push);
        }
      }
    });
  }

  private canPlaceBuilding(tileX: number, tileY: number, width: number, height: number, type: BuildingType): boolean {
    for (let y = tileY; y < tileY + height; y++) {
      for (let x = tileX; x < tileX + width; x++) {
        const tile = this.getTile(x, y);
        if (!tile || tile.terrain === 'mountain') return false;
        if (type === 'bridge') {
          if (tile.terrain !== 'water') return false;
        } else if (tile.terrain === 'water') {
          return false;
        }
      }
    }
    return !Object.values(this.state.buildings).some((building) => {
      return (
        tileX * TILE_SIZE < building.x + building.width &&
        (tileX + width) * TILE_SIZE > building.x &&
        tileY * TILE_SIZE < building.y + building.height &&
        (tileY + height) * TILE_SIZE > building.y
      );
    });
  }

  private paintTerrainForBuilding(building: Building): void {
    const startX = Math.floor(building.x / TILE_SIZE);
    const startY = Math.floor(building.y / TILE_SIZE);
    const width = Math.ceil(building.width / TILE_SIZE);
    const height = Math.ceil(building.height / TILE_SIZE);
    for (let y = startY; y < startY + height; y++) {
      for (let x = startX; x < startX + width; x++) {
        const tile = this.getTile(x, y);
        if (tile && building.type === 'farm') tile.terrain = 'field';
        if (tile && building.type === 'bridge') tile.terrain = 'bridge';
        if (tile && (building.type === 'wall' || building.type === 'gate')) tile.terrain = 'grass';
      }
    }
  }

  private restoreTerrainForBuilding(building: Building): void {
    const startX = Math.floor(building.x / TILE_SIZE);
    const startY = Math.floor(building.y / TILE_SIZE);
    const width = Math.ceil(building.width / TILE_SIZE);
    const height = Math.ceil(building.height / TILE_SIZE);
    let index = 0;
    for (let y = startY; y < startY + height; y++) {
      for (let x = startX; x < startX + width; x++) {
        const tile = this.getTile(x, y);
        if (tile) tile.terrain = building.footprintTerrain?.[index] ?? 'grass';
        index++;
      }
    }
  }

  private canAfford(faction: Faction, cost: Partial<Record<ResourceType, number>>): boolean {
    return RESOURCE_TYPES.every((resource) => faction.resources[resource] >= (cost[resource] ?? 0));
  }

  private payCost(faction: Faction, cost: Partial<Record<ResourceType, number>>): void {
    RESOURCE_TYPES.forEach((resource) => {
      faction.resources[resource] -= cost[resource] ?? 0;
    });
  }

  private findNearestTile(unit: Unit, terrain: TerrainType): Tile | null {
    let best: Tile | null = null;
    let bestDistance = Infinity;
    this.state.tiles.forEach((tile) => {
      if (tile.terrain !== terrain) return;
      const distance = this.pointDistance(this.centerOf(unit), this.tileCenter(tile));
      if (distance < bestDistance) {
        best = tile;
        bestDistance = distance;
      }
    });
    return best;
  }

  private findNearestResourceTile(unit: Unit, resource: ResourceType): Tile | null {
    const unitCenter = this.centerOf(unit);
    const candidates: Array<{ tile: Tile; distance: number; standPoint: RtsVector }> = [];

    const collectInRadius = (radiusTiles: number) => {
      const centerTileX = Math.floor(unitCenter.x / TILE_SIZE);
      const centerTileY = Math.floor(unitCenter.y / TILE_SIZE);
      const startX = Math.max(0, centerTileX - radiusTiles);
      const endX = Math.min(this.state.mapWidth - 1, centerTileX + radiusTiles);
      const startY = Math.max(0, centerTileY - radiusTiles);
      const endY = Math.min(this.state.mapHeight - 1, centerTileY + radiusTiles);

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          const tile = this.getTile(x, y);
          if (!tile || !this.tileHasGatherable(tile, resource)) continue;
          if (!this.canUnitGatherTile(unit, tile, resource)) continue;
          const key = this.gatherTileKey(tile, resource);
          const owner = this.gatherTileReserved.get(key);
          if (owner && owner !== unit.id) continue;
          const standPoint = this.getGatherStandPoint(tile);
          candidates.push({ tile, distance: this.pointDistance(unitCenter, standPoint), standPoint });
        }
      }
    };

    collectInRadius(this.unitCount > 55 ? 28 : 42);
    if (candidates.length === 0) collectInRadius(72);

    candidates.sort((a, b) => a.distance - b.distance);
    const topCandidates = candidates.slice(0, this.unitCount > 55 ? 3 : 6);
    if (topCandidates.length === 0) return null;
    if (this.unitCount > 55 || this.pathfindBudget <= 0) {
      return topCandidates[0].tile;
    }

    let best: Tile | null = null;
    let bestDistance = Infinity;
    for (const candidate of topCandidates) {
      if (candidate.distance >= bestDistance) continue;
      if (this.pathfindBudget <= 0) {
        return candidate.tile;
      }
      this.pathfindBudget -= 1;
      const path = this.findPath(unitCenter, candidate.standPoint);
      if (path.length === 0) continue;
      best = candidate.tile;
      bestDistance = candidate.distance;
    }
    return best ?? topCandidates[0].tile;
  }

  private findNearestStorage(factionId: string, unit: Unit): Building | null {
    return this.findNearestBuilding(unit, (building) => building.complete && building.factionId === factionId && ['townHall', 'warehouse'].includes(building.type));
  }

  private findNearestBlueprint(unit: Unit): Building | null {
    return this.findNearestBuilding(unit, (building) => building.factionId === unit.factionId && !building.complete);
  }

  private findPlayerCommander(): Unit | null {
    return Object.values(this.state.units).find((unit) => unit.factionId === 'player' && unit.role === 'commander') ?? null;
  }

  private findPlayerCore(): Building | null {
    return Object.values(this.state.buildings).find((building) => building.complete && building.factionId === 'player' && building.type === 'townHall') ?? null;
  }

  private findNearestEnemyUnit(
    unit: { x: number; y: number; width: number; height: number },
    factionIds: string[],
    maxRange = 520
  ): Unit | null {
    const center = this.centerOf(unit);
    let best: Unit | null = null;
    let bestDistance = Infinity;
    this.queryUnitsNear(center, maxRange, (candidate) => factionIds.includes(candidate.factionId)).forEach((candidate) => {
      const distance = this.distance(unit, candidate);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    });
    return best;
  }

  private findNearestEnemyBuilding(unit: Unit, factionIds: string[]): Building | null {
    return this.findNearestBuilding(unit, (building) => factionIds.includes(building.factionId));
  }

  private findNearestBuilding(unit: Unit, predicate: (building: Building) => boolean): Building | null {
    let best: Building | null = null;
    let bestDistance = Infinity;
    Object.values(this.state.buildings).forEach((building) => {
      if (!predicate(building)) return;
      const distance = this.distance(unit, building);
      if (distance < bestDistance) {
        best = building;
        bestDistance = distance;
      }
    });
    return best;
  }

  private findPath(startWorld: RtsVector, endWorld: RtsVector): RtsVector[] {
    const start = this.worldToTile(startWorld);
    const end = this.findNearestWalkableTile(this.worldToTile(endWorld));
    if (!end || !this.isTileWalkable(start.x, start.y)) return [endWorld];

    const pad = Math.min(72, Math.max(18, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y)) + 10));
    const boundMinX = Math.max(0, Math.min(start.x, end.x) - pad);
    const boundMaxX = Math.min(MAP_WIDTH - 1, Math.max(start.x, end.x) + pad);
    const boundMinY = Math.max(0, Math.min(start.y, end.y) - pad);
    const boundMaxY = Math.min(MAP_HEIGHT - 1, Math.max(start.y, end.y) + pad);

    const startKey = this.tileKey(start.x, start.y);
    const endKey = this.tileKey(end.x, end.y);
    const open = new MinHeap<{ x: number; y: number; f: number }>((node) => node.f);
    open.push({ x: start.x, y: start.y, f: 0 });
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[startKey, 0]]);
    const closed = new Set<string>();
    let iterations = 0;

    while (open.size > 0 && iterations < PATHFIND_MAX_ITERATIONS) {
      iterations += 1;
      const current = open.pop()!;
      const currentKey = this.tileKey(current.x, current.y);
      if (closed.has(currentKey)) continue;
      if (currentKey === endKey) {
        return this.reconstructPath(cameFrom, currentKey).map((key) => {
          const [x, y] = key.split(':').map(Number);
          return this.tileCenter({ x, y, terrain: 'grass', fertility: 0 });
        });
      }

      closed.add(currentKey);
      for (const neighbor of this.getPathNeighbors(current.x, current.y)) {
        if (neighbor.x < boundMinX || neighbor.x > boundMaxX || neighbor.y < boundMinY || neighbor.y > boundMaxY) continue;
        const neighborKey = this.tileKey(neighbor.x, neighbor.y);
        if (closed.has(neighborKey)) continue;

        const tentativeG = (gScore.get(currentKey) ?? Infinity) + neighbor.cost;
        if (tentativeG >= (gScore.get(neighborKey) ?? Infinity)) continue;

        cameFrom.set(neighborKey, currentKey);
        gScore.set(neighborKey, tentativeG);
        const h = Math.abs(neighbor.x - end.x) + Math.abs(neighbor.y - end.y);
        open.push({ x: neighbor.x, y: neighbor.y, f: tentativeG + h });
      }
    }

    return [endWorld];
  }

  private reconstructPath(cameFrom: Map<string, string>, currentKey: string): string[] {
    const path = [currentKey];
    while (cameFrom.has(currentKey)) {
      currentKey = cameFrom.get(currentKey)!;
      path.unshift(currentKey);
    }
    path.shift();
    return path;
  }

  private getPathNeighbors(x: number, y: number): Array<{ x: number; y: number; cost: number }> {
    const candidates = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];

    return candidates
      .filter((candidate) => this.isTileWalkable(candidate.x, candidate.y))
      .map((candidate) => ({
        ...candidate,
        cost: this.getTilePathCost(candidate.x, candidate.y),
      }));
  }

  private findNearestWalkableTile(tile: { x: number; y: number }): { x: number; y: number } | null {
    if (this.isTileWalkable(tile.x, tile.y)) return tile;
    for (let radius = 1; radius <= 8; radius++) {
      for (let y = tile.y - radius; y <= tile.y + radius; y++) {
        for (let x = tile.x - radius; x <= tile.x + radius; x++) {
          if (this.isTileWalkable(x, y)) return { x, y };
        }
      }
    }
    return null;
  }

  private getGatherStandPoint(tile: Tile): RtsVector {
    if (tile.terrain !== 'mountain' && tile.terrain !== 'water' && this.isTileWalkable(tile.x, tile.y)) {
      return this.tileCenter(tile);
    }

    const walkable = this.findNearestWalkableTile({ x: tile.x, y: tile.y });
    if (walkable) {
      return { x: walkable.x * TILE_SIZE + TILE_SIZE / 2, y: walkable.y * TILE_SIZE + TILE_SIZE / 2 };
    }

    return this.tileCenter(tile);
  }

  private getBuildingStandPoint(building: Building): RtsVector {
    const startX = Math.floor(building.x / TILE_SIZE);
    const startY = Math.floor(building.y / TILE_SIZE);
    const width = Math.ceil(building.width / TILE_SIZE);
    const height = Math.ceil(building.height / TILE_SIZE);
    const candidates: Array<{ x: number; y: number }> = [];

    for (let x = startX - 1; x <= startX + width; x++) {
      candidates.push({ x, y: startY - 1 }, { x, y: startY + height });
    }
    for (let y = startY; y < startY + height; y++) {
      candidates.push({ x: startX - 1, y }, { x: startX + width, y });
    }

    let bestPoint: RtsVector | null = null;
    let bestDistance = Infinity;
    const center = this.centerOf(building);
    candidates.forEach((tile) => {
      if (!this.isTileWalkable(tile.x, tile.y)) return;
      const point = { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
      const distance = this.pointDistance(center, point);
      if (distance < bestDistance) {
        bestPoint = point;
        bestDistance = distance;
      }
    });

    if (bestPoint) return bestPoint;

    const fallbackTile = { x: startX + Math.floor(width / 2), y: startY + height };
    return {
      x: fallbackTile.x * TILE_SIZE + TILE_SIZE / 2,
      y: fallbackTile.y * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  private isTileWalkable(x: number, y: number): boolean {
    const tile = this.getTile(x, y);
    if (!tile) return false;
    if (tile.terrain === 'water' || tile.terrain === 'mountain') return false;

    const blocker = Object.values(this.state.buildings).find((building) => {
      if (!building.complete) return false;
      const startX = Math.floor(building.x / TILE_SIZE);
      const startY = Math.floor(building.y / TILE_SIZE);
      const width = Math.ceil(building.width / TILE_SIZE);
      const height = Math.ceil(building.height / TILE_SIZE);
      return x >= startX && x < startX + width && y >= startY && y < startY + height;
    });

    if (!blocker) return true;
    return blocker.type === 'gate' || blocker.type === 'bridge';
  }

  private getTilePathCost(x: number, y: number): number {
    const tile = this.getTile(x, y);
    if (!tile) return Infinity;
    if (tile.terrain === 'road') return 0.65;
    if (tile.terrain === 'bridge') return 0.8;
    if (tile.terrain === 'forest') return 1.7;
    if (tile.terrain === 'field') return 1.1;
    return 1;
  }

  private isPointBlockedByBuilding(point: RtsVector, factionId: string): boolean {
    return Object.values(this.state.buildings).some((building) => {
      if (!building.complete) return false;
      if (building.type === 'gate' || building.type === 'bridge') return false;
      if (building.factionId === factionId && ['townHall', 'warehouse', 'barracks', 'market'].includes(building.type)) {
        return false;
      }
      return point.x >= building.x && point.x <= building.x + building.width && point.y >= building.y && point.y <= building.y + building.height;
    });
  }

  private ejectTrappedUnits(): void {
    Object.values(this.state.units).forEach((unit) => {
      const building = this.findBlockingBuildingOverlap(unit);
      if (building) this.relocateUnitOutsideBuilding(unit, building);
    });
  }

  private relocateUnitsOutsideBuilding(building: Building): void {
    Object.values(this.state.units).forEach((unit) => {
      if (this.isUnitOverlappingBlockingBuilding(unit, building) || this.isUnitCenterInsideBuilding(unit, building, true)) {
        this.relocateUnitOutsideBuilding(unit, building);
      }
    });
  }

  private findBlockingBuildingOverlap(unit: Unit): Building | null {
    return Object.values(this.state.buildings).find((building) => this.isUnitOverlappingBlockingBuilding(unit, building)) ?? null;
  }

  private isUnitOverlappingBlockingBuilding(unit: Unit, building: Building): boolean {
    if (!building.complete) return false;
    if (this.isPassableFriendlyBuilding(building, unit.factionId)) return false;
    return this.rectsOverlap(unit.x, unit.y, unit.width, unit.height, building.x, building.y, building.width, building.height);
  }

  private isUnitCenterInsideBuilding(unit: Unit, building: Building, includeBlueprint = false): boolean {
    if (!includeBlueprint && !building.complete) return false;
    if (building.type === 'gate' || building.type === 'bridge') return false;
    return this.isCenterInsideBuilding(this.centerOf(unit), building);
  }

  private isPassableFriendlyBuilding(building: Building, factionId: string): boolean {
    return (
      building.type === 'gate' ||
      building.type === 'bridge' ||
      (building.factionId === factionId && ['townHall', 'warehouse', 'barracks', 'market'].includes(building.type))
    );
  }

  private rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  private relocateUnitOutsideBuilding(unit: Unit, building: Building): void {
    const exit = this.getExteriorSpawnPoint(unit, building);
    unit.x = this.clamp(exit.x - unit.width / 2, 0, MAP_WIDTH * TILE_SIZE - unit.width);
    unit.y = this.clamp(exit.y - unit.height / 2, 0, MAP_HEIGHT * TILE_SIZE - unit.height);
    unit.order.path = [];
    if (unit.order.type === 'build' && unit.order.targetId === building.id) {
      unit.order = { type: 'idle' };
    }
  }

  private assignBuildSlot(unit: Unit, building: Building): RtsVector | null {
    this.releaseBuildSlot(unit.id);
    const slots = this.getBuildingWorkSlots(building);
    let taken = this.buildSlotsTaken.get(building.id);
    if (!taken) {
      taken = new Set();
      this.buildSlotsTaken.set(building.id, taken);
    }

    for (let i = 0; i < slots.length; i++) {
      if (taken.has(i)) continue;
      const point = slots[i];
      if (this.isCenterInsideBuilding(point, building)) continue;
      if (!this.canUnitStandAt(unit, point)) continue;
      if (this.isBuildSlotOccupiedByOther(point, unit.id)) continue;
      taken.add(i);
      this.buildSlotByUnit.set(unit.id, { buildingId: building.id, slot: i });
      return point;
    }

    const fallback = this.getExteriorSpawnPoint(unit, building);
    if (this.canUnitStandAt(unit, fallback) && !this.isCenterInsideBuilding(fallback, building)) {
      return fallback;
    }
    return null;
  }

  private releaseBuildSlot(unitId: string): void {
    const slot = this.buildSlotByUnit.get(unitId);
    if (!slot) return;
    const taken = this.buildSlotsTaken.get(slot.buildingId);
    taken?.delete(slot.slot);
    this.buildSlotByUnit.delete(unitId);
  }

  private releaseGatherTile(unitId: string): void {
    for (const [key, owner] of this.gatherTileReserved.entries()) {
      if (owner === unitId) this.gatherTileReserved.delete(key);
    }
  }

  private reserveGatherTile(tile: Tile, unitId: string): { standPoint: RtsVector } | null {
    const resource = this.getGatherResourceForTile(tile);
    if (!resource) return null;
    const key = this.gatherTileKey(tile, resource);
    const owner = this.gatherTileReserved.get(key);
    if (owner && owner !== unitId) return null;

    const slots = this.getGatherStandSlots(tile);
    for (const standPoint of slots) {
      const slotKey = `${key}@${Math.round(standPoint.x)}:${Math.round(standPoint.y)}`;
      const slotOwner = this.gatherTileReserved.get(slotKey);
      if (slotOwner && slotOwner !== unitId) continue;
      this.gatherTileReserved.set(key, unitId);
      this.gatherTileReserved.set(slotKey, unitId);
      return { standPoint };
    }
    return null;
  }

  private gatherTileKey(tile: Tile, resource: ResourceType): string {
    return `${resource}:${tile.x}:${tile.y}`;
  }

  private getGatherStandSlots(tile: Tile): RtsVector[] {
    const base = this.getGatherStandPoint(tile);
    const offsets = [
      { x: 0, y: 0 },
      { x: TILE_SIZE * 0.9, y: 0 },
      { x: -TILE_SIZE * 0.9, y: 0 },
      { x: 0, y: TILE_SIZE * 0.9 },
      { x: 0, y: -TILE_SIZE * 0.9 },
      { x: TILE_SIZE * 0.65, y: TILE_SIZE * 0.65 },
      { x: -TILE_SIZE * 0.65, y: TILE_SIZE * 0.65 },
    ];
    return offsets.map((o) => ({ x: base.x + o.x, y: base.y + o.y }));
  }

  private getBuildingWorkSlots(building: Building): RtsVector[] {
    const startX = Math.floor(building.x / TILE_SIZE);
    const startY = Math.floor(building.y / TILE_SIZE);
    const width = Math.ceil(building.width / TILE_SIZE);
    const height = Math.ceil(building.height / TILE_SIZE);
    const ringTiles: Array<{ x: number; y: number }> = [];

    for (let x = startX - 1; x <= startX + width; x++) {
      ringTiles.push({ x, y: startY - 1 }, { x, y: startY + height });
    }
    for (let y = startY; y < startY + height; y++) {
      ringTiles.push({ x: startX - 1, y }, { x: startX + width, y });
    }

    const slots: RtsVector[] = [];
    const seen = new Set<string>();
    ringTiles.forEach((tile) => {
      if (!this.isTileWalkable(tile.x, tile.y)) return;
      const key = this.tileKey(tile.x, tile.y);
      if (seen.has(key)) return;
      seen.add(key);
      slots.push({ x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 });
    });

    return slots;
  }

  private isBuildSlotOccupiedByOther(point: RtsVector, unitId: string): boolean {
    return Object.values(this.state.units).some((other) => {
      if (other.id === unitId) return false;
      if (other.order.type !== 'build') return false;
      return this.pointDistance(this.centerOf(other), point) < UNIT_COLLISION_RADIUS * 1.8;
    });
  }

  private getDepositStandPoint(building: Building, unit: Unit): RtsVector {
    const slots = this.getBuildingWorkSlots(building);
    const unitCenter = this.centerOf(unit);
    let best = slots[0] ?? this.getBuildingStandPoint(building);
    let bestDist = Infinity;
    slots.forEach((point) => {
      const d = this.pointDistance(unitCenter, point);
      if (d < bestDist) {
        best = point;
        bestDist = d;
      }
    });
    return best;
  }

  private distanceToBuildingEdge(unit: Unit, building: Building): number {
    const c = this.centerOf(unit);
    const dx = Math.max(0, building.x - c.x, c.x - (building.x + building.width));
    const dy = Math.max(0, building.y - c.y, c.y - (building.y + building.height));
    return Math.hypot(dx, dy);
  }

  private setUnitOrder(unit: Unit, order: Unit['order']): void {
    if (unit.order.type === 'build') this.releaseBuildSlot(unit.id);
    if (unit.order.type === 'gather') this.releaseGatherTile(unit.id);
    unit.order = order;
    if (order.type !== 'build') this.releaseBuildSlot(unit.id);
    if (order.type !== 'gather') this.releaseGatherTile(unit.id);
  }

  private depleteFieldTile(tile: Tile): void {
    tile.fertility = 0.12;
    tile.terrain = 'grass';
  }

  private resourceShortName(resource: ResourceType): string {
    const names: Record<ResourceType, string> = {
      food: '粮',
      wood: '木',
      stone: '石',
      iron: '铁',
      gold: '金',
      population: '人',
    };
    return names[resource];
  }

  private isCenterInsideBuilding(center: RtsVector, building: Building): boolean {
    return (
      center.x > building.x &&
      center.x < building.x + building.width &&
      center.y > building.y &&
      center.y < building.y + building.height
    );
  }

  private getExteriorSpawnPoint(unit: Unit, building: Building): RtsVector {
    const unitCenter = this.centerOf(unit);
    const startX = Math.floor(building.x / TILE_SIZE);
    const startY = Math.floor(building.y / TILE_SIZE);
    const tileWidth = Math.ceil(building.width / TILE_SIZE);
    const tileHeight = Math.ceil(building.height / TILE_SIZE);
    let bestPoint: RtsVector | null = null;
    let bestDistance = Infinity;

    for (let ring = 1; ring <= 5; ring++) {
      const ringTiles: Array<{ x: number; y: number }> = [];
      for (let x = startX - ring; x <= startX + tileWidth - 1 + ring; x++) {
        ringTiles.push({ x, y: startY - ring }, { x, y: startY + tileHeight - 1 + ring });
      }
      for (let y = startY - ring + 1; y <= startY + tileHeight - 2 + ring; y++) {
        ringTiles.push({ x: startX - ring, y }, { x: startX + tileWidth - 1 + ring, y });
      }

      for (const tile of ringTiles) {
        const candidate = { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
        if (this.isCenterInsideBuilding(candidate, building)) continue;
        if (!this.canUnitStandAt(unit, candidate)) continue;
        const distance = this.pointDistance(unitCenter, candidate);
        if (distance < bestDistance) {
          bestPoint = candidate;
          bestDistance = distance;
        }
      }

      if (bestPoint) return bestPoint;
    }

    return this.forceExteriorSpawnPoint(unit, building);
  }

  private forceExteriorSpawnPoint(unit: Unit, building: Building): RtsVector {
    const center = this.centerOf(unit);
    const margin = unit.width / 2 + TILE_SIZE * 0.35;
    const distLeft = center.x - building.x;
    const distRight = building.x + building.width - center.x;
    const distTop = center.y - building.y;
    const distBottom = building.y + building.height - center.y;
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);

    if (minDist === distLeft) {
      return { x: building.x - margin, y: center.y };
    }
    if (minDist === distRight) {
      return { x: building.x + building.width + margin, y: center.y };
    }
    if (minDist === distTop) {
      return { x: center.x, y: building.y - margin };
    }
    return { x: center.x, y: building.y + building.height + margin };
  }

  private worldToTile(world: RtsVector): { x: number; y: number } {
    return {
      x: Math.floor(world.x / TILE_SIZE),
      y: Math.floor(world.y / TILE_SIZE),
    };
  }

  private tileKey(x: number, y: number): string {
    return `${x}:${y}`;
  }

  private getTileAtWorld(world: RtsVector): Tile | null {
    return this.getTile(Math.floor(world.x / TILE_SIZE), Math.floor(world.y / TILE_SIZE));
  }

  private getTile(x: number, y: number): Tile | null {
    const mapWidth = this.state.mapWidth;
    const mapHeight = this.state.mapHeight;
    if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) return null;
    return this.state.tiles[y * mapWidth + x] ?? null;
  }

  private tileCenter(tile: Tile): RtsVector {
    return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
  }

  private spreadTarget(target: RtsVector, seed: string, radius: number): RtsVector {
    const hash = this.hashString(seed);
    const angle = (hash % 628) / 100;
    const distance = radius * (0.45 + ((hash >> 4) % 55) / 100);
    return {
      x: this.clamp(target.x + Math.cos(angle) * distance, 0, MAP_WIDTH * TILE_SIZE),
      y: this.clamp(target.y + Math.sin(angle) * distance, 0, MAP_HEIGHT * TILE_SIZE),
    };
  }

  private centerOf(entity: { x: number; y: number; width: number; height: number }): RtsVector {
    return { x: entity.x + entity.width / 2, y: entity.y + entity.height / 2 };
  }

  private distance(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
    return this.pointDistance(this.centerOf(a), this.centerOf(b));
  }

  private pointDistance(a: RtsVector, b: RtsVector): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private faceTarget(unit: Unit, target: RtsVector): void {
    const center = this.centerOf(unit);
    const dx = target.x - center.x;
    const dy = target.y - center.y;
    unit.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  private id(prefix: string): string {
    return `${prefix}_${this.nextId++}`;
  }

  private log(message: string): void {
    this.state.diplomacyLog.unshift({
      id: this.id('event'),
      message: this.cleanLogMessage(message),
      createdAt: Date.now(),
    });
    this.state.diplomacyLog = this.state.diplomacyLog.slice(0, 6);
  }

  private cleanLogMessage(message: string): string {
    if (message.includes('building') || message.includes('被摧毁')) {
      return message
        .replace('townHall', this.getBuildingLabel('townHall'))
        .replace('house', this.getBuildingLabel('house'))
        .replace('farm', this.getBuildingLabel('farm'))
        .replace('lumberCamp', this.getBuildingLabel('lumberCamp'))
        .replace('warehouse', this.getBuildingLabel('warehouse'))
        .replace('barracks', this.getBuildingLabel('barracks'))
        .replace('market', this.getBuildingLabel('market'))
        .replace('wall', this.getBuildingLabel('wall'))
        .replace('gate', this.getBuildingLabel('gate'))
        .replace('bridge', this.getBuildingLabel('bridge'))
        .replace('tower', this.getBuildingLabel('tower'));
    }

    if (message.includes('day') || message.includes('澶') || message.includes('绗')) return `第 ${this.state.day} 天：斥候报告边境附近有动静。`;
    if (message.includes('鍙') || message.includes('袭击')) return '发现赤潮袭击队：敌军正从东部逼近。';
    if (message.includes('灏') || message.includes('将领')) return '将领倒下了，但城邦仍在继续作战。';
    if (message.includes('杈') || message.includes('城邦')) return '边境城邦建立。北境守望是盟友，赤潮军阀是敌人。';
    if (message.includes('璧') || message.includes('资源')) return '资源不足，无法执行命令。';
    if (message.includes('杩') || message.includes('这里')) return '这里不能建造。';
    if (message.includes('宸') || message.includes('已')) return '命令已执行。';
    return message;
  }

  private getBuildingLabel(type: BuildingType): string {
    const labels: Record<BuildingType, string> = {
      townHall: '主城',
      house: '民居',
      farm: '农田',
      lumberCamp: '伐木营',
      warehouse: '仓库',
      barracks: '兵营',
      market: '市场',
      smithy: '铁匠铺',
      stable: '马厩',
      wall: '城墙',
      gate: '城门',
      bridge: '桥梁',
      tower: '箭塔',
    };
    return labels[type];
  }

  private getUnitLabel(role: UnitRole): string {
    const labels: Record<UnitRole, string> = {
      commander: '将领',
      worker: '工人',
      woodcutter: '伐木工',
      stonecutter: '采石工',
      miner: '矿工',
      farmer: '农夫',
      trader: '商人',
      swordsman: '剑盾兵',
      spearman: '长矛兵',
      archer: '弓箭手',
      cavalry: '骑兵',
      engineer: '工兵',
      guard: '守卫',
    };
    return labels[role];
  }

  private addCombatEvent(kind: 'melee' | 'arrow' | 'hit' | 'command' | 'gather' | 'deposit' | 'build', start: RtsVector, end: RtsVector, resource?: ResourceType, amount?: number): void {
    this.state.combatEvents.push({
      id: this.id('combat'),
      kind,
      x: start.x,
      y: start.y,
      targetX: end.x,
      targetY: end.y,
      createdAt: Date.now(),
      resource,
      amount,
    });
  }
}
