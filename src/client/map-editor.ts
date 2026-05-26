import { BuildingType, ResourceType, TerrainType, UnitRole } from '../shared/rts-types';
import { RtsRenderer } from './rts-renderer';
import { RtsWorld } from '../shared/rts-world';
import {
  createEmptyMapData,
  CUSTOM_MAP_STORAGE_KEY,
  downloadMapJson,
  MapData,
} from '../shared/map-data';

type EditorTool = 'terrain' | 'resource' | 'building' | 'unit' | 'erase' | 'pan';

const canvas = document.getElementById('editorCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const toolPanel = document.getElementById('toolPanel')!;
const statusEl = document.getElementById('editorStatus')!;
const mapNameInput = document.getElementById('mapName') as HTMLInputElement;
const mapWidthInput = document.getElementById('mapWidth') as HTMLInputElement;
const mapHeightInput = document.getElementById('mapHeight') as HTMLInputElement;
const importInput = document.getElementById('importFile') as HTMLInputElement;

const DEFAULT_W = 120;
const DEFAULT_H = 80;

let mapData = createEmptyMapData('我的地图', DEFAULT_W, DEFAULT_H, 32);
let world = new RtsWorld({ mapData, editorMode: true });
const renderer = new RtsRenderer(ctx, 1000, 720);

const camera = { x: 0, y: 0, zoom: 0.55 };
let tool: EditorTool = 'terrain';
let terrainBrush: TerrainType = 'grass';
let resourceBrush: ResourceType | null = null;
let buildingBrush: BuildingType = 'townHall';
let unitBrush: UnitRole = 'worker';
let factionBrush = 'player';
let painting = false;
let panning = false;
let pointerDown = false;
let spacePanActive = false;
let pointerLast = { x: 0, y: 0 };
let pointerDownAt = { x: 0, y: 0 };
let pendingGesture = false;
const brushSize = 1;
const PAN_DRAG_THRESHOLD = 8;
const PAINT_DRAG_THRESHOLD = 4;

function isBrushTool(): boolean {
  return tool === 'terrain' || tool === 'resource' || tool === 'erase';
}

function shouldPanFromEvent(e: PointerEvent): boolean {
  return tool === 'pan' || spacePanActive || e.shiftKey || e.button === 1;
}

function isPointerPanButtonDown(e: PointerEvent): boolean {
  return (e.buttons & 1) !== 0 || (e.buttons & 4) !== 0;
}

function pointerDragDistance(e: PointerEvent): number {
  return Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y);
}

function panCameraByScreenDelta(dx: number, dy: number): void {
  camera.x -= dx / camera.zoom;
  camera.y -= dy / camera.zoom;
}

const terrains: Array<{ id: TerrainType; label: string }> = [
  { id: 'grass', label: '草地' },
  { id: 'water', label: '水域' },
  { id: 'forest', label: '森林' },
  { id: 'mountain', label: '山地' },
  { id: 'road', label: '道路' },
  { id: 'field', label: '农田' },
  { id: 'bridge', label: '桥梁' },
];

const resources: Array<{ id: ResourceType | ''; label: string }> = [
  { id: '', label: '无资源' },
  { id: 'wood', label: '木材' },
  { id: 'stone', label: '石材' },
  { id: 'iron', label: '铁矿' },
];

const buildings: BuildingType[] = ['townHall', 'house', 'farm', 'warehouse', 'barracks', 'tower', 'wall', 'market'];
const units: UnitRole[] = ['worker', 'farmer', 'woodcutter', 'swordsman', 'archer', 'commander'];

function reloadWorldFromMap(data: MapData): void {
  mapData = data;
  world = new RtsWorld({ mapData: data, editorMode: true });
  mapNameInput.value = data.name;
  mapWidthInput.value = String(data.mapWidth);
  mapHeightInput.value = String(data.mapHeight);
  camera.x = (data.mapWidth * data.tileSize) / 4;
  camera.y = (data.mapHeight * data.tileSize) / 4;
  setStatus(`已加载：${data.name}（${data.mapWidth}×${data.mapHeight}）`);
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = (clientX - rect.left) * (canvas.width / rect.width);
  const sy = (clientY - rect.top) * (canvas.height / rect.height);
  return {
    x: camera.x + sx / camera.zoom,
    y: camera.y + sy / camera.zoom,
  };
}

