import { BUILDING_CATALOG } from '../shared/building-catalog';
import { Building, BuildingType, ResourceType, RtsVector, TerrainType, UnitRole } from '../shared/rts-types';
import { RtsRenderer } from './rts-renderer';
import { RtsWorld } from '../shared/rts-world';
import { CUSTOM_MAP_STORAGE_KEY, MapData } from '../shared/map-data';

type TouchMode = 'command' | 'build' | 'recruit' | 'commander';
type RecruitTab = 'economy' | 'military';

const isMobileLayout = window.matchMedia('(max-width: 768px)').matches;
const TAP_THRESHOLD = isMobileLayout ? 14 : 10;
const SELECT_DRAG_THRESHOLD = isMobileLayout ? 26 : 22;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.8;

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const modePanel = document.getElementById('modePanel')!;
const actionPanel = document.getElementById('actionPanel')!;
const topStatus = document.getElementById('topStatus')!;
const resourceStatus = document.getElementById('resourceStatus')!;

const world = createWorld();
const renderer = new RtsRenderer(ctx, 1000, 720);

const camera = {
  x: 0,
  y: 0,
  zoom: isMobileLayout ? 0.5 : 0.62,
};

let actionButtonHost: HTMLElement = actionPanel;

function createWorld(): RtsWorld {
  try {
    const raw = sessionStorage.getItem(CUSTOM_MAP_STORAGE_KEY);
    if (raw) {
      const mapData = JSON.parse(raw) as MapData;
      if (mapData.version === 1 && mapData.mapWidth && mapData.mapHeight) {
        sessionStorage.removeItem(CUSTOM_MAP_STORAGE_KEY);
        return new RtsWorld({ mapData });
      }
    }
  } catch {
    /* 使用默认地图 */
  }
  return new RtsWorld();
}

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
  { type: 'house', label: '民居' },
  { type: 'farm', label: '农田' },
  { type: 'lumberCamp', label: '伐木场' },
  { type: 'warehouse', label: '仓库' },
  { type: 'barracks', label: '兵营' },
  { type: 'market', label: '市场' },
  { type: 'smithy', label: '铁匠铺' },
  { type: 'stable', label: '马厩' },
  { type: 'tower', label: '箭塔' },
  { type: 'wall', label: '城墙' },
  { type: 'gate', label: '城门' },
  { type: 'bridge', label: '桥梁' },
];

const recruitEconomyOptions: Array<{ role: UnitRole; label: string }> = [
  { role: 'worker', label: '工人' },
  { role: 'farmer', label: '农民' },
  { role: 'woodcutter', label: '伐木工' },
  { role: 'stonecutter', label: '采石工' },
  { role: 'miner', label: '矿工' },
  { role: 'engineer', label: '工兵' },
];

const recruitMilitaryOptions: Array<{ role: UnitRole; label: string }> = [
  { role: 'swordsman', label: '剑盾兵' },
  { role: 'spearman', label: '长矛兵' },
  { role: 'archer', label: '弓箭手' },
  { role: 'cavalry', label: '骑兵' },
  { role: 'guard', label: '守卫' },
];

let recruitTab: RecruitTab = 'economy';
let gameOutcomeOverlay: HTMLElement | null = null;

function isGameInteractive(): boolean {
  return world.state.gameOutcome === 'playing';
}

function ensureGameOutcomeOverlay(): HTMLElement {
  if (gameOutcomeOverlay) return gameOutcomeOverlay;
  const overlay = document.createElement('div');
  overlay.id = 'gameOutcomeOverlay';
  overlay.style.cssText =
    'display:none;position:absolute;inset:0;z-index:200;align-items:center;justify-content:center;background:rgba(4,6,10,0.82);padding:24px;text-align:center;';
  overlay.innerHTML = `
    <div style="max-width:360px;padding:28px;border:1px solid #2e3a45;border-top:3px solid #39ff88;background:#12151c;color:#f4f7ee;">
      <h2 id="outcomeTitle" style="margin-bottom:12px;color:#39ff88;font-size:26px;">战役胜利</h2>
      <p id="outcomeMessage" style="margin-bottom:18px;color:#9aa79b;line-height:1.7;font-size:14px;"></p>
      <button id="outcomeRestartBtn" type="button" style="width:100%;height:42px;border:0;border-radius:4px;background:#39ff88;color:#07110c;font-weight:800;cursor:pointer;">返回首页</button>
    </div>
  `;
  document.querySelector('.playfield')!.appendChild(overlay);
  document.getElementById('outcomeRestartBtn')!.addEventListener('click', () => {
    window.location.reload();
  });
  gameOutcomeOverlay = overlay;
  return overlay;
}

