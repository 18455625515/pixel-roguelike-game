import { BuildingType, ResourceType, RtsVector, TerrainType, UnitRole } from '../shared/rts-types';
import { RtsRenderer } from './rts-renderer';
import { RtsWorld } from './rts-world';

type TouchMode = 'command' | 'build' | 'recruit' | 'commander';

const TAP_THRESHOLD = 10;
const SELECT_DRAG_THRESHOLD = 22;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.8;

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const modePanel = document.getElementById('modePanel')!;
const actionPanel = document.getElementById('actionPanel')!;
const topStatus = document.getElementById('topStatus')!;
const resourceStatus = document.getElementById('resourceStatus')!;

const world = new RtsWorld();
const renderer = new RtsRenderer(ctx, 1000, 720);

const camera = {
  x: 300,
  y: 760,
  zoom: 1,
};

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const nextWidth = Math.max(320, Math.floor(rect.width));
  const nextHeight = Math.max(320, Math.floor(rect.height));
  if (canvas.width === nextWidth && canvas.height === nextHeight) return;
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  ctx.imageSmoothingEnabled = false;
  renderer.resize(nextWidth, nextHeight);
  clampCamera();
}

const selection = {
  active: false,
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
};

let mode: TouchMode = 'command';
let selectedBuild: BuildingType | null = null;
let lastTime = Date.now();
let pointerDown = false;
let dragStarted = false;
let panStarted = false;
let pointerStartOnFriendly = false;
let pointerStartScreen: RtsVector = { x: 0, y: 0 };
let pointerLastScreen: RtsVector = { x: 0, y: 0 };
let pointerCurrentWorld: RtsVector = { x: 0, y: 0 };
let pinchStartDistance = 0;
let pinchStartZoom = 1;
let pinchStartCenterWorld: RtsVector = { x: 0, y: 0 };
let lastWallTile = '';
let viewedBuildingId: string | null = null;
let followedUnitId: string | null = null;
const activePointers = new Map<number, PointerEvent>();
let interactionHint = '点单位选择，点地面移动，点敌人攻击，点资源采集';

const buildOptions: Array<{ type: BuildingType; label: string }> = [
  { type: 'farm', label: '农田' },
  { type: 'wall', label: '城墙' },
  { type: 'gate', label: '城门' },
  { type: 'bridge', label: '桥梁' },
  { type: 'tower', label: '箭塔' },
  { type: 'barracks', label: '兵营' },
  { type: 'market', label: '市场' },
];

const recruitOptions: Array<{ role: UnitRole; label: string }> = [
  { role: 'woodcutter', label: '伐木工' },
  { role: 'stonecutter', label: '采石工' },
  { role: 'miner', label: '矿工' },
  { role: 'swordsman', label: '剑盾兵' },
  { role: 'spearman', label: '长矛兵' },
  { role: 'archer', label: '弓箭手' },
  { role: 'cavalry', label: '骑兵' },
  { role: 'engineer', label: '工兵' },
];

function joinGame(): void {
  document.getElementById('joinDialog')!.style.display = 'none';
  document.getElementById('gameContainer')!.style.display = 'flex';
  renderActionPanel();
}

function setCommandMode(): void {
  mode = 'command';
  selectedBuild = null;
  world.setBuildMode(null);
  if (world.state.activeCommanderId) world.toggleCommanderControl();
  interactionHint = '点单位选择，点地面移动，点敌人攻击，点资源采集';
  renderActionPanel();
}

function enterRecruitMode(): void {
  mode = 'recruit';
  selectedBuild = null;
  viewedBuildingId = null;
  world.setBuildMode(null);
  if (world.state.activeCommanderId) world.toggleCommanderControl();
  interactionHint = '选择兵种后会从主城或兵营招募';
  renderActionPanel();
}

function enterBuildMode(type: BuildingType): void {
  mode = 'build';
  selectedBuild = type;
  viewedBuildingId = null;
  world.setBuildMode(type);
  interactionHint = `建造：${getBuildingName(type)}${type === 'wall' ? '，拖动可连续建造' : '，点地图放置'}`;
  renderActionPanel();
}

