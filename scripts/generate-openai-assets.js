const fs = require('fs');
const path = require('path');

const API_URL = process.env.OPENAI_IMAGE_API_URL || 'https://apexapi.roixw.com/v1/images/generations';
const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';
const SIZE = process.env.OPENAI_IMAGE_SIZE || '1024x1024';
const RESPONSE_FORMAT = process.env.OPENAI_IMAGE_RESPONSE_FORMAT || 'b64_json';
const BACKGROUND = process.env.OPENAI_IMAGE_BACKGROUND || '';
const OUTPUT_FORMAT = process.env.OPENAI_IMAGE_OUTPUT_FORMAT || '';
const RETRIES = Number(process.env.OPENAI_IMAGE_RETRIES || 2);
const RETRY_DELAY_MS = Number(process.env.OPENAI_IMAGE_RETRY_DELAY_MS || 2500);
const REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 180000);

const rootDir = path.join(__dirname, '..');
const generatedRoot = path.join(rootDir, 'public', 'assets', 'generated-openai');
const applyToGame = process.argv.includes('--apply');
const force = process.argv.includes('--force');
const onlyIndex = process.argv.indexOf('--only');
const onlyTaskName = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : '';

const commonSpriteSpec = [
  '生成一张像素风 2D 游戏角色精灵表。',
  '必须是 4 列 x 4 行的正方形精灵表，透明背景。',
  '列顺序从左到右：待机、移动帧 1、移动帧 2、攻击。',
  '行顺序从上到下：朝下、朝左、朝右、朝上。',
  '不要文字、不要英文、不要标签、不要水印、不要边框、不要网格线。',
  '每帧角色比例一致、锚点一致、脚底基准线一致。',
  '角色完整留在单帧内，武器和披风不要越过单帧边界。',
  '清晰像素风，深色描边，高对比，适合缩放到 32x32 像素阅读。',
].join('\n');

const negativeSpec = [
  '避免：文字、英文、标签、水印、边框、网格线、白底、复杂背景、角色被裁切、比例不一致、锚点漂移、模糊边缘、写实照片、厚涂插画、3D 渲染、等距透视、武器越格。',
].join('\n');

const spriteTasks = [
  ['player', '玩家冒险者，短剑，布甲，青绿色上衣，深色长裤，棕色靴子，Q 版比例。攻击帧为朝对应方向挥剑。'],
  ['commander', '城邦将领，银色头盔，蓝色披风，金色边饰，手持短剑或指挥旗，姿态沉稳威严。攻击帧表现挥剑或发出指挥动作。'],
  ['worker', '工人，棕色粗布工作服，皮靴，手持锤子或小斧，朴素可靠。工作/攻击帧表现挥动工具。'],
  ['woodcutter', '伐木工，棕绿色工作服，背小木捆，手持斧头。攻击帧表现挥斧砍伐。'],
  ['stonecutter', '采石工，灰棕色工作服，安全头巾或小帽，手持铁镐，带石灰色细节。攻击帧表现挥镐敲击。'],
  ['miner', '矿工，深色矿工服，金属头盔或矿灯，手持镐子，背小矿袋。攻击帧表现用力挥镐。'],
  ['farmer', '农夫，绿色或土黄色农装，草帽，手持草叉或镰刀。攻击帧表现挥动农具。'],
  ['trader', '商人，紫色或酒红色长袍，金色腰带，背小货包或钱袋。动作帧表现举起钱袋或短杖防身。'],
  ['swordsman', '剑盾兵，钢盔和轻甲，左手小盾，右手短剑，红色或灰色布料点缀。攻击帧表现朝对应方向挥剑，盾牌保持可见。'],
  ['spearman', '长矛兵，轻甲和绿色披肩，手持长矛。攻击帧表现长矛朝对应方向突刺，但不要越出单帧边界。'],
  ['archer', '弓箭手，绿色或棕色皮甲，背箭袋，手持短弓。攻击帧表现拉弓瞄准对应方向。'],
  ['cavalry', '中世纪骑兵，骑小型棕色战马，银色头盔，红色羽饰，红色披风，小盾牌，短矛或骑枪，金色装饰。移动帧表现马腿交替，攻击帧表现骑枪朝对应方向突刺。'],
  ['engineer', '工兵，橙棕色工程服，背工具包，手持大锤或扳手。修建/攻击帧表现敲击或修理动作。'],
  ['guard', '守卫，灰蓝色重甲，持盾和长矛，姿态稳重防御。攻击帧表现用长矛刺击，盾牌保持明显。'],
  ['goblin', '绿色小怪，小型绿色怪物，尖耳，破布衣，短刀或爪击。攻击帧表现扑击或挥刀。'],
  ['orc', '兽人，中型绿色兽人，粗壮身材，皮甲，獠牙，手持斧头或狼牙棒。攻击帧表现重击。'],
  ['troll', '巨魔，大型棕灰色巨魔，厚重身体，粗糙皮肤，破布护甲，手持木棒，体型比普通单位更壮。攻击帧表现挥棒砸击。'],
  ['dragon', '小型红龙或幼龙，翅膀，尾巴，角，金色眼睛。移动帧表现翅膀和脚步变化，攻击帧表现喷火或爪击。'],
].map(([name, subject]) => ({
  name,
  kind: 'sprite',
  output: `sprites/${name}.png`,
  applyOutput: `sprites/${name}.png`,
  prompt: `${commonSpriteSpec}\n\n角色设定：${subject}\n\n${negativeSpec}`,
}));

