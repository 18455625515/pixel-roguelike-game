import { _decorator, Component, Node, Sprite, Color, UITransform, resources, SpriteFrame } from 'cc';
import { RtsGameState, Unit, UnitRole } from '../sim/rts-types';
import { ViewBounds } from './GameCamera';

const { ccclass } = _decorator;

const FACTION_COLORS: Record<string, Color> = {
  player: new Color(57, 255, 136),
  north: new Color(80, 180, 255),
  raiders: new Color(255, 90, 90),
  village: new Color(255, 209, 102),
  miners: new Color(180, 180, 190),
  south: new Color(255, 140, 60),
};

const SPRITE_ROLES: UnitRole[] = [
  'commander', 'worker', 'woodcutter', 'stonecutter', 'miner', 'farmer', 'trader',
  'swordsman', 'spearman', 'archer', 'cavalry', 'engineer', 'guard',
];

@ccclass('UnitPool')
export class UnitPool extends Component {
  private pool: Node[] = [];
  private active = new Map<string, Node>();
  private frames = new Map<UnitRole, SpriteFrame>();
  private framesReady = false;

  init(_world: unknown): void {
    this.preloadFrames();
  }

  private preloadFrames(): void {
    let pending = SPRITE_ROLES.length;
    SPRITE_ROLES.forEach((role) => {
      resources.load(`sprites/${role}/idle_down/spriteFrame`, SpriteFrame, (err, frame) => {
        pending--;
        if (!err && frame) this.frames.set(role, frame);
        if (pending <= 0) this.framesReady = true;
      });
    });
  }

  private acquire(): Node {
    const node = this.pool.pop();
    if (node) {
      node.active = true;
      return node;
    }
    const created = new Node('unit');
    created.addComponent(UITransform).setContentSize(32, 32);
    const sprite = created.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.node.addChild(created);
    return created;
  }

  private release(node: Node): void {
    node.active = false;
    this.pool.push(node);
  }

  sync(state: RtsGameState, bounds: ViewBounds | null): void {
    const visible = new Set<string>();

    Object.values(state.units).forEach((unit) => {
      if (bounds && !this.inView(unit, bounds)) return;
      visible.add(unit.id);
      let node = this.active.get(unit.id);
      if (!node) {
        node = this.acquire();
        this.active.set(unit.id, node);
      }
      this.applyUnit(node, unit, state);
    });

    this.active.forEach((node, id) => {
      if (visible.has(id)) return;
      this.active.delete(id);
      this.release(node);
    });
  }

  private inView(unit: Unit, b: ViewBounds): boolean {
    const x2 = unit.x + unit.width;
    const y2 = unit.y + unit.height;
    return x2 >= b.left && unit.x <= b.right && y2 >= b.top && unit.y <= b.bottom;
  }

  private applyUnit(node: Node, unit: Unit, state: RtsGameState): void {
    node.setPosition(unit.x, unit.y, 0);
    const sprite = node.getComponent(Sprite)!;
    const frame = this.frames.get(unit.role);
    if (this.framesReady && frame) {
      sprite.spriteFrame = frame;
      sprite.color = Color.WHITE;
    } else {
      sprite.spriteFrame = null;
      sprite.color = FACTION_COLORS[unit.factionId] ?? Color.WHITE;
    }
    node.setScale(unit.selected ? 1.08 : 1, unit.selected ? 1.08 : 1, 1);
  }
}
