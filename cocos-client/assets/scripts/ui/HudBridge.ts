import { _decorator, Component, Label } from 'cc';
import { RtsWorld } from '../sim/rts-world';
import { TouchController } from '../input/TouchController';

const { ccclass, property } = _decorator;

@ccclass('HudBridge')
export class HudBridge extends Component {
  @property(Label)
  statusLabel: Label | null = null;

  @property(Label)
  resourceLabel: Label | null = null;

  private world: RtsWorld | null = null;
  private touch: TouchController | null = null;

  init(world: RtsWorld, touch: TouchController): void {
    this.world = world;
    this.touch = touch;
  }

  resetPanels(): void {
    this.tickStatus();
  }

  tickStatus(): void {
    if (!this.world) return;
    const player = this.world.state.factions.player;
    if (this.statusLabel) {
      this.statusLabel.string = `第 ${this.world.state.day} 天 | 已选 ${this.world.state.selectedUnitIds.length}`;
    }
    if (this.resourceLabel) {
      this.resourceLabel.string =
        `粮 ${Math.floor(player.resources.food)} 木 ${Math.floor(player.resources.wood)} ` +
        `石 ${Math.floor(player.resources.stone)} 铁 ${Math.floor(player.resources.iron)} 金 ${Math.floor(player.resources.gold)}`;
    }
  }
}