function applyBrush(worldX: number, worldY: number): string {
  const ts = world.state.tileSize;
  const tx = Math.floor(worldX / ts);
  const ty = Math.floor(worldY / ts);

  if (tx < 0 || ty < 0 || tx >= world.state.mapWidth || ty >= world.state.mapHeight) {
    return `超出地图范围（${world.state.mapWidth}×${world.state.mapHeight}）`;
  }

  let changed = false;
  let message = '';

  for (let dy = -brushSize; dy <= brushSize; dy++) {
    for (let dx = -brushSize; dx <= brushSize; dx++) {
      const px = tx + dx;
      const py = ty + dy;
      if (tool === 'terrain') changed = world.editorSetTerrain(px, py, terrainBrush) || changed;
      else if (tool === 'resource') {
        if (!resourceBrush) {
          changed = world.editorSetResource(px, py, null) || changed;
        } else {
          changed = world.editorSetResource(px, py, resourceBrush, 120) || changed;
        }
      } else if (tool === 'erase') {
        changed = world.editorSetTerrain(px, py, 'grass') || changed;
        changed = world.editorSetResource(px, py, null) || changed;
      }
    }
  }

  if (tool === 'building') {
    const placed = world.editorPlaceBuilding(factionBrush, buildingBrush, tx, ty, true);
    if (placed) {
      return `已放置 ${buildingBrush}（${factionBrush}）@${tx},${ty}`;
    }
    return `无法放置 ${buildingBrush}：地形/占地冲突，请换空地或更大区域`;
  }

  if (tool === 'unit') {
    const placed = world.editorPlaceUnit(factionBrush, unitBrush, tx, ty);
    if (placed) {
      return `已放置 ${unitBrush}（${factionBrush}）@${tx},${ty}`;
    }
    return `无法放置单位：该格被阻挡`;
  }

  if (tool === 'resource' && !resourceBrush) {
    return changed ? `已清除资源 @${tx},${ty}` : '请选择资源类型（木材/石材/铁矿）';
  }

  if (tool === 'terrain') {
    const label = terrains.find((t) => t.id === terrainBrush)?.label ?? terrainBrush;
    return changed ? `地形 → ${label} @${tx},${ty}` : '无法修改该格';
  }

  if (tool === 'resource') {
    const label = resources.find((r) => r.id === resourceBrush)?.label ?? resourceBrush;
    return changed ? `资源 → ${label} @${tx},${ty}` : '无法放置资源（水域等）';
  }

  if (tool === 'erase') {
    return changed ? `已擦除 @${tx},${ty}` : '无法擦除';
  }

  return message || `已编辑 @${tx},${ty}`;
}

