import { BuildingType, ResourceType } from './rts-types';

export interface BuildingCatalogEntry {
  type: BuildingType;
  name: string;
  summary: string;
  effects: string[];
  costText: string;
}

const costText = (cost: Partial<Record<ResourceType, number>>): string => {
  const parts: string[] = [];
  const order: ResourceType[] = ['food', 'wood', 'stone', 'iron', 'gold'];
  order.forEach((key) => {
    const value = cost[key];
    if (value) parts.push(`${key === 'food' ? '粮' : key === 'wood' ? '木' : key === 'stone' ? '石' : key === 'iron' ? '铁' : '金'}${value}`);
  });
  return parts.length ? parts.join(' ') : '免费';
};

export const BUILDING_CATALOG: Record<BuildingType, BuildingCatalogEntry> = {
  townHall: {
    type: 'townHall',
    name: '主城',
    summary: '城邦核心，提供人口上限并解锁招募与高级建造。',
    effects: ['人口上限 +10', '可招募单位', '可下达建造指令', '范围内友军缓慢回血'],
    costText: costText({ wood: 120, stone: 80 }),
  },
  house: {
    type: 'house',
    name: '民居',
    summary: '安置平民，扩展可招募人口上限。',
    effects: ['人口上限 +6', '提升长期兵源与劳动力'],
    costText: costText({ wood: 35 }),
  },
  farm: {
    type: 'farm',
    name: '农田',
    summary: '稳定产出粮食，支撑军队与招募。',
    effects: ['每秒 +4 粮食（需工人/农民采集田地）', '可改造高肥力草地'],
    costText: costText({ wood: 20 }),
  },
  lumberCamp: {
    type: 'lumberCamp',
    name: '伐木场',
    summary: '加工木材，并小幅提升木材被动收入。',
    effects: ['每秒 +2 木材', '伐木工可就近交付'],
    costText: costText({ wood: 30 }),
  },
  warehouse: {
    type: 'warehouse',
    name: '仓库',
    summary: '集中储存资源，采集单位优先回传此处。',
    effects: ['作为采集回传目标', '可打开建造菜单'],
    costText: costText({ wood: 45, stone: 15 }),
  },
  barracks: {
    type: 'barracks',
    name: '兵营',
    summary: '训练军事单位，是扩张军力的基础。',
    effects: ['可招募军事单位', '可打开建造菜单'],
    costText: costText({ wood: 80, stone: 35 }),
  },
  market: {
    type: 'market',
    name: '市场',
    summary: '贸易枢纽，持续产生金币收入。',
    effects: ['每秒 +2 金币', '商人活动加成（后续可扩展）'],
    costText: costText({ wood: 70, gold: 30 }),
  },
  smithy: {
    type: 'smithy',
    name: '铁匠铺',
    summary: '冶炼装备，提升铁矿利用效率。',
    effects: ['每秒 +1 铁矿', '军事单位维护折扣（规划）'],
    costText: costText({ wood: 55, stone: 40, iron: 20 }),
  },
  stable: {
    type: 'stable',
    name: '马厩',
    summary: '饲养战马，便于招募骑兵与快速巡逻。',
    effects: ['可在此招募骑兵', '友军骑兵移速 +5%（规划）'],
    costText: costText({ wood: 65, food: 40, gold: 25 }),
  },
  wall: {
    type: 'wall',
    name: '城墙',
    summary: '阻挡敌军行进，可拖动连续铺设。',
    effects: ['高耐久防线', '可串联成要塞线'],
    costText: costText({ stone: 12 }),
  },
  gate: {
    type: 'gate',
    name: '城门',
    summary: '防线出入口，友军可通过。',
    effects: ['与城墙衔接', '较高耐久'],
    costText: costText({ wood: 25, stone: 20 }),
  },
  bridge: {
    type: 'bridge',
    name: '桥梁',
    summary: '跨越水域，连接两片陆地。',
    effects: ['可建在桥梁地形', '打通补给线'],
    costText: costText({ wood: 45, stone: 10 }),
  },
  tower: {
    type: 'tower',
    name: '箭塔',
    summary: '自动射击附近敌军。',
    effects: ['对进入射程的敌人造成伤害', '适合扼守要道'],
    costText: costText({ wood: 40, stone: 55 }),
  },
};