function toggleCommanderMode(): void {
  mode = mode === 'commander' ? 'command' : 'commander';
  viewedBuildingId = null;
  selectedBuild = null;
  world.setBuildMode(null);

  if (mode === 'commander') {
    if (!world.state.activeCommanderId) world.toggleCommanderControl();
    interactionHint = '将领模式：按住并拖动屏幕控制将领';
  } else {
    if (world.state.activeCommanderId) world.toggleCommanderControl();
    interactionHint = '已退出将领控制';
  }

  renderActionPanel();
}

function renderActionPanel(): void {
  renderModePanel();
  actionPanel.innerHTML = '';

  if (viewedBuildingId) {
    const building = world.state.buildings[viewedBuildingId];
    if (building) {
      addDisabledButton(`${getBuildingName(building.type)} ${Math.ceil(building.health)}/${building.maxHealth}`);

      if (building.type === 'townHall' || building.type === 'barracks') {
        recruitOptions.forEach((option) => {
          const button = makeActionButton(option.label, false);
          button.addEventListener('click', () => {
            const ok = world.recruit(option.role);
            interactionHint = ok ? `已招募：${option.label}` : `资源不足，无法招募：${option.label}`;
            renderActionPanel();
          });
          actionPanel.appendChild(button);
        });
      }

      if (building.type === 'townHall' || building.type === 'warehouse' || building.type === 'barracks') {
        buildOptions.forEach((option) => {
          const button = makeActionButton(`建${option.label}`, false);
          button.addEventListener('click', () => enterBuildMode(option.type));
          actionPanel.appendChild(button);
        });
      }

      if (building.type !== 'townHall') {
        const recycle = makeActionButton('回收', true);
        recycle.addEventListener('click', () => {
          world.recycleBuildingAt({ x: building.x + building.width / 2, y: building.y + building.height / 2 });
          viewedBuildingId = null;
          interactionHint = `${getBuildingName(building.type)}已回收，返还一半材料`;
          renderActionPanel();
        });
        actionPanel.appendChild(recycle);
      }

      const close = makeActionButton('关闭', false);
      close.addEventListener('click', () => {
        viewedBuildingId = null;
        interactionHint = '已关闭建筑信息';
        renderActionPanel();
      });
      actionPanel.appendChild(close);
      return;
    }
    viewedBuildingId = null;
  }

  if (mode === 'recruit') {
    recruitOptions.forEach((option) => {
      const button = makeActionButton(option.label, false);
      button.addEventListener('click', () => {
        const ok = world.recruit(option.role);
        interactionHint = ok ? `已招募：${option.label}` : `资源不足，无法招募：${option.label}`;
        renderActionPanel();
      });
      actionPanel.appendChild(button);
    });
    addUtilityButton('主城', focusTownHall);
    return;
  }

  if (mode === 'build' && !selectedBuild) {
    buildOptions.forEach((option) => {
      const button = makeActionButton(option.label, false);
      button.addEventListener('click', () => enterBuildMode(option.type));
      actionPanel.appendChild(button);
    });
    addUtilityButton('主城', focusTownHall);
    return;
  }

  if (mode === 'build' && selectedBuild) {
    addDisabledButton(`正在建造：${getBuildingName(selectedBuild)}`);
    const cancel = makeActionButton('取消', true);
    cancel.addEventListener('click', setCommandMode);
    actionPanel.appendChild(cancel);
    return;
  }

  if (mode === 'commander') {
    addDisabledButton('拖动移动将领');
    const exit = makeActionButton('退出', true);
    exit.addEventListener('click', toggleCommanderMode);
    actionPanel.appendChild(exit);
    return;
  }

  addUtilityButton('军队', selectAllCombatUnits);
  addUtilityButton('工人', selectAllWorkers);
  addUtilityButton('主城', focusTownHall);
  addDisabledButton(interactionHint);
}

