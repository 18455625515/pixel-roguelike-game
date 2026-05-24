import { _decorator, Component, Node, UITransform, view, Canvas, director, Color, Graphics } from 'cc';
import { RtsWorld } from '../sim/rts-world';
import { TerrainLayer } from '../render/TerrainLayer';
import { UnitPool } from '../render/UnitPool';
import { BuildingLayer } from '../render/BuildingLayer';
import { CombatFxPool } from '../render/CombatFxPool';
import { GameCamera } from '../render/GameCamera';
import { TouchController } from '../input/TouchController';
import { HudBridge } from '../ui/HudBridge';

const { ccclass, property } = _decorator;

/**
 * 游戏主入口：在 Cocos 场景中挂载到 Canvas 子节点。
 * 使用 WebGL 批处理 + 对象池 + 视口裁剪，解决 Canvas2D 单位多时卡顿。
 */
@ccclass('GameApp')
export class GameApp extends Component {
  @property(Node)
  joinPanel: Node | null = null;

  @property(Node)
  gameRoot: Node | null = null;

  private world = new RtsWorld();
  private terrainLayer: TerrainLayer | null = null;
  private unitPool: UnitPool | null = null;
  private buildingLayer: BuildingLayer | null = null;
  private combatFx: CombatFxPool | null = null;
  private gameCamera: GameCamera | null = null;
  private touch: TouchController | null = null;
  private hud: HudBridge | null = null;
  private lastTime = 0;

  onLoad(): void {
    this.ensureSceneGraph();
    this.lastTime = performance.now();
  }

  start(): void {
    if (this.joinPanel) this.joinPanel.active = true;
    if (this.gameRoot) this.gameRoot.active = false;
  }

  /** 由 UI「开始战役」按钮调用 */
  enterGame(): void {
    if (this.joinPanel) this.joinPanel.active = false;
    if (this.gameRoot) this.gameRoot.active = true;
    this.hud?.resetPanels();
  }

  private ensureSceneGraph(): void {
    if (!this.gameRoot) {
      this.gameRoot = new Node('GameRoot');
      this.node.addChild(this.gameRoot);
    }

    const worldNode = new Node('World');
    this.gameRoot.addChild(worldNode);

    const mapNode = new Node('Map');
    worldNode.addChild(mapNode);

    this.terrainLayer = mapNode.addComponent(TerrainLayer);
    this.terrainLayer.build(this.world);

    const buildingNode = new Node('Buildings');
    worldNode.addChild(buildingNode);
    this.buildingLayer = buildingNode.addComponent(BuildingLayer);
    this.buildingLayer.init(this.world);

    const unitNode = new Node('Units');
    worldNode.addChild(unitNode);
    this.unitPool = unitNode.addComponent(UnitPool);
    this.unitPool.init(this.world);

    const fxNode = new Node('CombatFx');
    worldNode.addChild(fxNode);
    this.combatFx = fxNode.addComponent(CombatFxPool);

    this.gameCamera = this.gameRoot.addComponent(GameCamera);
    this.gameCamera.bindWorld(worldNode);

    this.touch = this.gameRoot.addComponent(TouchController);
    this.touch.init({
      world: this.world,
      camera: this.gameCamera,
      unitPool: this.unitPool,
      buildingLayer: this.buildingLayer,
      onHudRefresh: () => this.hud?.refresh(),
    });

    this.hud = this.node.getComponent(HudBridge) ?? this.node.addComponent(HudBridge);
    this.hud.init(this.world, this.touch);
  }

  update(dt: number): void {
    if (!this.gameRoot?.active) return;

    this.world.update(dt);
    const bounds = this.gameCamera?.getViewBounds() ?? null;

    this.unitPool?.sync(this.world.state, bounds);
    this.buildingLayer?.sync(this.world.state, bounds);
    this.combatFx?.sync(this.world.state.combatEvents, bounds);
    this.hud?.tickStatus();
  }
}
