import { _decorator, Component, Node, Vec3, view } from 'cc';
import { RtsVector } from '../sim/rts-types';

const { ccclass } = _decorator;

export interface ViewBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

@ccclass('GameCamera')
export class GameCamera extends Component {
  private worldNode: Node | null = null;
  x = 300;
  y = 760;
  zoom = 1;
  minZoom = 0.55;
  maxZoom = 1.8;

  bindWorld(worldNode: Node): void {
    this.worldNode = worldNode;
    this.applyTransform();
  }

  pan(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
    this.applyTransform();
  }

  setZoom(nextZoom: number, anchorWorld?: RtsVector, anchorScreen?: { x: number; y: number }): void {
    const prev = this.zoom;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, nextZoom));
    if (anchorWorld && anchorScreen) {
      this.x = anchorWorld.x - anchorScreen.x / this.zoom;
      this.y = anchorWorld.y - anchorScreen.y / this.zoom;
    } else if (prev !== this.zoom) {
      // 保持屏幕中心
    }
    this.clamp();
    this.applyTransform();
  }

  focus(worldX: number, worldY: number, viewW: number, viewH: number): void {
    this.x = worldX - viewW / this.zoom / 2;
    this.y = worldY - viewH / this.zoom / 2;
    this.clamp();
    this.applyTransform();
  }

  getViewBounds(): ViewBounds {
    const size = view.getVisibleSize();
    const w = size.width / this.zoom;
    const h = size.height / this.zoom;
    const margin = 64;
    return {
      left: this.x - margin,
      top: this.y - margin,
      right: this.x + w + margin,
      bottom: this.y + h + margin,
    };
  }

  screenToWorld(screenX: number, screenY: number, canvasH: number): RtsVector {
    const size = view.getVisibleSize();
    const scaleX = size.width / (view.getVisibleSize().width || 1);
    const scaleY = size.height / canvasH;
    return {
      x: this.x + (screenX * scaleX) / this.zoom,
      y: this.y + (screenY * scaleY) / this.zoom,
    };
  }

  private clamp(): void {
    const mapW = 140 * 32;
    const mapH = 100 * 32;
    const size = view.getVisibleSize();
    const maxX = Math.max(0, mapW - size.width / this.zoom);
    const maxY = Math.max(0, mapH - size.height / this.zoom);
    this.x = Math.max(0, Math.min(maxX, this.x));
    this.y = Math.max(0, Math.min(maxY, this.y));
  }

  private applyTransform(): void {
    if (!this.worldNode) return;
  this.worldNode.setPosition(new Vec3(-this.x * this.zoom, -this.y * this.zoom, 0));
    this.worldNode.setScale(this.zoom, this.zoom, 1);
  }
}
