import { _decorator, Component, Node, Graphics, Color } from 'cc';
import { RtsWorld } from '../sim/rts-world';
import { TerrainType } from '../sim/rts-types';

const { ccclass } = _decorator;

const TILE = 32;
const CHUNK_TILES = 16;

const TERRAIN_COLORS: Record<TerrainType, Color> = {
  grass: new Color(47, 125, 69),
  forest: new Color(31, 95, 56),
  mountain: new Color(101, 111, 114),
  water: new Color(36, 106, 143),
  road: new Color(138, 111, 76),
  field: new Color(138, 169, 77),
  bridge: new Color(143, 106, 67),
};

/**
 * 地形分块烘焙：启动时一次性绘制，运行时零 CPU 绘制开销。
 */
@ccclass('TerrainLayer')
export class TerrainLayer extends Component {
  build(world: RtsWorld): void {
    const mapW = world.state.mapWidth;
    const mapH = world.state.mapHeight;
    const chunksX = Math.ceil(mapW / CHUNK_TILES);
    const chunksY = Math.ceil(mapH / CHUNK_TILES);

    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const chunk = new Node(`chunk_${cx}_${cy}`);
        this.node.addChild(chunk);
        chunk.setPosition(cx * CHUNK_TILES * TILE, cy * CHUNK_TILES * TILE, 0);

        const g = chunk.addComponent(Graphics);
        const startX = cx * CHUNK_TILES;
        const startY = cy * CHUNK_TILES;
        const endX = Math.min(startX + CHUNK_TILES, mapW);
        const endY = Math.min(startY + CHUNK_TILES, mapH);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const tile = world.state.tiles[y * mapW + x];
            if (!tile) continue;
            const color = TERRAIN_COLORS[tile.terrain] ?? TERRAIN_COLORS.grass;
            g.fillColor = color;
            g.rect((x - startX) * TILE, (y - startY) * TILE, TILE, TILE);
            g.fill();
          }
        }
      }
    }
  }
}