function renderToolPanel(): void {
  toolPanel.innerHTML = '';

  const addBtn = (label: string, active: boolean, onClick: () => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `toolBtn${active ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    toolPanel.appendChild(btn);
  };

  addBtn('地形', tool === 'terrain', () => {
    tool = 'terrain';
    renderToolPanel();
  });
  addBtn('资源', tool === 'resource', () => {
    tool = 'resource';
    if (!resourceBrush) resourceBrush = 'wood';
    renderToolPanel();
  });
  addBtn('建筑', tool === 'building', () => {
    tool = 'building';
    renderToolPanel();
  });
  addBtn('单位', tool === 'unit', () => {
    tool = 'unit';
    renderToolPanel();
  });
  addBtn('橡皮', tool === 'erase', () => {
    tool = 'erase';
    renderToolPanel();
  });
  addBtn('平移', tool === 'pan', () => {
    tool = 'pan';
    renderToolPanel();
  });

  if (tool === 'terrain') {
    terrains.forEach((t) => addBtn(t.label, terrainBrush === t.id, () => {
      terrainBrush = t.id;
      renderToolPanel();
    }));
  } else if (tool === 'resource') {
    resources.forEach((r) => addBtn(r.label, resourceBrush === (r.id || null), () => {
      resourceBrush = r.id || null;
      renderToolPanel();
    }));
  } else if (tool === 'building') {
    ['player', 'north', 'raiders', 'village', 'miners', 'south'].forEach((f) => addBtn(f, factionBrush === f, () => {
      factionBrush = f;
      renderToolPanel();
    }));
    buildings.forEach((b) => addBtn(b, buildingBrush === b, () => {
      buildingBrush = b;
      renderToolPanel();
    }));
  } else if (tool === 'unit') {
    ['player', 'raiders'].forEach((f) => addBtn(f, factionBrush === f, () => {
      factionBrush = f;
      renderToolPanel();
    }));
    units.forEach((u) => addBtn(u, unitBrush === u, () => {
      unitBrush = u;
      renderToolPanel();
    }));
  }
}

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(320, Math.floor(rect.height));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    renderer.resize(w, h);
  }
}

function loop(): void {
  resizeCanvas();
  renderer.render(world.state, camera);
  requestAnimationFrame(loop);
}

function finishPointerInteraction(e: PointerEvent): void {
  if (pendingGesture && !panning) {
    const drag = pointerDragDistance(e);
    if (drag < PAN_DRAG_THRESHOLD || tool === 'building' || tool === 'unit') {
      const p = screenToWorld(e.clientX, e.clientY);
      if (tool !== 'pan') setStatus(applyBrush(p.x, p.y));
    }
  }
  painting = false;
  panning = false;
  pointerDown = false;
  pendingGesture = false;
}

canvas.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.editorHud')) return;
  if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;

  canvas.setPointerCapture(e.pointerId);
  pointerDown = true;
  pointerLast = { x: e.clientX, y: e.clientY };
  pointerDownAt = { x: e.clientX, y: e.clientY };
  pendingGesture = true;
  painting = false;
  panning = false;

  if (shouldPanFromEvent(e)) {
    panning = true;
    pendingGesture = false;
    return;
  }
  if (e.button === 2) {
    const p = screenToWorld(e.clientX, e.clientY);
    world.editorRemoveAt(p);
    setStatus('已删除');
    pendingGesture = false;
    pointerDown = false;
    return;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (panning && isPointerPanButtonDown(e)) {
    const dx = e.clientX - pointerLast.x;
    const dy = e.clientY - pointerLast.y;
    if (dx !== 0 || dy !== 0) {
      panCameraByScreenDelta(dx, dy);
      pointerLast = { x: e.clientX, y: e.clientY };
    }
    return;
  }

  if (!pointerDown) return;
  if (!pendingGesture && !painting) return;

  const drag = pointerDragDistance(e);
  if (pendingGesture && drag > PAN_DRAG_THRESHOLD && isPointerPanButtonDown(e)) {
    if (shouldPanFromEvent(e) || tool === 'building' || tool === 'unit') {
      panning = true;
      pendingGesture = false;
      const dx = e.clientX - pointerLast.x;
      const dy = e.clientY - pointerLast.y;
      panCameraByScreenDelta(dx, dy);
      pointerLast = { x: e.clientX, y: e.clientY };
      return;
    }
    if (isBrushTool()) {
      painting = true;
      pendingGesture = false;
    }
  }

  if (painting && isBrushTool() && drag >= PAINT_DRAG_THRESHOLD) {
    const p = screenToWorld(e.clientX, e.clientY);
    setStatus(applyBrush(p.x, p.y));
  }
});

canvas.addEventListener('pointerup', (e) => {
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* already released */
  }
  finishPointerInteraction(e);
});

canvas.addEventListener('pointercancel', (e) => {
  finishPointerInteraction(e);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    spacePanActive = true;
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spacePanActive = false;
  }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.zoom = Math.max(0.25, Math.min(2, camera.zoom - Math.sign(e.deltaY) * 0.06));
});

document.getElementById('btnNew')!.addEventListener('click', () => {
  const w = Math.max(40, Math.min(280, Number(mapWidthInput.value) || DEFAULT_W));
  const h = Math.max(40, Math.min(170, Number(mapHeightInput.value) || DEFAULT_H));
  const name = mapNameInput.value.trim() || '我的地图';
  reloadWorldFromMap(createEmptyMapData(name, w, h, 32));
  renderToolPanel();
});

document.getElementById('btnExport')!.addEventListener('click', () => {
  const data = world.exportMapData(mapNameInput.value.trim() || '我的地图');
  downloadMapJson(data);
  setStatus(`已导出 ${data.name}.json`);
});

importInput.addEventListener('change', () => {
  const file = importInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result)) as MapData;
      if (data.version !== 1 || !data.mapWidth || !data.mapHeight) throw new Error('格式无效');
      reloadWorldFromMap(data);
      renderToolPanel();
    } catch {
      setStatus('导入失败：JSON 格式不正确');
    }
    importInput.value = '';
  };
  reader.readAsText(file);
});

document.getElementById('btnPlay')!.addEventListener('click', () => {
  const data = world.exportMapData(mapNameInput.value.trim() || '我的地图');
  sessionStorage.setItem(CUSTOM_MAP_STORAGE_KEY, JSON.stringify(data));
  window.location.href = '/';
});

document.getElementById('btnBack')!.addEventListener('click', () => {
  window.location.href = '/';
});

renderToolPanel();
camera.x = (DEFAULT_W * 32) / 4;
camera.y = (DEFAULT_H * 32) / 4;
setStatus('地图编辑器：平移工具=按住拖动；绘制工具=左键涂抹；空格/Shift/中键也可拖动画布');
resizeCanvas();
requestAnimationFrame(loop);
