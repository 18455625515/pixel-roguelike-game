import { BuildingType, ResourceType, TerrainType, UnitRole } from './rts-types';

export const MAP_DATA_VERSION = 1 as const;

export interface MapTileData {
  x: number;
  y: number;
  terrain: TerrainType;
  fertility?: number;
  resource?: ResourceType;
  resourceAmount?: number;
}

export interface MapBuildingData {
  factionId: string;
  type: BuildingType;
  tileX: number;
  tileY: number;
  complete?: boolean;
}

export interface MapUnitData {
  factionId: string;
  role: UnitRole;
  tileX: number;
  tileY: number;
}

export interface MapData {
  version: typeof MAP_DATA_VERSION;
  name: string;
  mapWidth: number;
  mapHeight: number;
  tileSize: number;
  /** 非默认草地或带资源的格子；加载时先铺草地再覆盖 */
  tiles: MapTileData[];
  buildings: MapBuildingData[];
  units: MapUnitData[];
  playerStart?: { tileX: number; tileY: number };
}

export function createEmptyMapData(name: string, mapWidth: number, mapHeight: number, tileSize = 32): MapData {
  return {
    version: MAP_DATA_VERSION,
    name,
    mapWidth,
    mapHeight,
    tileSize,
    tiles: [],
    buildings: [],
    units: [],
  };
}

export function downloadMapJson(data: MapData, filename?: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename ?? `${data.name || 'map'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export const CUSTOM_MAP_STORAGE_KEY = 'pixel-roguelike-custom-map';
