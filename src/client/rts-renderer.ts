import { Building, BuildingType, ResourceType, RtsGameState, TerrainType, Unit, UnitRole } from '../shared/rts-types';

const SPRITE_COLUMNS = ['idle', 'walk1', 'walk2', 'attack'] as const;
const SPRITE_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
const SPRITE_BASE_PATH = '/assets/sprites/';

type SpriteColumn = (typeof SPRITE_COLUMNS)[number];
type SpriteDirection = (typeof SPRITE_DIRECTIONS)[number];

const TERRAIN_COLORS: Record<TerrainType, string> = {
  grass: '#2f7d45',
  forest: '#1f5f38',
  mountain: '#656f72',
  water: '#246a8f',
  road: '#8a6f4c',
  field: '#8aa94d',
  bridge: '#8f6a43',
};

const BUILDING_COLORS: Record<BuildingType, string> = {
  townHall: '#c79b58',
  house: '#9c6f4c',
  farm: '#9fbc4f',
  lumberCamp: '#7f5b3e',
  warehouse: '#a98761',
  barracks: '#8b5564',
  market: '#b58f4a',
  wall: '#8e9794',
  gate: '#7a5a42',
  bridge: '#9a6d41',
  tower: '#7f888d',
};

const BUILDING_LABELS: Record<BuildingType, string> = {
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

const UNIT_LABELS: Record<UnitRole, string> = {
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

export class RtsRenderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private sprites: Partial<Record<UnitRole, HTMLImageElement>> = {};
  private loadedSprites = new Set<UnitRole>();

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.ctx.imageSmoothingEnabled = false;
    this.loadSprites();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.ctx.imageSmoothingEnabled = false;
  }

  render(
    state: RtsGameState,
    camera: { x: number; y: number; zoom: number },
    selection?: { active: boolean; startX: number; startY: number; endX: number; endY: number },
    buildPreview?: { type: BuildingType; x: number; y: number; valid: boolean }
  ): void {
    this.ctx.fillStyle = '#090b0e';
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.save();
    this.ctx.scale(camera.zoom, camera.zoom);
    this.ctx.translate(-camera.x, -camera.y);

    this.drawTerrain(state, camera);
    Object.values(state.buildings).forEach((building) => this.drawBuilding(state, building));
    if (buildPreview) this.drawBuildPreview(state, buildPreview);
    this.drawOrderFeedback(state);
    this.drawCombatEvents(state);
    Object.values(state.units).forEach((unit) => this.drawUnit(state, unit));

    this.ctx.restore();

    if (selection?.active) {
      this.drawSelectionRect(selection);
    }

    this.drawHud(state);
    this.drawMiniMap(state, camera);
  }

  private drawTerrain(state: RtsGameState, camera: { x: number; y: number; zoom: number }): void {
    const tileSize = state.tileSize;
    const startX = Math.max(0, Math.floor(camera.x / tileSize) - 1);
    const startY = Math.max(0, Math.floor(camera.y / tileSize) - 1);
    const endX = Math.min(state.mapWidth, Math.ceil((camera.x + this.width / camera.zoom) / tileSize) + 1);
    const endY = Math.min(state.mapHeight, Math.ceil((camera.y + this.height / camera.zoom) / tileSize) + 1);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tile = state.tiles[y * state.mapWidth + x];
        this.ctx.fillStyle = TERRAIN_COLORS[tile.terrain];
        this.ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);

        if (tile.terrain === 'forest') {
          this.ctx.fillStyle = '#3fa35e';
          this.ctx.fillRect(x * tileSize + 10, y * tileSize + 5, 12, 18);
          this.ctx.fillStyle = '#6b4b35';
          this.ctx.fillRect(x * tileSize + 14, y * tileSize + 18, 4, 10);
        } else if (tile.terrain === 'mountain') {
          this.ctx.fillStyle = '#a7b0aa';
          this.ctx.beginPath();
          this.ctx.moveTo(x * tileSize + 5, y * tileSize + 25);
          this.ctx.lineTo(x * tileSize + 16, y * tileSize + 7);
          this.ctx.lineTo(x * tileSize + 27, y * tileSize + 25);
          this.ctx.fill();
        } else if (tile.terrain === 'bridge') {
          this.ctx.fillStyle = '#9a6d41';
          this.ctx.fillRect(x * tileSize, y * tileSize + 8, tileSize, 16);
          this.ctx.strokeStyle = '#4c3326';
          this.ctx.lineWidth = 2;
          this.ctx.beginPath();
          this.ctx.moveTo(x * tileSize + 4, y * tileSize + 10);
          this.ctx.lineTo(x * tileSize + 28, y * tileSize + 10);
          this.ctx.moveTo(x * tileSize + 4, y * tileSize + 22);
          this.ctx.lineTo(x * tileSize + 28, y * tileSize + 22);
          this.ctx.stroke();
        } else if (tile.terrain === 'field') {
          this.ctx.strokeStyle = 'rgba(70, 83, 36, 0.7)';
          this.ctx.lineWidth = 1;
          for (let i = 6; i < tileSize; i += 7) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * tileSize + i, y * tileSize + 3);
            this.ctx.lineTo(x * tileSize + i - 5, y * tileSize + 29);
            this.ctx.stroke();
          }
        }
      }
    }
  }

  private drawBuilding(state: RtsGameState, building: Building): void {
    const faction = state.factions[building.factionId];
    if (!building.complete) {
      this.ctx.save();
      this.ctx.globalAlpha = 0.48;
    }
    this.ctx.fillStyle = BUILDING_COLORS[building.type];
    this.ctx.fillRect(building.x, building.y, building.width, building.height);
    this.ctx.strokeStyle = faction?.color ?? '#ffffff';
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(building.x, building.y, building.width, building.height);

    if (building.type === 'wall' || building.type === 'gate') {
      this.ctx.fillStyle = building.type === 'gate' ? '#4f3328' : '#6f7778';
      this.ctx.fillRect(building.x + 4, building.y + 4, building.width - 8, building.height - 8);
      this.ctx.fillStyle = 'rgba(255,255,255,0.2)';
      this.ctx.fillRect(building.x + 4, building.y + 4, building.width - 8, 4);
    } else if (building.type === 'tower') {
      this.ctx.fillStyle = '#515b60';
      this.ctx.fillRect(building.x + 5, building.y + 7, building.width - 10, building.height - 5);
      this.ctx.fillStyle = '#c9d0cb';
      this.ctx.fillRect(building.x + 8, building.y + 4, building.width - 16, 8);
      this.ctx.fillStyle = '#252b30';
      this.ctx.fillRect(building.x + 13, building.y + 17, 6, 10);
    } else if (building.type === 'bridge') {
      this.ctx.fillStyle = '#9a6d41';
      this.ctx.fillRect(building.x, building.y + 8, building.width, building.height - 16);
      this.ctx.strokeStyle = '#4c3326';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(building.x + 3, building.y + 10);
      this.ctx.lineTo(building.x + building.width - 3, building.y + 10);
      this.ctx.moveTo(building.x + 3, building.y + building.height - 10);
      this.ctx.lineTo(building.x + building.width - 3, building.y + building.height - 10);
      this.ctx.stroke();
    } else if (building.type === 'townHall') {
      this.drawCastleKeep(building);
    } else if (building.type === 'barracks') {
      this.drawRoofedBuilding(building, '#71394a', '#c9d0cb');
    } else if (building.type === 'market') {
      this.drawRoofedBuilding(building, '#b58f4a', '#f2d075');
    } else if (building.type === 'warehouse') {
      this.drawCrateBuilding(building);
    } else if (building.type === 'farm') {
      this.drawFarmBuilding(building);
    }

    if (!building.complete) {
      this.ctx.restore();
      this.drawConstructionOverlay(building);
    }

    this.drawHealthBar(building.x, building.y - 7, building.width, building.health, building.maxHealth, building.complete ? '#ff5261' : '#ffd166');
  }

  private drawConstructionOverlay(building: Building): void {
    const progress = Math.max(0, Math.min(1, building.progress));
    this.ctx.strokeStyle = '#ffd166';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 5]);
    this.ctx.strokeRect(building.x + 2, building.y + 2, building.width - 4, building.height - 4);
    this.ctx.setLineDash([]);

    const barWidth = Math.max(24, building.width);
    this.ctx.fillStyle = 'rgba(8, 10, 12, 0.86)';
    this.ctx.fillRect(building.x, building.y + building.height + 3, barWidth, 5);
    this.ctx.fillStyle = '#ffd166';
    this.ctx.fillRect(building.x, building.y + building.height + 3, barWidth * progress, 5);

    this.ctx.fillStyle = '#f4f7ee';
    this.ctx.font = '10px Consolas, monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`${Math.floor(progress * 100)}%`, building.x + building.width / 2, building.y + building.height + 18);
  }

  private drawCastleKeep(building: Building): void {
    this.ctx.fillStyle = '#707b7c';
    this.ctx.fillRect(building.x + 8, building.y + 22, building.width - 16, building.height - 24);
    this.ctx.fillStyle = '#545f62';
    this.ctx.fillRect(building.x + 6, building.y + 10, 22, building.height - 12);
    this.ctx.fillRect(building.x + building.width - 28, building.y + 10, 22, building.height - 12);
    this.ctx.fillStyle = '#c8d1ca';
    for (let x = building.x + 8; x < building.x + building.width - 8; x += 14) {
      this.ctx.fillRect(x, building.y + 8, 8, 8);
    }
    this.ctx.fillStyle = '#2b2524';
    this.ctx.fillRect(building.x + building.width / 2 - 8, building.y + building.height - 22, 16, 22);
    this.ctx.fillStyle = '#ffd166';
    this.ctx.fillRect(building.x + building.width / 2 - 2, building.y + 4, 4, 18);
    this.ctx.fillStyle = '#ff5261';
    this.ctx.fillRect(building.x + building.width / 2 + 2, building.y + 5, 16, 8);
  }

  private drawRoofedBuilding(building: Building, wall: string, roof: string): void {
    this.ctx.fillStyle = wall;
    this.ctx.fillRect(building.x + 8, building.y + 20, building.width - 16, building.height - 24);
    this.ctx.fillStyle = roof;
    this.ctx.beginPath();
    this.ctx.moveTo(building.x + 4, building.y + 22);
    this.ctx.lineTo(building.x + building.width / 2, building.y + 4);
    this.ctx.lineTo(building.x + building.width - 4, building.y + 22);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.fillStyle = '#211b1c';
    this.ctx.fillRect(building.x + building.width / 2 - 6, building.y + building.height - 18, 12, 18);
  }

  private drawCrateBuilding(building: Building): void {
    this.ctx.fillStyle = '#8b6848';
    this.ctx.fillRect(building.x + 8, building.y + 8, building.width - 16, building.height - 16);
    this.ctx.strokeStyle = '#3a2a22';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.moveTo(building.x + 10, building.y + 10);
    this.ctx.lineTo(building.x + building.width - 10, building.y + building.height - 10);
    this.ctx.moveTo(building.x + building.width - 10, building.y + 10);
    this.ctx.lineTo(building.x + 10, building.y + building.height - 10);
    this.ctx.stroke();
  }

  private drawFarmBuilding(building: Building): void {
    this.ctx.fillStyle = '#8aa94d';
    this.ctx.fillRect(building.x + 4, building.y + 4, building.width - 8, building.height - 8);
    this.ctx.strokeStyle = '#536526';
    this.ctx.lineWidth = 2;
    for (let x = building.x + 12; x < building.x + building.width - 6; x += 12) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, building.y + 8);
      this.ctx.lineTo(x - 8, building.y + building.height - 8);
      this.ctx.stroke();
    }
  }

  private drawUnit(state: RtsGameState, unit: Unit): void {
    const frame = unit.order.type === 'attack' && unit.attackCooldown > 0.55 ? 'attack' : this.getCharacterFrame(unit.id, unit.direction);
    if (!this.drawSprite(unit.role, unit.x, unit.y, unit.direction, frame)) {
      this.ctx.fillStyle = state.factions[unit.factionId]?.color ?? '#ffffff';
      this.ctx.fillRect(unit.x, unit.y, unit.width, unit.height);
    }

    if (unit.selected) {
      this.ctx.strokeStyle = '#50d9ff';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(unit.x - 3, unit.y - 3, unit.width + 6, unit.height + 6);
    }

    if (unit.role === 'commander') {
      this.ctx.strokeStyle = 'rgba(255, 209, 102, 0.85)';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(unit.x - 5, unit.y - 5, unit.width + 10, unit.height + 10);
    }

    this.drawCarryBadge(unit);
    this.drawHealthBar(unit.x, unit.y - 7, unit.width, unit.health, unit.maxHealth, unit.factionId === 'player' ? '#39ff88' : '#ff5261');
  }

  private drawCarryBadge(unit: Unit): void {
    if (!unit.carrying || unit.carryingAmount <= 0.5) return;

    const x = unit.x + unit.width - 7;
    const y = unit.y + 2;
    const color = this.getResourceColor(unit.carrying);
    this.ctx.fillStyle = 'rgba(8, 10, 12, 0.82)';
    this.ctx.fillRect(x - 7, y - 2, 18, 15);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x - 4, y + 1, 6, 6);
    this.ctx.fillStyle = '#f4f7ee';
    this.ctx.font = '9px Consolas, monospace';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`${Math.floor(unit.carryingAmount)}`, x + 3, y + 8);
  }

  private drawHealthBar(x: number, y: number, width: number, health: number, maxHealth: number, color: string): void {
    const pct = Math.max(0, Math.min(1, health / maxHealth));
    this.ctx.fillStyle = '#111111';
    this.ctx.fillRect(x, y, width, 4);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, width * pct, 4);
  }

  private drawBuildPreview(state: RtsGameState, preview: { type: BuildingType; x: number; y: number; valid: boolean }): void {
    const size = state.tileSize;
    const dims: Record<BuildingType, { width: number; height: number }> = {
      townHall: { width: 3, height: 3 },
      house: { width: 2, height: 2 },
      farm: { width: 3, height: 3 },
      lumberCamp: { width: 2, height: 2 },
      warehouse: { width: 2, height: 2 },
      barracks: { width: 3, height: 2 },
      market: { width: 3, height: 2 },
      wall: { width: 1, height: 1 },
      gate: { width: 1, height: 1 },
      bridge: { width: 1, height: 1 },
      tower: { width: 1, height: 1 },
    };
    const dim = dims[preview.type];
    this.ctx.save();
    this.ctx.globalAlpha = 0.45;
    this.ctx.fillStyle = preview.valid ? '#39ff88' : '#ff5261';
    this.ctx.fillRect(preview.x, preview.y, dim.width * size, dim.height * size);
    this.ctx.globalAlpha = 0.9;
    this.ctx.strokeStyle = preview.valid ? '#d7ffe8' : '#ffd0d4';
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(preview.x, preview.y, dim.width * size, dim.height * size);
    this.ctx.restore();
  }

  private drawOrderFeedback(state: RtsGameState): void {
    state.selectedUnitIds.forEach((id) => {
      const unit = state.units[id];
      if (!unit) return;

      const start = { x: unit.x + unit.width / 2, y: unit.y + unit.height / 2 };
      if (unit.order.type === 'move' && unit.order.target) {
        this.drawCommandLine(start.x, start.y, unit.order.target.x, unit.order.target.y, '#50d9ff');
        this.drawMoveMarker(unit.order.target.x, unit.order.target.y);
      } else if (unit.order.type === 'attack' && unit.order.targetId) {
        const target = state.units[unit.order.targetId] ?? state.buildings[unit.order.targetId];
        if (target) {
          const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
          this.drawCommandLine(start.x, start.y, end.x, end.y, '#ff5261');
          this.drawAttackMarker(end.x, end.y);
        }
      } else if (unit.order.type === 'gather') {
        const target =
          unit.order.targetTile
            ? {
                x: unit.order.targetTile.x * state.tileSize + state.tileSize / 2,
                y: unit.order.targetTile.y * state.tileSize + state.tileSize / 2,
              }
            : unit.order.target;
        if (target) {
          this.drawCommandLine(start.x, start.y, target.x, target.y, '#ffd166');
          this.drawGatherMarker(target.x, target.y, unit.order.resource);
        }
      } else if (unit.order.type === 'build' && unit.order.targetId) {
        const target = state.buildings[unit.order.targetId];
        if (target) {
          const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
          this.drawCommandLine(start.x, start.y, end.x, end.y, '#ffd166');
          this.drawBuildMarker(end.x, end.y);
        }
      }

      unit.order.path?.forEach((point, index) => {
        if (index % 2 !== 0) return;
        this.ctx.fillStyle = 'rgba(80, 217, 255, 0.22)';
        this.ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
      });
    });
  }

  private drawCommandLine(fromX: number, fromY: number, toX: number, toY: number, color: string): void {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.globalAlpha = 0.65;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 7]);
    this.ctx.beginPath();
    this.ctx.moveTo(fromX, fromY);
    this.ctx.lineTo(toX, toY);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawMoveMarker(x: number, y: number): void {
    const pulse = Math.sin(Date.now() / 160) * 3;
    this.ctx.save();
    this.ctx.strokeStyle = '#50d9ff';
    this.ctx.lineWidth = 3;
    this.ctx.globalAlpha = 0.85;
    this.ctx.beginPath();
    this.ctx.arc(x, y, 10 + pulse, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(x, y - 16);
    this.ctx.lineTo(x, y + 16);
    this.ctx.moveTo(x - 16, y);
    this.ctx.lineTo(x + 16, y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawAttackMarker(x: number, y: number): void {
    const size = 18 + Math.sin(Date.now() / 140) * 3;
    this.ctx.save();
    this.ctx.strokeStyle = '#ff5261';
    this.ctx.lineWidth = 3;
    this.ctx.globalAlpha = 0.9;
    this.ctx.beginPath();
    this.ctx.moveTo(x - size, y - size);
    this.ctx.lineTo(x + size, y + size);
    this.ctx.moveTo(x + size, y - size);
    this.ctx.lineTo(x - size, y + size);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawGatherMarker(x: number, y: number, resource?: ResourceType): void {
    const color = resource ? this.getResourceColor(resource) : '#ffd166';
    const pulse = Math.sin(Date.now() / 180) * 2;
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = 0.9;
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.arc(x, y, 11 + pulse, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.fillRect(x - 4, y - 4, 8, 8);
    this.ctx.restore();
  }

  private drawBuildMarker(x: number, y: number): void {
    const pulse = Math.sin(Date.now() / 160) * 2;
    this.ctx.save();
    this.ctx.strokeStyle = '#ffd166';
    this.ctx.fillStyle = '#ffd166';
    this.ctx.globalAlpha = 0.9;
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(x - 12 - pulse, y - 12 - pulse, 24 + pulse * 2, 24 + pulse * 2);
    this.ctx.fillRect(x - 2, y - 14, 4, 28);
    this.ctx.fillRect(x - 14, y - 2, 28, 4);
    this.ctx.restore();
  }

  private drawCombatEvents(state: RtsGameState): void {
    state.combatEvents.forEach((event) => {
      const age = Date.now() - event.createdAt;
      const progress = Math.min(1, age / 650);
      const alpha = 1 - progress;
      this.ctx.save();
      this.ctx.globalAlpha = alpha;

      if (event.kind === 'arrow') {
        const x = event.x + (event.targetX - event.x) * progress;
        const y = event.y + (event.targetY - event.y) * progress;
        const angle = Math.atan2(event.targetY - event.y, event.targetX - event.x);
        this.ctx.strokeStyle = '#f4e7b2';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(x - Math.cos(angle) * 12, y - Math.sin(angle) * 12);
        this.ctx.lineTo(x + Math.cos(angle) * 12, y + Math.sin(angle) * 12);
        this.ctx.stroke();
      } else if (event.kind === 'melee') {
        this.ctx.strokeStyle = '#ffd166';
        this.ctx.lineWidth = 6;
        this.ctx.beginPath();
        this.ctx.arc(event.targetX, event.targetY, 18 + progress * 10, -0.7, 1.3);
        this.ctx.stroke();
      } else if (event.kind === 'gather') {
        const color = event.resource ? this.getResourceColor(event.resource) : '#ffd166';
        this.ctx.strokeStyle = color;
        this.ctx.fillStyle = color;
        this.ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const angle = progress * Math.PI * 2 + i * 2.1;
          const px = event.targetX + Math.cos(angle) * (8 + progress * 10);
          const py = event.targetY + Math.sin(angle) * (8 + progress * 10);
          this.ctx.fillRect(px - 2, py - 2, 4, 4);
        }
      } else if (event.kind === 'deposit') {
        const color = event.resource ? this.getResourceColor(event.resource) : '#39ff88';
        const label = `+${Math.max(1, Math.floor(event.amount ?? 0))}`;
        this.ctx.fillStyle = color;
        this.ctx.font = 'bold 14px Consolas, monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(label, event.x, event.y - 18 - progress * 20);
      } else if (event.kind === 'build') {
        this.ctx.strokeStyle = '#ffd166';
        this.ctx.fillStyle = '#fff0b8';
        this.ctx.lineWidth = 2;
        const angle = progress * Math.PI * 4;
        this.ctx.beginPath();
        this.ctx.moveTo(event.x, event.y);
        this.ctx.lineTo(event.targetX + Math.cos(angle) * 12, event.targetY + Math.sin(angle) * 12);
        this.ctx.stroke();
        this.ctx.fillRect(event.targetX - 3, event.targetY - 3 - progress * 10, 6, 6);
      }

      if (progress > 0.75 && (event.kind === 'arrow' || event.kind === 'melee')) {
        this.ctx.strokeStyle = '#ff5261';
        this.ctx.lineWidth = 3;
        const size = 5 + progress * 8;
        this.ctx.beginPath();
        this.ctx.moveTo(event.targetX - size, event.targetY);
        this.ctx.lineTo(event.targetX + size, event.targetY);
        this.ctx.moveTo(event.targetX, event.targetY - size);
        this.ctx.lineTo(event.targetX, event.targetY + size);
        this.ctx.stroke();
      }

      this.ctx.restore();
    });
  }

  private drawSelectionRect(selection: { startX: number; startY: number; endX: number; endY: number }): void {
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    this.ctx.fillStyle = 'rgba(80, 217, 255, 0.12)';
    this.ctx.fillRect(x, y, width, height);
    this.ctx.strokeStyle = '#50d9ff';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, width, height);
  }

  private drawHud(state: RtsGameState): void {
    const player = state.factions.player;
    this.ctx.fillStyle = 'rgba(7, 9, 12, 0.86)';
    this.ctx.fillRect(0, 0, this.width, 74);

    this.ctx.fillStyle = '#f4f7ee';
    this.ctx.font = 'bold 13px Consolas, monospace';
    this.ctx.textAlign = 'left';
    const modeText = state.activeCommanderId ? '将领' : state.buildMode ? `建造 ${BUILDING_LABELS[state.buildMode]}` : '指挥';
    this.ctx.fillText(`第 ${state.day} 天   模式：${modeText}`, 12, 21);
    this.ctx.fillText(
      `粮食 ${Math.floor(player.resources.food)}  木材 ${Math.floor(player.resources.wood)}  石材 ${Math.floor(player.resources.stone)}  铁 ${Math.floor(player.resources.iron)}  金币 ${Math.floor(player.resources.gold)}  人口 ${Math.floor(player.resources.population)}`,
      12,
      45
    );

    this.ctx.fillStyle = '#9aa79b';
    this.ctx.font = '12px Consolas, monospace';
    const selected = state.selectedUnitIds
      .map((id) => {
        const role = state.units[id]?.role;
        return role ? UNIT_LABELS[role] : null;
      })
      .filter(Boolean)
      .slice(0, 9)
      .join(', ');
    this.ctx.fillStyle = '#f4f7ee';
    this.ctx.fillText(`已选：${selected || '无'}`, 12, 65);

    const log = state.diplomacyLog.slice(0, 2).map((event) => event.message).join('  |  ');
    this.ctx.fillStyle = '#ffd166';
    this.ctx.fillText(log, 360, 65);
  }

  private drawMiniMap(state: RtsGameState, camera: { x: number; y: number; zoom: number }): void {
    const mapWidth = state.mapWidth * state.tileSize;
    const mapHeight = state.mapHeight * state.tileSize;
    const width = Math.min(168, Math.max(118, this.width * 0.22));
    const height = width * (mapHeight / mapWidth);
    const x = this.width - width - 12;
    const y = 86;
    const scaleX = width / mapWidth;
    const scaleY = height / mapHeight;

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(7, 9, 12, 0.82)';
    this.ctx.fillRect(x, y, width, height);
    this.ctx.strokeStyle = 'rgba(244, 247, 238, 0.35)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, width, height);

    Object.values(state.units).forEach((unit) => {
      const cx = x + (unit.x + unit.width / 2) * scaleX;
      const cy = y + (unit.y + unit.height / 2) * scaleY;
      if (unit.factionId === 'player' && unit.role === 'commander') {
        this.ctx.fillStyle = '#ffd166';
      } else if (unit.factionId === 'player') {
        this.ctx.fillStyle = '#39ff88';
      } else if ((state.factions.player.relations[unit.factionId] ?? 0) < -20) {
        this.ctx.fillStyle = '#ff5261';
      } else {
        this.ctx.fillStyle = '#9aa79b';
      }
      this.ctx.fillRect(cx - 2, cy - 2, 4, 4);
    });

    const viewX = x + camera.x * scaleX;
    const viewY = y + camera.y * scaleY;
    const viewW = (this.width / camera.zoom) * scaleX;
    const viewH = (this.height / camera.zoom) * scaleY;
    this.ctx.strokeStyle = '#50d9ff';
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(viewX, viewY, viewW, viewH);

    this.ctx.restore();
  }

  private loadSprites(): void {
    const roles: UnitRole[] = ['commander', 'worker', 'woodcutter', 'stonecutter', 'miner', 'farmer', 'trader', 'swordsman', 'spearman', 'archer', 'cavalry', 'engineer', 'guard'];
    roles.forEach((role) => {
      const image = new Image();
      image.onload = () => this.loadedSprites.add(role);
      image.src = `${SPRITE_BASE_PATH}${role}.png`;
      this.sprites[role] = image;
    });
  }

  private drawSprite(role: UnitRole, x: number, y: number, direction: SpriteDirection, frame: SpriteColumn): boolean {
    const sprite = this.sprites[role];
    if (!sprite || !this.loadedSprites.has(role)) return false;
    const sourceWidth = sprite.naturalWidth / SPRITE_COLUMNS.length;
    const sourceHeight = sprite.naturalHeight / SPRITE_DIRECTIONS.length;
    const sourceX = SPRITE_COLUMNS.indexOf(frame) * sourceWidth;
    const sourceY = SPRITE_DIRECTIONS.indexOf(direction) * sourceHeight;
    this.ctx.drawImage(sprite, sourceX, sourceY, sourceWidth, sourceHeight, Math.round(x), Math.round(y), 32, 32);
    return true;
  }

  private getCharacterFrame(id: string, direction: SpriteDirection): SpriteColumn {
    if (direction === 'up') return 'idle';
    const tick = Math.floor((Date.now() + this.hashId(id)) / 220) % 4;
    if (tick === 1) return 'walk1';
    if (tick === 3) return 'walk2';
    return 'idle';
  }

  private getResourceColor(resource: ResourceType): string {
    const colors: Record<ResourceType, string> = {
      food: '#d7f27d',
      wood: '#b47a45',
      stone: '#c7cec8',
      iron: '#9ec5d6',
      gold: '#ffd166',
      population: '#f4f7ee',
    };
    return colors[resource];
  }

  private hashId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(hash);
  }
}
