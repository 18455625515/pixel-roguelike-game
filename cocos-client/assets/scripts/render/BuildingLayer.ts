import { _decorator, Component, Node, Graphics, Color } from 'cc';
import { Building, BuildingType, RtsGameState } from '../sim/rts-types';
import { RtsWorld } from '../sim/rts-world';
import { ViewBounds } from './GameCamera';

const { ccclass } = _decorator;

const BUILDING_COLORS: Record<BuildingType, Color> = {
  townHall: new Color(199, 155, 88),
  house: new Color(156, 111, 76),
  farm: new Color(159, 188, 79),
  lumberCamp: new Color(127, 91, 62),
  warehouse: new Color(169, 135, 97),
  barracks: new Color(139, 85, 100),
  market: new Color(181, 143, 74),
  wall: new Color(142, 151, 148),
  gate: new Color(122, 90, 66),
  bridge: new Color(154, 109, 65),
  tower: new Color(127, 136, 141),
};

@ccclass('BuildingLayer')
export class BuildingLayer extends Component {
  private nodes = new Map<string, Node>();
  private world: RtsWorld | null = null;

  init(world: RtsWorld): void {
    this.world = world;
  }

  sync(state: RtsGameState, bounds: ViewBounds | null): void {
    const visible = new Set<string>();

    Object.values(state.buildings).forEach((building) => {
      if (bounds && !this.inView(building, bounds)) return;
      visible.add(building.id);
      let node = this.nodes.get(building.id);
      if (!node) {
        node = new Node(`b_${building.id}`);
        node.addComponent(Graphics);
        this.node.addChild(node);
        this.nodes.set(building.id, node);
      }
      this.drawBuilding(node, building);
    });

    this.nodes.forEach((node, id) => {
      if (visible.has(id)) return;
      node.destroy();
      this.nodes.delete(id);
    });
  }

  getBuildingAt(worldX: number, worldY: number): Building | null {
    if (!this.world) return null;
    return this.world.getBuildingAt({ x: worldX, y: worldY });
  }

  private inView(b: Building, view: ViewBounds): boolean {
    return b.x + b.width >= view.left && b.x <= view.right && b.y + b.height >= view.top && b.y <= view.bottom;
  }

  private drawBuilding(node: Node, building: Building): void {
    node.setPosition(building.x, building.y, 0);
    const g = node.getComponent(Graphics)!;
    g.clear();
    const color = BUILDING_COLORS[building.type] ?? Color.GRAY;
    g.fillColor = building.complete ? color : new Color(color.r * 0.6, color.g * 0.6, color.b * 0.6, 200);
    g.rect(0, 0, building.width, building.height);
    g.fill();
    if (!building.complete) {
      g.fillColor = new Color(57, 255, 136, 180);
      g.rect(0, building.height + 2, building.width * building.progress, 4);
      g.fill();
    }
  }
}
