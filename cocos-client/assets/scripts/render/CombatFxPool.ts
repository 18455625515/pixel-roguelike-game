import { _decorator, Component, Node, Graphics, Color } from 'cc';
import { CombatEvent } from '../sim/rts-types';
import { ViewBounds } from './GameCamera';

const { ccclass } = _decorator;

@ccclass('CombatFxPool')
export class CombatFxPool extends Component {
  private pool: Node[] = [];
  private active: Node[] = [];

  sync(events: CombatEvent[], bounds: ViewBounds | null): void {
    this.active.forEach((n) => this.release(n));
    this.active.length = 0;

    const now = Date.now();
    events.forEach((event) => {
      if (now - event.createdAt > 600) return;
      const x = event.x;
      const y = event.y;
      if (bounds && (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom)) return;

      const node = this.acquire();
      const g = node.getComponent(Graphics)!;
      g.clear();
      g.fillColor = new Color(255, 220, 120, 200);
      g.circle(0, 0, 6);
      g.fill();
      node.setPosition(x, y, 0);
      this.active.push(node);
    });
  }

  private acquire(): Node {
    const node = this.pool.pop();
    if (node) {
      node.active = true;
      return node;
    }
    const created = new Node('fx');
    created.addComponent(Graphics);
    this.node.addChild(created);
    return created;
  }

  private release(node: Node): void {
    node.active = false;
    this.pool.push(node);
  }
}
