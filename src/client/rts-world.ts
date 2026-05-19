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
} from '../shared/rts-types';

const TILE_SIZE = 32;
const MAP_WIDTH = 140;
const MAP_HEIGHT = 100;
const UNIT_SIZE = 32;
const UNIT_COLLISION_RADIUS = 13;
const COMBAT_EVENT_TTL = 650;
const FOREST_REGEN_SECONDS = 45;
const QUARRY_REGEN_SECONDS = 120;
const CITY_HEAL_RADIUS = 260;
const CITY_HEAL_PER_SECOND = 8;
const AUTO_AGGRO_RANGE = 210;
const BUILD_WORK_PER_SECOND = 18;

const RESOURCE_TYPES: ResourceType[] = ['food', 'wood', 'stone', 'iron', 'gold', 'population'];

const BUILDING_COSTS: Record<BuildingType, Partial<Record<ResourceType, number>>> = {
  townHall: { wood: 120, stone: 80 },
  house: { wood: 35 },
  farm: { wood: 20 },
  lumberCamp: { wood: 30 },
  warehouse: { wood: 45, stone: 15 },
  barracks: { wood: 80, stone: 35 },
  market: { wood: 70, gold: 30 },
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
  private nextId = 1;
  private spawnTimer = 0;
  private economyTimer = 0;

  constructor() {
    this.state = this.createInitialState();
  }

  update(deltaTime: number): void {
    this.state.timeOfDay += deltaTime;
    if (this.state.timeOfDay >= 90) {
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

    this.spawnTimer += deltaTime;
    if (this.spawnTimer >= Math.max(14, 34 - this.state.day * 2)) {
      this.spawnTimer = 0;
      this.spawnRaid();
    }

    Object.values(this.state.units).forEach((unit) => this.updateUnit(unit, deltaTime));
    this.resolveUnitCollisions();
    this.removeDeadEntities();
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
      unit.order = {
        type: 'move',
        target: offsetTarget,
        path: this.findPath(this.centerOf(unit), offsetTarget),
        pathTarget: offsetTarget,
      };
    });
  }

  commandSelectedAttack(targetId: string): void {
    this.state.selectedUnitIds.forEach((id) => {
      const unit = this.state.units[id];
      if (unit) unit.order = { type: 'attack', targetId };
    });
  }

  commandSelectedGather(world: RtsVector): boolean {
    const tile = this.getTileAtWorld(world);
    if (!tile?.resource || (tile.resourceAmount ?? 0) <= 0) return false;
    const target = this.getGatherStandPoint(tile);
    let assigned = false;
    this.state.selectedUnitIds.forEach((id) => {
      const unit = this.state.units[id];
      if (!unit || !this.isGatherer(unit)) return;
      const assignedTarget = this.spreadTarget(target, unit.id, 14);
      assigned = true;
      unit.order = {
        type: 'gather',
        target: assignedTarget,
        targetTile: { x: tile.x, y: tile.y },
        resource: tile.resource,
        path: this.findPath(this.centerOf(unit), assignedTarget),
        pathTarget: assignedTarget,
      };
    });
    return assigned;
  }

  commandSelectedBuild(targetId: string): boolean {
    const building = this.state.buildings[targetId];
    if (!building || building.complete || building.factionId !== 'player') return false;
    const target = this.getBuildingStandPoint(building);
    let assigned = false;
    this.state.selectedUnitIds.forEach((id) => {
      const unit = this.state.units[id];
      if (!unit || !this.isBuilder(unit)) return;
      const assignedTarget = this.spreadTarget(target, unit.id, 16);
      assigned = true;
      unit.order = {
        type: 'build',
        targetId: building.id,
        target: assignedTarget,
        path: this.findPath(this.centerOf(unit), assignedTarget),
        pathTarget: assignedTarget,
      };
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
    this.log(`已放置 ${type}。`);
    return true;
  }

  recruit(role: UnitRole): boolean {
    const faction = this.state.factions.player;
    const stats = UNIT_STATS[role];
    const barracks = Object.values(this.state.buildings).find(
      (building) => building.complete && building.factionId === 'player' && (building.type === 'barracks' || building.type === 'townHall')
    );

    if (!barracks) return false;
    if (!this.canAfford(faction, stats.cost)) {
      this.log(`资源不足，无法招募 ${role}。`);
      return false;
    }

    this.payCost(faction, stats.cost);
    const unit = this.createUnit('player', role, barracks.x + barracks.width + 12, barracks.y + barracks.height + 12);
    this.state.units[unit.id] = unit;
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

  private createInitialState(): RtsGameState {
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
    };

    this.state = state;
    this.seedSettlements();
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
        let terrain: TerrainType = 'grass';
        const river = Math.abs(x - (58 + Math.sin(y * 0.08) * 9));
        const lakeA = Math.hypot(x - 96, y - 54);
        const lakeB = Math.hypot(x - 35, y - 76);
        const mountainA = Math.hypot(x - 75, y - 20);
        const mountainB = Math.hypot(x - 112, y - 30);
        const forestPatch = Math.sin(x * 0.37 + y * 0.11) + Math.cos(y * 0.31);

        if (river < 2 || lakeA < 8 || lakeB < 6) terrain = 'water';
        else if (mountainA < 10 || mountainB < 12 || (x > 102 && y > 12 && y < 45 && Math.sin(y * 0.5 + x * 0.12) > 0.55)) terrain = 'mountain';
        else if (forestPatch > 1.05) terrain = 'forest';

        const eastRoad = Math.abs(y - (31 + Math.sin(x * 0.05) * 4));
        const southRoad = Math.abs(y - (70 + Math.sin(x * 0.06) * 3));
        const mainRoad = eastRoad < 0.8 || southRoad < 0.8 || Math.abs(x - 58) < 0.8 && y > 30 && y < 72;
        if (mainRoad && terrain !== 'mountain') terrain = terrain === 'water' ? 'bridge' : 'road';

        const resource = terrain === 'forest' ? 'wood' : terrain === 'mountain' ? (x + y) % 3 === 0 ? 'iron' : 'stone' : undefined;
        const amount = resource === 'wood' ? 90 : resource === 'iron' ? 180 : resource === 'stone' ? 160 : undefined;

        tiles.push({
          x,
          y,
          terrain,
          fertility: terrain === 'grass' ? 0.75 + Math.random() * 0.25 : terrain === 'forest' ? 0.45 : 0.15,
          resource,
          resourceAmount: amount,
          maxResourceAmount: amount,
        });
      }
    }
    return tiles;
  }

  private seedSettlements(): void {
    const playerHall = this.createBuilding('player', 'townHall', 14 * TILE_SIZE, 28 * TILE_SIZE);
    const warehouse = this.createBuilding('player', 'warehouse', 18 * TILE_SIZE, 29 * TILE_SIZE);
    const barracks = this.createBuilding('player', 'barracks', 14 * TILE_SIZE, 24 * TILE_SIZE);
    this.state.buildings[playerHall.id] = playerHall;
    this.state.buildings[warehouse.id] = warehouse;
    this.state.buildings[barracks.id] = barracks;

    ['commander', 'woodcutter', 'stonecutter', 'miner', 'farmer', 'swordsman', 'spearman', 'archer', 'guard'].forEach((role, index) => {
      const unit = this.createUnit('player', role as UnitRole, 17 * TILE_SIZE + (index % 4) * 34, 33 * TILE_SIZE + Math.floor(index / 4) * 34);
      this.state.units[unit.id] = unit;
    });

    this.seedFactionOutpost('north', 102, 22);
    this.seedFactionOutpost('village', 88, 72);
    this.seedFactionOutpost('miners', 113, 36);
    this.seedFactionOutpost('south', 42, 86);
    this.seedFactionOutpost('raiders', 126, 82);
    this.log('边境城邦建立。北境守望是盟友，赤潮军阀是敌人。');
  }

  private seedFactionOutpost(factionId: string, tileX: number, tileY: number): void {
    const hall = this.createBuilding(factionId, factionId === 'village' ? 'market' : 'townHall', tileX * TILE_SIZE, tileY * TILE_SIZE);
    this.state.buildings[hall.id] = hall;
    const roles: UnitRole[] =
      factionId === 'raiders' || factionId === 'south'
        ? ['swordsman', 'spearman', 'archer', 'cavalry']
        : factionId === 'miners'
          ? ['guard', 'spearman', 'worker', 'engineer']
          : ['guard', 'archer', 'trader'];
    roles.forEach((role, index) => {
      const unit = this.createUnit(factionId, role, tileX * TILE_SIZE + index * 34, (tileY + 3) * TILE_SIZE);
      unit.order = { type: factionId === 'raiders' ? 'attack' : 'defend', target: { x: hall.x, y: hall.y } };
      this.state.units[unit.id] = unit;
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
      this.updateAiUnit(unit);
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

  private updateAiUnit(unit: Unit): void {
    if (unit.health < unit.maxHealth * 0.35) {
      const core = this.findNearestBuilding(unit, (building) => building.factionId === unit.factionId && building.type === 'townHall');
      if (core) {
        unit.order = { type: 'move', target: this.centerOf(core), path: this.findPath(this.centerOf(unit), this.centerOf(core)), pathTarget: this.centerOf(core) };
        return;
      }
    }

    const enemies = this.getEnemyFactionIds(unit.factionId);
    const nearbyHostile = this.findNearestEnemyUnit(unit, enemies);
    if (nearbyHostile && this.distance(unit, nearbyHostile) <= AUTO_AGGRO_RANGE + unit.range) {
      unit.order = { type: 'attack', targetId: nearbyHostile.id };
      return;
    }

    if (unit.factionId === 'raiders') {
      const target = this.findNearestEnemyUnit(unit, enemies) ?? this.findNearestEnemyBuilding(unit, enemies);
      if (target) unit.order = { type: 'attack', targetId: target.id };
    }
  }

  private updatePlayerAutoDefense(unit: Unit): void {
    if (this.isGatherer(unit) && unit.order.type === 'gather') return;
    if (unit.order.type === 'move' || unit.order.type === 'attack') return;

    const enemies = this.getEnemyFactionIds(unit.factionId);
    const nearbyHostile = this.findNearestEnemyUnit(unit, enemies);
    if (nearbyHostile && this.distance(unit, nearbyHostile) <= AUTO_AGGRO_RANGE + unit.range) {
      unit.order = { type: 'attack', targetId: nearbyHostile.id };
    }
  }

  private getEnemyFactionIds(factionId: string): string[] {
    return Object.values(this.state.factions)
      .filter((faction) => faction.id !== factionId && (this.state.factions[factionId].relations[faction.id] ?? 0) < -20)
      .map((faction) => faction.id);
  }

  private updateAttackOrder(unit: Unit, deltaTime: number): void {
    const target = unit.order.targetId ? this.state.units[unit.order.targetId] ?? this.state.buildings[unit.order.targetId] : null;
    if (!target) {
      unit.order = { type: 'idle' };
      return;
    }

    const distance = this.distance(unit, target);
    if (distance > unit.range) {
      const targetPoint = this.centerOf(target);
      this.ensurePath(unit, targetPoint);
      this.moveAlongPath(unit, deltaTime, Math.max(12, unit.range * 0.75));
      return;
    }

    if (unit.attackCooldown <= 0) {
      target.health -= unit.damage;
      unit.attackCooldown = unit.role === 'archer' ? 1.35 : unit.role === 'cavalry' ? 1.05 : 0.85;
      this.faceTarget(unit, this.centerOf(target));
      this.addCombatEvent(unit.role === 'archer' ? 'arrow' : 'melee', this.centerOf(unit), this.centerOf(target));
    }
  }

  private updateDefendOrder(unit: Unit, deltaTime: number): void {
    const hostile = this.findNearestEnemyUnit(unit, ['raiders']);
    if (hostile && this.distance(unit, hostile) < 230) {
      unit.order = { type: 'attack', targetId: hostile.id };
    } else if (unit.order.target) {
      this.ensurePath(unit, unit.order.target);
      this.moveAlongPath(unit, deltaTime, 10);
    }
  }

  private updateGatherOrder(unit: Unit, deltaTime: number): void {
    if (!unit.order.target || !unit.order.resource || !unit.order.targetTile) return;
    const nearStorage = this.findNearestStorage(unit.factionId, unit);

    if (unit.carryingAmount >= 12 && nearStorage) {
      const storagePoint = unit.order.returning && unit.order.target ? unit.order.target : this.getBuildingStandPoint(nearStorage);
      if (!unit.order.returning) {
        unit.order.returning = true;
        unit.order.target = storagePoint;
        unit.order.path = this.findPath(this.centerOf(unit), storagePoint);
        unit.order.pathTarget = storagePoint;
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
        unit.order.target = this.getTile(unit.order.targetTile.x, unit.order.targetTile.y)
          ? this.getGatherStandPoint(this.getTile(unit.order.targetTile.x, unit.order.targetTile.y)!)
          : unit.order.target;
        unit.order.path = undefined;
        unit.order.pathTarget = undefined;
      }
      return;
    }

    unit.order.returning = false;
    this.ensurePath(unit, unit.order.target);
    if (this.moveAlongPath(unit, deltaTime, 12)) {
      const tile = this.getTile(unit.order.targetTile.x, unit.order.targetTile.y);
      if (!tile || tile.resource !== unit.order.resource || (tile.resourceAmount ?? 0) <= 0) {
        unit.order = { type: 'idle' };
        return;
      }

      const gathered = Math.min(5 * deltaTime, tile.resourceAmount ?? 0);
      tile.resourceAmount = Math.max(0, (tile.resourceAmount ?? 0) - gathered);
      unit.carrying = unit.order.resource;
      unit.carryingAmount += gathered;
      if (Math.floor((unit.carryingAmount - gathered) * 2) !== Math.floor(unit.carryingAmount * 2)) {
        this.addCombatEvent('gather', this.centerOf(unit), this.tileCenter(tile), unit.order.resource, gathered);
      }

      if ((tile.resourceAmount ?? 0) <= 0) {
        this.depleteResourceTile(tile);
      }
    }
  }

  private updateBuildOrder(unit: Unit, deltaTime: number): void {
    const building = unit.order.targetId ? this.state.buildings[unit.order.targetId] : null;
    if (!building || building.complete) {
      unit.order = { type: 'idle' };
      return;
    }

    const site = this.getBuildingStandPoint(building);
    this.ensurePath(unit, site);
    if (!this.moveAlongPath(unit, deltaTime, 36)) return;

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
      this.addCombatEvent('deposit', this.centerOf(building), this.centerOf(building), undefined, 1);
      unit.order = { type: 'idle' };
    }
  }

  private tickEconomy(): void {
    const faction = this.state.factions.player;
    Object.values(this.state.buildings).forEach((building) => {
      if (building.factionId !== 'player') return;
      if (!building.complete) return;
      if (building.type === 'farm') faction.resources.food += 4;
      if (building.type === 'house') faction.resources.population += 0.03;
      if (building.type === 'market') faction.resources.gold += 2;
      if (building.type === 'lumberCamp') faction.resources.wood += 2;
    });

    Object.values(this.state.units).forEach((unit) => {
      if (unit.factionId === 'player' && this.isBuilder(unit) && unit.order.type === 'idle') {
        const blueprint = this.findNearestBlueprint(unit);
        if (blueprint) {
          const target = this.spreadTarget(this.getBuildingStandPoint(blueprint), unit.id, 16);
          unit.order = { type: 'build', targetId: blueprint.id, target, path: this.findPath(this.centerOf(unit), target), pathTarget: target };
          return;
        }
      }

      if (unit.factionId === 'player' && this.isGatherer(unit) && unit.order.type === 'idle') {
        const resource = this.getGatherResourceForUnit(unit);
        const tile = this.findNearestResourceTile(unit, resource);
        if (tile) {
          const target = this.spreadTarget(this.getGatherStandPoint(tile), unit.id, 14);
          unit.order = { type: 'gather', target, targetTile: { x: tile.x, y: tile.y }, resource, path: this.findPath(this.centerOf(unit), target), pathTarget: target };
        }
      }
    });
  }

  private isGatherer(unit: Unit): boolean {
    return ['worker', 'woodcutter', 'stonecutter', 'miner', 'farmer'].includes(unit.role);
  }

  private isBuilder(unit: Unit): boolean {
    return ['worker', 'woodcutter', 'stonecutter', 'miner', 'farmer', 'engineer'].includes(unit.role);
  }

  private getGatherResourceForUnit(unit: Unit): ResourceType {
    if (unit.role === 'woodcutter' || unit.role === 'farmer') return 'wood';
    if (unit.role === 'stonecutter') return 'stone';
    if (unit.role === 'miner') return 'iron';
    return this.getMostNeededGatherResource();
  }

  private getMostNeededGatherResource(): ResourceType {
    const resources = this.state.factions.player.resources;
    if (resources.wood < 180) return 'wood';
    if (resources.stone < 130) return 'stone';
    if (resources.iron < 90) return 'iron';
    return 'wood';
  }

  private tickTowers(): void {
    Object.values(this.state.buildings).forEach((building) => {
      if (building.type !== 'tower') return;
      if (!building.complete) return;
      const target = this.findNearestEnemyUnit(building, ['raiders']);
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
    Object.values(this.state.units).forEach((unit) => {
      if (unit.health >= unit.maxHealth) return;
      const core = this.findNearestBuilding(unit, (building) => building.factionId === unit.factionId && building.type === 'townHall');
      if (core && this.distance(unit, core) <= CITY_HEAL_RADIUS) {
        unit.health = Math.min(unit.maxHealth, unit.health + CITY_HEAL_PER_SECOND);
      }
    });
  }

  private spawnRaid(): void {
    const count = Math.min(3 + Math.floor(this.state.day / 2), 8);
    const roles: UnitRole[] = ['swordsman', 'spearman', 'archer', 'cavalry'];
    for (let i = 0; i < count; i++) {
      const unit = this.createUnit('raiders', roles[i % roles.length], 134 * TILE_SIZE, (74 + i) * TILE_SIZE);
      const target = this.findPlayerCore();
      if (target) unit.order = { type: 'attack', targetId: target.id };
      this.state.units[unit.id] = unit;
    }
    this.log(`发现赤潮袭击队：${count} 名敌军正从东部逼近。`);
  }

  private removeDeadEntities(): void {
    Object.entries(this.state.units).forEach(([id, unit]) => {
      if (unit.health <= 0) {
        if (this.state.activeCommanderId === id) {
          this.state.activeCommanderId = null;
          this.log('将领倒下了，但城邦仍在继续作战。');
        }
        delete this.state.units[id];
      }
    });
    Object.entries(this.state.buildings).forEach(([id, building]) => {
      if (building.health <= 0) {
        delete this.state.buildings[id];
        this.log(`${building.type} 被摧毁了。`);
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

    unit.order.path = this.findPath(this.centerOf(unit), target);
    unit.order.pathTarget = target;
    unit.order.target = target;
  }

  private moveAlongPath(unit: Unit, deltaTime: number, stopDistance: number): boolean {
    const target = unit.order.target;
    if (!target) return true;

    if (!unit.order.path || unit.order.path.length === 0) {
      unit.order.path = this.findPath(this.centerOf(unit), target);
      unit.order.pathTarget = target;
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
    if (moved) return false;

    if (unit.order.path && unit.order.path.length > 1) {
      unit.order.path.shift();
    } else {
      unit.order.path = this.findPath(this.centerOf(unit), target);
      unit.order.pathTarget = target;
    }
    return false;
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
    const units = Object.values(this.state.units);
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];
        const ac = this.centerOf(a);
        const bc = this.centerOf(b);
        let dx = ac.x - bc.x;
        let dy = ac.y - bc.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = UNIT_COLLISION_RADIUS * 2;
        if (distance >= minDistance) continue;
        if (distance === 0) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          distance = Math.sqrt(dx * dx + dy * dy);
        }
        const push = (minDistance - distance) * 0.5;
        this.tryMoveUnit(a, a.x + (dx / distance) * push, a.y + (dy / distance) * push);
        this.tryMoveUnit(b, b.x - (dx / distance) * push, b.y - (dy / distance) * push);
      }
    }
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
    let best: Tile | null = null;
    let bestDistance = Infinity;
    this.state.tiles.forEach((tile) => {
      if (tile.resource !== resource || (tile.resourceAmount ?? 0) <= 0) return;
      const standPoint = this.getGatherStandPoint(tile);
      const distance = this.pointDistance(this.centerOf(unit), standPoint);
      if (distance < bestDistance && this.findPath(this.centerOf(unit), standPoint).length > 0) {
        best = tile;
        bestDistance = distance;
      }
    });
    return best;
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

  private findNearestEnemyUnit(unit: { x: number; y: number; width: number; height: number }, factionIds: string[]): Unit | null {
    let best: Unit | null = null;
    let bestDistance = Infinity;
    Object.values(this.state.units).forEach((candidate) => {
      if (!factionIds.includes(candidate.factionId)) return;
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

    const startKey = this.tileKey(start.x, start.y);
    const endKey = this.tileKey(end.x, end.y);
    const open: Array<{ x: number; y: number; f: number }> = [{ x: start.x, y: start.y, f: 0 }];
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[startKey, 0]]);
    const closed = new Set<string>();

    while (open.length > 0) {
      open.sort((a, b) => a.f - b.f);
      const current = open.shift()!;
      const currentKey = this.tileKey(current.x, current.y);
      if (currentKey === endKey) {
        return this.reconstructPath(cameFrom, currentKey).map((key) => {
          const [x, y] = key.split(':').map(Number);
          return this.tileCenter({ x, y, terrain: 'grass', fertility: 0 });
        });
      }

      closed.add(currentKey);
      for (const neighbor of this.getPathNeighbors(current.x, current.y)) {
        const neighborKey = this.tileKey(neighbor.x, neighbor.y);
        if (closed.has(neighborKey)) continue;

        const tentativeG = (gScore.get(currentKey) ?? Infinity) + neighbor.cost;
        if (tentativeG >= (gScore.get(neighborKey) ?? Infinity)) continue;

        cameFrom.set(neighborKey, currentKey);
        gScore.set(neighborKey, tentativeG);
        const h = Math.abs(neighbor.x - end.x) + Math.abs(neighbor.y - end.y);
        const f = tentativeG + h;
        const existing = open.find((entry) => entry.x === neighbor.x && entry.y === neighbor.y);
        if (existing) {
          existing.f = f;
        } else {
          open.push({ x: neighbor.x, y: neighbor.y, f });
        }
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

    return bestPoint ?? center;
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
    if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return null;
    return this.state.tiles[y * MAP_WIDTH + x] ?? null;
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