const extraTasks = [
  {
    name: 'forest-tiles',
    kind: 'tile',
    output: 'tiles/forest.png',
    applyOutput: 'tiles/forest.png',
    prompt: [
      '生成一张像素风地形瓦片精灵表，透明背景。',
      '必须是 4 列 x 1 行的精灵表。',
      '列顺序从左到右：草地、树木、灌木、石块。',
      '不要文字、不要英文、不要标签、不要水印、不要边框、不要网格线。',
      '每个瓦片风格统一，适合缩放到 32x32 像素。',
      '清晰像素风，深色轮廓，高对比。',
      negativeSpec,
    ].join('\n'),
  },
  {
    name: 'combat-effects',
    kind: 'effect',
    output: 'effects/combat-effects.png',
    applyOutput: 'effects/combat-effects.png',
    prompt: [
      '生成一张像素风战斗特效精灵表，透明背景。',
      '必须是 4 列 x 5 行的精灵表。',
      '四列是同一个特效从弱到强的 4 帧动画。',
      '五行从上到下：剑气斩击、长矛突刺、箭矢飞行、指挥脉冲、命中火花。',
      '不要文字、不要英文、不要标签、不要水印、不要边框、不要网格线。',
      '特效要完整留在单帧内，适合缩放到 32x32 像素。',
      '清晰像素风，高对比，透明背景。',
      negativeSpec,
    ].join('\n'),
  },
];

const tasks = [...spriteTasks, ...extraTasks];

