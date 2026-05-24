/** 简化的世界地图陆域轮廓（归一化坐标 u∈[0,1] 东向，v∈[0,1] 南向） */
const WORLD_LAND_BLOBS = [
  { cx: 0.18, cy: 0.24, rx: 0.11, ry: 0.17 }, // 北美
  { cx: 0.24, cy: 0.66, rx: 0.075, ry: 0.15 }, // 南美
  { cx: 0.47, cy: 0.22, rx: 0.055, ry: 0.07 }, // 欧洲
  { cx: 0.5, cy: 0.5, rx: 0.09, ry: 0.2 }, // 非洲
  { cx: 0.68, cy: 0.28, rx: 0.17, ry: 0.15 }, // 亚洲
  { cx: 0.52, cy: 0.3, rx: 0.04, ry: 0.05 }, // 中东/印度连接
  { cx: 0.78, cy: 0.68, rx: 0.065, ry: 0.055 }, // 澳洲
  { cx: 0.5, cy: 0.9, rx: 0.42, ry: 0.045 }, // 南极
  { cx: 0.46, cy: 0.19, rx: 0.018, ry: 0.025 }, // 不列颠
  { cx: 0.12, cy: 0.12, rx: 0.05, ry: 0.06 }, // 格陵兰
];

const LAND_THRESHOLD = 0.38;

export function worldLandScore(u: number, v: number): number {
  let score = 0;
  for (const blob of WORLD_LAND_BLOBS) {
    const dx = (u - blob.cx) / blob.rx;
    const dy = (v - blob.cy) / blob.ry;
    score = Math.max(score, Math.exp(-(dx * dx + dy * dy)));
  }
  const coast = Math.sin(u * 28 + v * 19) * 0.045 + Math.cos(v * 31 - u * 12) * 0.035;
  return score + coast;
}

export function isWorldLand(u: number, v: number): boolean {
  return worldLandScore(u, v) > LAND_THRESHOLD;
}

/** 玩家推荐起始区域：西欧平原 */
export const PLAYER_START_UV = { u: 0.46, v: 0.3 };

export const FACTION_START_HINTS: Record<string, { u: number; v: number }> = {
  player: { u: 0.46, v: 0.3 },
  north: { u: 0.52, v: 0.18 },
  village: { u: 0.48, v: 0.34 },
  miners: { u: 0.58, v: 0.38 },
  south: { u: 0.5, v: 0.58 },
  raiders: { u: 0.72, v: 0.32 },
};