function renderModePanel(): void {
  modePanel.innerHTML = '';
  addModeButton('指挥', mode === 'command' && !viewedBuildingId, setCommandMode);
  addModeButton('建造', mode === 'build', () => {
    mode = 'build';
    selectedBuild = null;
    viewedBuildingId = null;
    world.setBuildMode(null);
    interactionHint = '选择建筑后，点地图放置';
    renderActionPanel();
  });
  addModeButton('招募', mode === 'recruit', enterRecruitMode);
  addModeButton('将领', mode === 'commander', toggleCommanderMode);
  addModeButton('取消', false, cancelCurrentAction);
}

function addModeButton(label: string, active: boolean, action: () => void): void {
  const button = makeActionButton(label, active);
  button.addEventListener('click', action);
  modePanel.appendChild(button);
}

function addUtilityButton(label: string, action: () => void): void {
  const button = makeActionButton(label, false);
  button.addEventListener('click', action);
  actionPanel.appendChild(button);
}

function addDisabledButton(label: string): void {
  const button = makeActionButton(label, false);
  button.disabled = true;
  actionPanel.appendChild(button);
}

function selectUnits(predicate: (role: UnitRole) => boolean, hint: string): void {
  const ids: string[] = [];
  Object.values(world.state.units).forEach((unit) => {
    const selected = unit.factionId === 'player' && predicate(unit.role);
    unit.selected = selected;
    if (selected) ids.push(unit.id);
  });
  world.state.selectedUnitIds = ids;
  viewedBuildingId = null;
  setFollowedUnit(ids.length === 1 ? ids[0] : null);
  interactionHint = `${hint}: ${ids.length}`;
  renderActionPanel();
}

function selectAllCombatUnits(): void {
  selectUnits((role) => !['worker', 'woodcutter', 'stonecutter', 'miner', 'farmer', 'trader'].includes(role), '已选择军队');
}

function selectAllWorkers(): void {
  selectUnits((role) => ['worker', 'woodcutter', 'stonecutter', 'miner', 'farmer', 'trader', 'engineer'].includes(role), '已选择工人');
}

function focusTownHall(): void {
  const hall = Object.values(world.state.buildings).find((building) => building.factionId === 'player' && building.type === 'townHall');
  if (!hall) return;
  camera.x = hall.x + hall.width / 2 - canvas.width / camera.zoom / 2;
  camera.y = hall.y + hall.height / 2 - canvas.height / camera.zoom / 2;
  setFollowedUnit(null);
  clampCamera();
}

function cancelCurrentAction(): void {
  viewedBuildingId = null;
  setCommandMode();
}

function makeActionButton(label: string, active: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `touchBtn${active ? ' active' : ''}`;
  button.textContent = label;
  return button;
}

function screenToWorld(clientX: number, clientY: number): RtsVector {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: camera.x + ((clientX - rect.left) * scaleX) / camera.zoom,
    y: camera.y + ((clientY - rect.top) * scaleY) / camera.zoom,
  };
}

function screenPoint(clientX: number, clientY: number): RtsVector {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height),
  };
}