function updateGameOutcomeOverlay(): void {
  const outcome = world.state.gameOutcome;
  if (outcome === 'playing') return;
  const overlay = ensureGameOutcomeOverlay();
  overlay.style.display = 'flex';
  const title = document.getElementById('outcomeTitle')!;
  const message = document.getElementById('outcomeMessage')!;
  if (outcome === 'victory') {
    title.textContent = '战役胜利';
    title.style.color = '#39ff88';
    message.textContent = '所有敌方大本营均已陷落，边境归于平静。';
  } else {
    title.textContent = '城邦陷落';
    title.style.color = '#ff5261';
    message.textContent = '你的主城已被摧毁，无法再招募部队。';
  }
}

function joinGame(): void {
  document.getElementById('joinDialog')!.style.display = 'none';
  document.getElementById('gameContainer')!.style.display = 'flex';
  focusPlayerBase();
  renderActionPanel();
}

function focusPlayerBase(): void {
  const base = world.playerBaseCenter;
  camera.x = base.x - canvas.width / camera.zoom / 2;
  camera.y = base.y - canvas.height / camera.zoom / 2;
  clampCamera();
}

function setCommandMode(): void {
  mode = 'command';
  selectedBuild = null;
  world.setBuildMode(null);
  if (world.state.activeCommanderId) world.toggleCommanderControl();
  interactionHint = '点单位选择，点地面移动，点敌人攻击，点资源采集';
  renderActionPanel();
}

