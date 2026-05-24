import { _decorator, Component, Button } from 'cc';
import { GameApp } from '../game/GameApp';

const { ccclass, property } = _decorator;

@ccclass('JoinPanel')
export class JoinPanel extends Component {
  @property(Button)
  startButton: Button | null = null;

  onLoad(): void {
    this.startButton?.node.on(Button.EventType.CLICK, this.onStart, this);
  }

  private onStart(): void {
    const app = this.node.parent?.getComponentInChildren(GameApp);
    app?.enterGame();
  }
}