function handleTap(worldPoint: RtsVector): void {
  if (mode === 'build' && selectedBuild) {
    const placed = world.placeBuilding(selectedBuild, worldPoint);
    interactionHint = placed ? `已建造：${getBuildingName(selectedBuild)}` : `这里不能建造：${getBuildingName(selectedBuild)}`;
    if (placed && selectedBuild !== 'wall') setCommandMode();
    else renderActionPanel();
    return;
  }

  const target = world.getUnitAt(worldPoint);
  const building = world.getBuildingAt(worldPoint);

  if (target?.factionId === 'player') {
    world.selectSingleUnit(worldPoint);
    setFollowedUnit(null);
    viewedBuildingId = null;
    interactionHint = `已选中：${getUnitName(target.role)}`;
    renderActionPanel();
    return;
  }

  if (building?.factionId === 'player') {
    if (!building.complete && world.state.selectedUnitIds.length > 0) {
      const ok = world.commandSelectedBuild(building.id);
      interactionHint = ok ? `前往施工：${getBuildingName(building.type)}` : '需要选择工人或工兵才能施工';
      renderActionPanel();
      return;
    }
    viewedBuildingId = building.id;
    interactionHint = `建筑：${getBuildingName(building.type)}`;
    renderActionPanel();
    return;
  }

  if (target && target.factionId !== 'player') {
    world.commandSelectedAttack(target.id);
    interactionHint = `攻击目标：${getUnitName(target.role)}`;
    renderActionPanel();
    return;
  }

  if (building && building.factionId !== 'player') {
    world.commandSelectedAttack(building.id);
    interactionHint = `攻击建筑：${getBuildingName(building.type)}`;
    renderActionPanel();
    return;
  }

  const resource = world.getResourceAt(worldPoint);
  if (resource) {
    const ok = world.commandSelectedGather(worldPoint);
    const amount = Math.floor(world.getTileInfoAt(worldPoint)?.resourceAmount ?? 0);
    interactionHint = ok ? `采集资源：${getResourceName(resource)} ${amount}` : `需要先选择工人，再采集${getResourceName(resource)}`;
    renderActionPanel();
    return;
  }

  if (world.state.selectedUnitIds.length > 0) {
    world.commandSelectedMove(worldPoint);
    setFollowedUnit(world.state.selectedUnitIds.length === 1 ? world.state.selectedUnitIds[0] : null);
    interactionHint = '移动命令已下达';
  } else {
    const tile = world.getTileInfoAt(worldPoint);
    interactionHint = tile ? `地形：${getTerrainName(tile.terrain)}` : '地图边界';
  }
  renderActionPanel();
}

canvas.addEventListener('pointerdown', (event) => {
  if ((event.target as HTMLElement).closest('.touchHud')) return;
  canvas.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, event);

  if (activePointers.size === 2) {
    beginPinch();
    pointerDown = false;
    selection.active = false;
    panStarted = true;
    setFollowedUnit(null);
    return;
  }

  if (activePointers.size > 1) return;

  pointerDown = true;
  dragStarted = false;
  panStarted = false;
  pointerStartScreen = screenPoint(event.clientX, event.clientY);
  pointerLastScreen = pointerStartScreen;
  pointerCurrentWorld = screenToWorld(event.clientX, event.clientY);
  pointerStartOnFriendly = world.getUnitAt(pointerCurrentWorld)?.factionId === 'player';
  lastWallTile = '';

  selection.active = false;
  selection.startX = pointerStartScreen.x;
  selection.startY = pointerStartScreen.y;
  selection.endX = pointerStartScreen.x;
  selection.endY = pointerStartScreen.y;
});

canvas.addEventListener('pointermove', (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, event);

  if (activePointers.size >= 2) {
    updatePinchZoom();
    return;
  }

  if (!pointerDown) return;
  const point = screenPoint(event.clientX, event.clientY);
  pointerCurrentWorld = screenToWorld(event.clientX, event.clientY);
  const dx = point.x - pointerLastScreen.x;
  const dy = point.y - pointerLastScreen.y;
  const totalDx = point.x - pointerStartScreen.x;
  const totalDy = point.y - pointerStartScreen.y;
  const distance = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

  if (distance > TAP_THRESHOLD) dragStarted = true;

  if (mode === 'commander' && dragStarted) {
    pointerLastScreen = point;
    return;
  }

  if (mode === 'build' && selectedBuild === 'wall' && dragStarted) {
    placeWallDrag(pointerCurrentWorld);
    pointerLastScreen = point;
    return;
  }

  if (mode === 'command' && pointerStartOnFriendly && distance > SELECT_DRAG_THRESHOLD && !panStarted) {
    selection.active = true;
    selection.endX = point.x;
    selection.endY = point.y;
    pointerLastScreen = point;
    return;
  }

  if (dragStarted && !selection.active) {
    panStarted = true;
    selection.active = false;
  }

  if (panStarted) {
    setFollowedUnit(null);
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
  }

  pointerLastScreen = point;
});