function enterRecruitMode(tab: RecruitTab = 'economy'): void {
  mode = 'recruit';
  recruitTab = tab;
  selectedBuild = null;
  viewedBuildingId = null;
  world.setBuildMode(null);
  if (world.state.activeCommanderId) world.toggleCommanderControl();
  interactionHint = tab === 'economy' ? '经济单位：工人修建，农民种田，专精采集' : '军事单位：显示完整资源消耗';
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
  actionPanel.className = viewedBuildingId ? 'actionPanel actionPanel--withDetail' : 'actionPanel';
  actionButtonHost = actionPanel;

  if (viewedBuildingId) {
    const building = world.state.buildings[viewedBuildingId];
    if (building) {
      appendBuildingDetailCard(building);
      const buttonRow = document.createElement('div');
      buttonRow.className = 'actionPanelRow';
      actionPanel.appendChild(buttonRow);
      actionButtonHost = buttonRow;

      if (building.factionId !== 'player') {
        const attack = makeActionButton('攻击该建筑', true);
        attack.addEventListener('click', () => {
          world.commandSelectedAttack(building.id, true);
          viewedBuildingId = null;
          interactionHint = `攻击建筑：${getBuildingName(building.type)}`;
          renderActionPanel();
        });
        buttonRow.appendChild(attack);
        const close = makeActionButton('关闭', false);
        close.addEventListener('click', () => {
          viewedBuildingId = null;
          renderActionPanel();
        });
        buttonRow.appendChild(close);
        return;
      }

      if (building.type === 'townHall' || building.type === 'barracks' || building.type === 'stable') {
        const ecoTab = makeActionButton('经济', recruitTab === 'economy');
        ecoTab.addEventListener('click', () => {
          recruitTab = 'economy';
          renderActionPanel();
        });
        buttonRow.appendChild(ecoTab);
        const milTab = makeActionButton('军事', recruitTab === 'military');
        milTab.addEventListener('click', () => {
          recruitTab = 'military';
          renderActionPanel();
        });
        buttonRow.appendChild(milTab);
        appendRecruitList(recruitTab === 'economy' ? recruitEconomyOptions : recruitMilitaryOptions);
      }

      if (building.type === 'townHall' || building.type === 'warehouse' || building.type === 'barracks') {
        buildOptions.forEach((option) => {
          const button = makeActionButton(`建${option.label}`, false);
          button.addEventListener('click', () => enterBuildMode(option.type));
          buttonRow.appendChild(button);
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
        buttonRow.appendChild(recycle);
      }

      const close = makeActionButton('关闭', false);
      close.addEventListener('click', () => {
        viewedBuildingId = null;
        interactionHint = '已关闭建筑信息';
        renderActionPanel();
      });
      buttonRow.appendChild(close);
      return;
    }
    viewedBuildingId = null;
  }

  if (mode === 'recruit') {
    addUtilityButton(recruitTab === 'economy' ? '→军事' : '→经济', () => enterRecruitMode(recruitTab === 'economy' ? 'military' : 'economy'));
    appendRecruitList(recruitTab === 'economy' ? recruitEconomyOptions : recruitMilitaryOptions);
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
  addUtilityButton('农民', selectAllFarmers);
  addUtilityButton('采集', selectAllGatherers);
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
  actionButtonHost.appendChild(button);
}

function addDisabledButton(label: string): void {
  const button = makeActionButton(label, false);
  button.disabled = true;
  actionButtonHost.appendChild(button);
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
  selectUnits((role) => ['worker', 'engineer'].includes(role), '已选择工人');
}

function selectAllFarmers(): void {
  selectUnits((role) => role === 'farmer', '已选择农民');
}

function selectAllGatherers(): void {
  selectUnits((role) => ['woodcutter', 'stonecutter', 'miner', 'farmer'].includes(role), '已选择采集');
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

function makeRecruitButton(label: string, role: UnitRole): HTMLButtonElement {
  const button = document.createElement('button');
  const affordable = world.canAffordRecruit(role);
  button.className = `touchBtn recruitBtn${affordable ? '' : ' unaffordable'}`;
  button.innerHTML = `<span class="recruitName">${label}</span><span class="recruitCost">${world.getRecruitCostText(role)}</span>`;
  button.addEventListener('click', () => {
    const ok = world.recruit(role);
    interactionHint = ok ? `已招募：${label}` : `资源不足：${world.getRecruitCostText(role)}`;
    renderActionPanel();
  });
  return button;
}

function appendRecruitList(options: Array<{ role: UnitRole; label: string }>): void {
  options.forEach((option) => actionButtonHost.appendChild(makeRecruitButton(option.label, option.role)));
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
    viewedBuildingId = building.id;
    interactionHint = `查看：${getBuildingName(building.type)}（可在此发起攻击）`;
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
  if (!isGameInteractive()) return;
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

  if (dragStarted && !selection.active && !pointerStartOnFriendly) {
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
  const pop = world.getPopulationStats('player');
  const dayProgress = Math.floor((world.state.timeOfDay / 210) * 100);
  const modeText = mode === 'build' && selectedBuild ? `建造：${getBuildingName(selectedBuild)}` : mode === 'commander' ? '将领' : '指挥';
  const truceText =
    world.state.truceRemaining > 0
      ? `停战 ${Math.ceil(world.state.truceRemaining / 60)}:${String(Math.ceil(world.state.truceRemaining % 60)).padStart(2, '0')} | `
      : '';
  const remainingHqs = world.getRemainingNpcHeadquarters().length;
  const objectiveText =
    world.state.gameOutcome === 'playing' && remainingHqs > 0 ? ` | 敌方大本营 ${remainingHqs}` : '';
  const outcomeText =
    world.state.gameOutcome === 'victory'
      ? ' | 战役胜利'
      : world.state.gameOutcome === 'defeat'
        ? ' | 城邦陷落'
        : '';
  topStatus.textContent = `${truceText}第 ${world.state.day} 天（${dayProgress}%）| ${modeText} | 已选 ${world.state.selectedUnitIds.length}${objectiveText}${outcomeText}`;
  resourceStatus.textContent = `粮 ${Math.floor(player.resources.food)} 木 ${Math.floor(player.resources.wood)} 石 ${Math.floor(player.resources.stone)} 铁 ${Math.floor(player.resources.iron)} 金 ${Math.floor(player.resources.gold)} 人口 ${pop.used}/${pop.cap} | ${interactionHint}`;
}

function appendBuildingDetailCard(building: Building): void {
  const entry = BUILDING_CATALOG[building.type];
  const card = document.createElement('div');
  card.className = 'buildingDetailCard';
  const status = building.complete ? '已建成' : `施工中 ${Math.floor(building.progress * 100)}%`;
  const owner = world.state.factions[building.factionId]?.name ?? building.factionId;
  card.innerHTML = `
    <div class="buildingDetailHead">
      <strong>${entry.name}</strong>
      <span class="buildingDetailTag">${status}</span>
    </div>
    <p class="buildingDetailSummary">${entry.summary}</p>
    <div class="buildingDetailStats">
      <span>生命 ${Math.ceil(building.health)}/${building.maxHealth}</span>
      <span>占地 ${Math.ceil(building.width / world.state.tileSize)}×${Math.ceil(building.height / world.state.tileSize)} 格</span>
      <span>归属 ${owner}</span>
      <span>造价 ${entry.costText}</span>
    </div>
    <ul class="buildingDetailEffects">
      ${entry.effects.map((line) => `<li>${line}</li>`).join('')}
    </ul>
  `;
  actionPanel.appendChild(card);
}

function getBuildingName(type: BuildingType): string {
  return BUILDING_CATALOG[type]?.name ?? type;
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
  updateGameOutcomeOverlay();
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
