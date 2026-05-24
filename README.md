# 像素风肉鸽游戏 (Pixel Roguelike Game)

一个支持多人实时联机的像素风肉鸽地牢爬行游戏。

## 功能特性

- 🎮 **实时多人联机** - WebSocket 支持多个玩家同时游戏
- 🎨 **像素艺术风格** - 8-bit 风格的像素图形
- 🎲 **肉鸽机制** - 随机生成的地牢和物品
- ⚔️ **战斗系统** - 实时 PvE 战斗
- 💎 **物品和升级** - 捡取物品提升角色属性
- 🌊 **波次系统** - 逐波增加难度的敌人

## 技术栈

**后端：**
- Node.js + Express
- WebSocket (ws)
- TypeScript

**前端（两套客户端）：**
- **Canvas 版**（`src/client/`）：HTML5 Canvas + Webpack，适合快速调试
- **Cocos 版**（`cocos-client/`）：Cocos Creator 3.8 + WebGL，**推荐手机/生产环境**，解决单位多时卡顿

**共享逻辑：**
- `src/shared/rts-world.ts` — RTS 模拟（建造、战斗、经济、寻路）

## 快速开始

### 安装依赖
```bash
npm install
```

### 开发模式
```bash
npm run dev
```

### 构建生产版本
```bash
npm run build
```

### 启动服务器
```bash
npm start
```

然后在浏览器中访问 `http://localhost:3000`

### Cocos 高性能客户端（推荐手机）

1. 安装 [Cocos Creator 3.8+](https://www.cocos.com/creator-download)
2. 同步共享逻辑：`npm run cocos:sync`
3. 用 Cocos Dashboard 打开 `cocos-client/` 目录
4. 按 `cocos-client/README.md` 搭建场景并 **构建 Web Mobile**

Canvas 版已做模拟层优化（A* 最小堆、空间网格碰撞、视口裁剪）；完整渲染性能提升请使用 Cocos 构建。

## 游戏玩法

1. **加入游戏** - 输入昵称进入游戏
2. **移动** - 使用 WASD 或方向键移动
3. **攻击** - 靠近敌人自动攻击
4. **拾取** - 走过掉落的物品自动拾取
5. **升级** - 击杀敌人获得经验和物品
6. **波次** - 每 60 秒进入下一波，难度增加

## 游戏元素

### 敌人类型
- 🟢 **哥布林** - 简单敌人
- 🟤 **兽人** - 中等敌人
- 🟫 **巨魔** - 困难敌人
- 🔴 **龙** - 极难敌人

### 掉落物品
- 💚 **生命值** - 恢复生命值
- 🔥 **伤害+** - 增加伤害
- ⚡ **速度+** - 增加移动速度
- 🛡️ **护甲+** - 增加防御

## 项目结构

```
src/
├── server/              # 后端服务器
│   ├── server.ts       # 主服务器文件
│   ├── game.ts         # 游戏逻辑
│   └── entities.ts     # 游戏实体
├── client/             # 前端客户端
│   ├── main.ts         # 入口文件
│   ├── renderer.ts     # 渲染引擎
│   ├── game.ts         # 客户端游戏状态
│   └── network.ts      # 网络通信
├── shared/             # 共享代码
│   └── types.ts        # TypeScript 类型定义
public/
└── index.html          # 游戏页面
```

## 下一步改进

- [ ] 技能系统
- [ ] 不同职业选择
- [ ] 排行榜
- [ ] 音效和背景音乐
- [ ] 多个地图
- [ ] Boss 怪物
- [ ] 商店系统
- [ ] 动画效果

## 许可证

MIT