canvas.addEventListener('pointerup', (event) => {
  activePointers.delete(event.pointerId);
  if (activePointers.size > 0) {
    pointerDown = false;
    selection.active = false;
    panStarted = false;
    return;
  }

  if (!pointerDown) return;
  pointerDown = false;
  const point = screenPoint(event.clientX, event.clientY);
  const totalDx = point.x - pointerStartScreen.x;
  const totalDy = point.y - pointerStartScreen.y;
  const distance = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

  if (selection.active && distance > SELECT_DRAG_THRESHOLD) {
    const start = {
      x: camera.x + selection.startX / camera.zoom,
      y: camera.y + selection.startY / camera.zoom,
    };
    const end = {
      x: camera.x + selection.endX / camera.zoom,
      y: camera.y + selection.endY / camera.zoom,
    };
    world.selectUnitsInRect(start, end);
    interactionHint = `已框选 ${world.state.selectedUnitIds.length} 个单位`;
    renderActionPanel();
  } else if (!panStarted && distance <= TAP_THRESHOLD) {
    handleTap(screenToWorld(event.clientX, event.clientY));
  }

  selection.active = false;
  panStarted = false;
});

canvas.addEventListener('pointercancel', (event) => {
  activePointers.delete(event.pointerId);
  pointerDown = false;
  selection.active = false;
  panStarted = false;
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const mouseWorld = screenToWorld(event.clientX, event.clientY);
  setZoomAt(camera.zoom - Math.sign(event.deltaY) * 0.08, mouseWorld, screenPoint(event.clientX, event.clientY));
});

function beginPinch(): void {
  const pointers = [...activePointers.values()];
  pinchStartDistance = pointerDistance(pointers[0], pointers[1]);
  pinchStartZoom = camera.zoom;
  const center = pointerCenter(pointers[0], pointers[1]);
  pinchStartCenterWorld = screenCanvasPointToWorld(center);
}

function updatePinchZoom(): void {
  const pointers = [...activePointers.values()];
  if (pointers.length < 2 || pinchStartDistance <= 0) return;
  const center = pointerCenter(pointers[0], pointers[1]);
  const nextZoom = pinchStartZoom * (pointerDistance(pointers[0], pointers[1]) / pinchStartDistance);
  setZoomAt(nextZoom, pinchStartCenterWorld, center);
}

function pointerDistance(a: PointerEvent, b: PointerEvent): number {
  const ap = screenPoint(a.clientX, a.clientY);
  const bp = screenPoint(b.clientX, b.clientY);
  return Math.hypot(ap.x - bp.x, ap.y - bp.y);
}

function pointerCenter(a: PointerEvent, b: PointerEvent): RtsVector {
  const ap = screenPoint(a.clientX, a.clientY);
  const bp = screenPoint(b.clientX, b.clientY);
  return { x: (ap.x + bp.x) / 2, y: (ap.y + bp.y) / 2 };
}

function screenCanvasPointToWorld(point: RtsVector): RtsVector {
  return {
    x: camera.x + point.x / camera.zoom,
    y: camera.y + point.y / camera.zoom,
  };
}

function setZoomAt(nextZoom: number, anchorWorld: RtsVector, anchorScreen: RtsVector): void {
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
  camera.x = anchorWorld.x - anchorScreen.x / camera.zoom;
  camera.y = anchorWorld.y - anchorScreen.y / camera.zoom;
  clampCamera();
}

function updateCommanderFromDrag(deltaTime: number): void {
  if (mode !== 'commander' || !world.state.activeCommanderId || !pointerDown || !dragStarted) return;
  const dx = pointerLastScreen.x - pointerStartScreen.x;
  const dy = pointerLastScreen.y - pointerStartScreen.y;
  world.moveCommander(dx, dy, deltaTime);
}