function usage() {
  console.log([
    'Usage: node scripts/generate-openai-assets.js [--apply] [--force]',
    '       node scripts/generate-openai-assets.js --only swordsman',
    '       node scripts/generate-openai-assets.js --list',
    '',
    'Environment:',
    '  OPENAI_API_KEY                required',
    '  OPENAI_IMAGE_API_URL          default: https://apexapi.roixw.com/v1/images/generations',
    '  OPENAI_IMAGE_MODEL            default: gpt-image-2',
    '  OPENAI_IMAGE_QUALITY          default: medium',
    '  OPENAI_IMAGE_SIZE             default: 1024x1024',
    '  OPENAI_IMAGE_RESPONSE_FORMAT  default: b64_json',
    '  OPENAI_IMAGE_RETRIES          default: 2',
    '',
    'Default output:',
    '  public/assets/generated-openai/**',
    '',
    '--apply copies successful outputs into public/assets/** after generation.',
    '--force regenerates files that already exist.',
    '--only <name> generates one asset by task name.',
    '--list prints all task names.',
  ].join('\n'));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function imageBytesFromResult(result) {
  const item = result?.data?.[0];
  if (!item) throw new Error('响应中没有 data[0]');
  if (item.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item.url) {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`下载图片失败：HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('响应中没有 b64_json 或 url');
}

async function generateTask(task, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const body = {
    model: MODEL,
    prompt: task.prompt,
    n: 1,
    size: SIZE,
    quality: QUALITY,
    response_format: RESPONSE_FORMAT,
  };
  if (BACKGROUND) body.background = BACKGROUND;
  if (OUTPUT_FORMAT) body.output_format = OUTPUT_FORMAT;

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`接口返回非 JSON：${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    const message = json?.error?.message || text.slice(0, 300);
    const error = new Error(`HTTP ${response.status}: ${message}`);
    error.status = response.status;
    throw error;
  }

  return imageBytesFromResult(json);
}

async function run() {
  if (process.argv.includes('--help')) {
    usage();
    return;
  }

  if (process.argv.includes('--list')) {
    tasks.forEach((task) => console.log(task.name));
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('缺少 OPENAI_API_KEY。请先在环境变量中设置，不要把 key 写入脚本。');
    process.exit(1);
  }

  const report = [];

  const selectedTasks = onlyTaskName ? tasks.filter((task) => task.name === onlyTaskName) : tasks;
  if (onlyTaskName && selectedTasks.length === 0) {
    console.error(`未找到任务：${onlyTaskName}`);
    console.error('可用任务：');
    tasks.forEach((task) => console.error(`  ${task.name}`));
    process.exit(1);
  }

  for (const task of selectedTasks) {
    const generatedPath = path.join(generatedRoot, task.output);
    const finalPath = applyToGame ? path.join(rootDir, 'public', 'assets', task.applyOutput) : generatedPath;

    if (!force && fs.existsSync(finalPath)) {
      console.log(`[跳过] ${task.name}: ${path.relative(rootDir, finalPath)} 已存在`);
      report.push({ name: task.name, status: 'skipped', path: path.relative(rootDir, finalPath) });
      continue;
    }

    let lastError = null;
    for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
      try {
        console.log(`[生成] ${task.name} (${attempt}/${RETRIES + 1})`);
        const bytes = await generateTask(task, apiKey);
        ensureDir(generatedPath);
        fs.writeFileSync(generatedPath, bytes);

        if (applyToGame) {
          ensureDir(finalPath);
          fs.copyFileSync(generatedPath, finalPath);
        }

        console.log(`[成功] ${task.name}: ${path.relative(rootDir, finalPath)}`);
        report.push({ name: task.name, status: 'success', path: path.relative(rootDir, finalPath) });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        console.error(`[失败] ${task.name}: ${error.message}`);
        if (error.status === 401 || error.status === 403) {
          console.error('认证失败，已停止。请检查 OPENAI_API_KEY 是否正确、是否已撤销、是否属于当前 API 服务。');
          report.push({ name: task.name, status: 'failed', error: error.message });
          const reportPath = path.join(generatedRoot, 'generation-report.json');
          ensureDir(reportPath);
          fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, quality: QUALITY, size: SIZE, applyToGame, report }, null, 2)}\n`);
          process.exit(1);
        }
        if (attempt <= RETRIES) await sleep(RETRY_DELAY_MS * attempt);
      }
    }

    if (lastError) {
      report.push({ name: task.name, status: 'failed', error: lastError.message });
    }
  }

  const reportPath = path.join(generatedRoot, 'generation-report.json');
  ensureDir(reportPath);
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, quality: QUALITY, size: SIZE, applyToGame, report }, null, 2)}\n`);

  const failed = report.filter((item) => item.status === 'failed');
  console.log(`完成：成功 ${report.filter((item) => item.status === 'success').length}，跳过 ${report.filter((item) => item.status === 'skipped').length}，失败 ${failed.length}`);
  console.log(`报告：${path.relative(rootDir, reportPath)}`);
  if (failed.length > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
