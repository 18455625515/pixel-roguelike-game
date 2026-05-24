import { _decorator, Component, EventTouch, input, Input, Vec2 } from 'cc';
import { BuildingType, RtsVector, UnitRole } from '../sim/rts-types';
import { RtsWorld } from '../sim/rts-world';
import { GameCamera } from '../render/GameCamera';
import { UnitPool } from '../render/UnitPool';
import { BuildingLayer } from '../render/BuildingLayer';

const { ccclass } = _decorator;

type TouchMode = 'command' | 'build' | 'recruit' | 'commander';

export interface TouchControllerDeps {
  world: RtsWorld;
  camera: GameCamera;
  unitPool: UnitPool | null;
  buildingLayer: BuildingLayer | null;
  onHudRefresh: () => void;
}

@ccclass('TouchController')
export class TouchController extends Component {
  private world!: RtsWorld;
  private camera!: GameCamera;
  private onHudRefresh: () => void = () => {};
  private mode: TouchMode = 'command';
  private selectedBuild: BuildingType | null = null;
  private panLast: Vec2 | null = null;

  init(deps: TouchControllerDeps): void {
    this.world = deps.world;
    this.camera = deps.camera;
    this.onHudRefresh = deps.onHudRefresh;
    input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
  }

  onDestroy(): void {
    input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
  }

  setMode(mode: TouchMode): void {
    this.mode = mode;
    if (mode !== 'build') {
      this.selectedBuild = null;
      this.world.setBuildMode(null);
    }
    this.onHudRefresh();
  }

  setBuildType(type: BuildingType | null): void {
    this.selectedBuild = type;
    this.world.setBuildMode(type);
    this.mode = type ? 'build' : 'command';
    this.onHudRefresh();
  }

  recruit(role: UnitRole): void {
    this.world.recruit(role);
    this.onHudRefresh();
  }

  private onTouchStart(event: EventTouch): void {
    this.panLast = event.getLocation();
  }

  private onTouchMove(event: EventTouch): void {
    const loc = event.getLocation();
    if (!this.panLast) {
      this.panLast = loc;
      return;
    }
    const dx = loc.x - this.panLast.x;
    const dy = loc.y - this.panLast.y;
    this.camera.pan(-dx, dy);
    this.panLast = loc;
  }

  private onTouchEnd(event: EventTouch): void {
    const start = event.getStartLocation();
    const end = event.getLocation();
    const dist = Vec2.distance(start, end);
    this.panLast = null;
    if (dist > 12) return;
    this.handleTap(this.camera.screenToWorld(end.x, end.y, 720));
  }

  private handleTap(point: RtsVector): void {
    if (this.mode === 'build' && this.selectedBuild) {
      this.world.placeBuilding(this.selectedBuild, point);
      this.onHudRefresh();
      return;
    }

    const unit = this.world.getUnitAt(point);
    const building = this.world.getBuildingAt(point);

    if (unit?.factionId === 'player') {
      this.world.selectSingleUnit(point);
      this.onHudRefresh();
      return;
    }

    if (building?.factionId === 'player') {
      this.onHudRefresh();
      return;
    }

    if (unit && unit.factionId !== 'player') {
      this.world.commandSelectedAttack(unit.id);
      this.onHudRefresh();
      return;
    }

    if (this.world.state.selectedUnitIds.length > 0) {
      this.world.commandSelectedMove(point);
      this.onHudRefresh();
    }
  }
}