function clampCamera(): void {
  camera.x = Math.max(0, Math.min(world.state.mapWidth * world.state.tileSize - canvas.width / camera.zoom, camera.x));
  camera.y = Math.max(0, Math.min(world.state.mapHeight * world.state.tileSize - canvas.height / camera.zoom, camera.y));
}

function setFollowedUnit(unitId: string | null): void {
  followedUnitId = unitId;
}

function updateCameraFollow(): void {
  if (!followedUnitId || panStarted || pointerDown) return;
  const unit = world.state.units[followedUnitId];
  if (!unit) {
    followedUnitId = null;
    return;
  }

  camera.x = unit.x + unit.width / 2 - canvas.width / camera.zoom / 2;
  camera.y = unit.y + unit.height / 2 - canvas.height / camera.zoom / 2;
}

function updateStatus(): void {
  const player = world.state.factions.player;
  const modeText = mode === 'build' && selectedBuild ? `建造：${getBuildingName(selectedBuild)}` : mode === 'commander' ? '将领' : '指挥';
  topStatus.textContent = `第 ${world.state.day} 天 | ${modeText} | 已选 ${world.state.selectedUnitIds.length}`;
  resourceStatus.textContent = `粮 ${Math.floor(player.resources.food)} 木 ${Math.floor(player.resources.wood)} 石 ${Math.floor(player.resources.stone)} 铁 ${Math.floor(player.resources.iron)} 金 ${Math.floor(player.resources.gold)} | ${interactionHint}`;
}

function getBuildingName(type: BuildingType): string {
  return buildOptions.find((option) => option.type === type)?.label ?? type;
}

function getUnitName(role: UnitRole): string {
  const names: Record<UnitRole, string> = {
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
  return names[role];
}

function getResourceName(resource: ResourceType): string {
  const names: Record<ResourceType, string> = {
    wood: '木材',
    stone: '石材',
    iron: '铁矿',
    food: '粮食',
    gold: '金币',
    population: '人口',
  };
  return names[resource];
}

function getTerrainName(terrain: TerrainType): string {
  const names: Record<TerrainType, string> = {
    grass: '草地',
    forest: '森林',
    mountain: '山地',
    water: '水域',
    road: '道路',
    field: '农田',
    bridge: '桥梁',
  };
  return names[terrain];
}

function loop(): void {
  const now = Date.now();
  const deltaTime = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  resizeCanvas();
  updateCommanderFromDrag(deltaTime);
  world.update(deltaTime);
  updateCameraFollow();
  clampCamera();
  updateStatus();
  renderer.render(world.state, camera, selection, getBuildPreview());
  requestAnimationFrame(loop);
}

function placeWallDrag(worldPoint: RtsVector): void {
  const tileX = Math.floor(worldPoint.x / world.state.tileSize);
  const tileY = Math.floor(worldPoint.y / world.state.tileSize);
  const key = `${tileX}:${tileY}`;
  if (key === lastWallTile) return;
  lastWallTile = key;
  const placed = world.placeBuilding('wall', worldPoint);
  interactionHint = placed ? '连续建造城墙中' : '这里不能建造城墙';
}

function getBuildPreview(): { type: BuildingType; x: number; y: number; valid: boolean } | undefined {
  if (mode !== 'build' || !selectedBuild) return undefined;
  const tileX = Math.floor(pointerCurrentWorld.x / world.state.tileSize);
  const tileY = Math.floor(pointerCurrentWorld.y / world.state.tileSize);
  return {
    type: selectedBuild,
    x: tileX * world.state.tileSize,
    y: tileY * world.state.tileSize,
    valid: world.canPreviewBuilding(selectedBuild, pointerCurrentWorld),
  };
}

document.getElementById('joinButton')!.addEventListener('click', joinGame);
document.getElementById('playerNameInput')!.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') joinGame();
});
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);

renderActionPanel();
resizeCanvas();
requestAnimationFrame(loop);
