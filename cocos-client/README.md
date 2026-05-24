# 边境城邦指挥官 — Cocos Creator 客户端

使用 **Cocos Creator 3.8+**（WebGL 批处理 + 对象池 + 视口裁剪）替代 Canvas2D，解决单位数量多时手机卡顿。

## 性能对比（设计目标）

| 项目 | 旧 Canvas2D | Cocos 客户端 |
|------|-------------|--------------|
| 地形 | 每帧逐格 `fillRect` | 启动时分块烘焙，运行时 0 绘制 |
| 单位 | 全图遍历 + `drawImage` | 视口内对象池 + Sprite 批处理 |
| 碰撞 | O(n²) 全单位两两检测 | 空间网格 O(n) |
| A* | 每步 `open.sort()` | 最小堆 |

## 环境要求

1. 安装 [Cocos Dashboard](https://www.cocos.com/creator-download) 与 **Creator 3.8.x**
2. Node.js 18+

## 首次打开项目

```bash
# 在项目根目录
npm run cocos:sync
```

然后在 Cocos Dashboard 中 **添加项目** → 选择本目录 `cocos-client/`。

## 场景搭建（编辑器内，约 5 分钟）

1. 新建 **2D 场景** `Main`，保存到 `assets/scenes/Main.scene`
2. 层级结构：
   ```
   Canvas
   ├── JoinPanel (空节点 + JoinPanel 组件 + Button「开始战役」)
   └── GameRoot (空节点，默认 inactive)
       └── GameHost (挂 GameApp 组件)
           - GameApp.joinPanel → JoinPanel
           - GameApp.gameRoot → GameRoot
   ```
3. 可选：在 Canvas 下添加 Label 绑定 `HudBridge.statusLabel` / `resourceLabel`
4. **构建发布** → Web Mobile → 输出目录可部署到 nginx

## 同步游戏逻辑

模拟逻辑与 Web 版共用 `src/shared/`：

```bash
npm run cocos:sync   # 复制 rts-world.ts / rts-types.ts / pathfinding.ts
```

修改 `src/shared/rts-world.ts` 后请重新执行同步。

## 精灵资源（可选）

将拆分帧复制到 Cocos 资源目录以便 `UnitPool` 加载：

```
public/assets/sprites/frames/{role}/idle_down.png
  → cocos-client/assets/resources/sprites/{role}/idle_down.png
```

未复制时单位显示为色块，不影响逻辑与性能测试。

## 命令行构建（需本机已安装 Creator）

```bash
/Applications/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project ./cocos-client \
  --build "platform=web-mobile;debug=false"
```

Windows 将路径换为 `CocosCreator.exe` 安装位置。

## 与旧版 Web 包共存

- **开发调试**：继续 `npm run build && npm start` 使用 Canvas 版（已做模拟层优化）
- **生产 / 手机**：发布 Cocos Web Mobile 构建产物，静态资源放 CDN，`/assets/` 长缓存
