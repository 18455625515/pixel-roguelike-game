/**
 * 素材同步脚本（不再用 Node 缩放 PNG，避免解码错误导致雪花图）
 *
 * 游戏内加载原图后，由浏览器 Canvas 整体缩放到 4x4 每格 32px（见 rts-renderer / renderer）。
 *
 * Usage:
 *   npm run extract:sprite-frames:apply   # 从 generated-openai 复制原图到游戏目录
 *   node scripts/extract-sprite-frames.js --apply --prebuild  # 可选：用修复后的解码器预生成 128x128
 */

const fs = require('fs');
const path = require('path');
const { Surface } = require('./normalize-forest-tiles');

const FRAME = 32;
const SPRITE_COLS = 4;
const SPRITE_ROWS = 4;
const EFFECT_COLS = 4;
const EFFECT_ROWS = 5;

const rootDir = path.join(__dirname, '..');
const defaultSpriteInput = path.join(rootDir, 'public', 'assets', 'generated-openai', 'sprites');
const defaultSpriteOutput = path.join(rootDir, 'public', 'assets', 'sprites');
const defaultEffectInput = path.join(rootDir, 'public', 'assets', 'generated-openai', 'effects', 'combat-effects.png');
const defaultEffectOutput = path.join(rootDir, 'public', 'assets', 'effects', 'combat-effects.png');
const defaultTileInput = path.join(rootDir, 'public', 'assets', 'generated-openai', 'tiles', 'forest.png');
const defaultTileOutput = path.join(rootDir, 'public', 'assets', 'tiles', 'forest.png');

const applyToGame = process.argv.includes('--apply');
const prebuild = process.argv.includes('--prebuild');
const onlyIndex = process.argv.indexOf('--only');
const onlyName = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : '';
const onlyMode = onlyIndex >= 0;
const inputIndex = process.argv.indexOf('--input');
const inputDir = inputIndex >= 0 ? path.resolve(process.argv[inputIndex + 1]) : defaultSpriteInput;
const outputIndex = process.argv.indexOf('--output');
const outputDir = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : defaultSpriteOutput;

const processSprites = process.argv.includes('--sprites') || (!hasTargetFlag() && !onlyMode) || onlyMode;
const processEffects = process.argv.includes('--effects') || (!hasTargetFlag() && !onlyMode);
const processTiles = process.argv.includes('--tiles') || (!hasTargetFlag() && !onlyMode);

function hasTargetFlag() {
  return process.argv.some((arg) => ['--sprites', '--effects', '--tiles'].includes(arg));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function shouldSkipSpriteFile(fileName) {
  if (!fileName.endsWith('.png')) return true;
  if (fileName === 'manifest.json') return true;
  if (fileName.includes('.raw.')) return true;
  if (fileName.includes('-original-')) return true;
  if (fileName.startsWith('generate_')) return true;
  if (fileName.startsWith('extracted')) return true;
  return false;
}

function getContentBounds(surface, threshold = 48) {
  let minX = surface.width;
  let minY = surface.height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      if (surface.getPixel(x, y)[3] > threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count++;
      }
    }
  }
  if (count === 0) throw new Error('未检测到不透明像素');
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, pixelCount: count };
}

function scaleContentToSheet(source, bounds, sheetWidth, sheetHeight) {
  const output = new Surface(sheetWidth, sheetHeight);
  for (let y = 0; y < sheetHeight; y++) {
    for (let x = 0; x < sheetWidth; x++) {
      const sx = bounds.minX + Math.floor((x / sheetWidth) * bounds.width);
      const sy = bounds.minY + Math.floor((y / sheetHeight) * bounds.height);
      output.setPixel(x, y, source.getPixel(sx, sy));
    }
  }
  return output;
}

function copyFile(inputPath, outputPath) {
  ensureDir(outputPath);
  fs.copyFileSync(inputPath, outputPath);
}

function prebuildSheet(inputPath, outputPath, cols, rows) {
  const source = Surface.fromPng(fs.readFileSync(inputPath));
  const bounds = getContentBounds(source);
  const sheet = scaleContentToSheet(source, bounds, cols * FRAME, rows * FRAME);
  ensureDir(outputPath);
  fs.writeFileSync(outputPath, sheet.toPng());
  return { sourceSize: { width: source.width, height: source.height }, pixelCount: bounds.pixelCount };
}

function syncSprites(inputDirectory, outputDirectory) {
  if (!fs.existsSync(inputDirectory)) {
    console.warn(`[跳过] 目录不存在: ${path.relative(rootDir, inputDirectory)}`);
    return [];
  }
  const report = [];
  for (const file of fs.readdirSync(inputDirectory)) {
    if (shouldSkipSpriteFile(file)) continue;
    const name = path.basename(file, '.png');
    if (onlyName && onlyName !== name) continue;
    const inputPath = path.join(inputDirectory, file);
    const outputPath = path.join(outputDirectory, file);
    try {
      if (prebuild) {
        const meta = prebuildSheet(inputPath, outputPath, SPRITE_COLS, SPRITE_ROWS);
        report.push({ status: 'prebuild', name, ...meta });
        console.log(`[预生成] ${name}: ${meta.sourceSize.width}x${meta.sourceSize.height} (${meta.pixelCount}px) -> 128x128`);
      } else {
        copyFile(inputPath, outputPath);
        report.push({ status: 'copied', name });
        console.log(`[复制] ${name}`);
      }
    } catch (error) {
      report.push({ status: 'failed', name, error: error.message });
      console.error(`[失败] ${name}: ${error.message}`);
    }
  }
  return report;
}

function run() {
  if (process.argv.includes('--help')) {
    console.log('npm run extract:sprite-frames:apply  # 推荐：只复制原图，由游戏内 Canvas 缩放');
    console.log('node scripts/extract-sprite-frames.js --apply --prebuild  # 可选预生成 128x128');
    return;
  }

  const spriteOutput = applyToGame ? defaultSpriteOutput : outputDir;
  const report = { generatedAt: new Date().toISOString(), applyToGame, prebuild, note: prebuild ? 'Node 预生成' : '仅复制原图，游戏内缩放' };

  if (processSprites) {
    console.log(prebuild ? '--- 预生成精灵图 128x128 ---' : '--- 复制原图到游戏目录（推荐）---');
    report.sprites = syncSprites(inputDir, spriteOutput);
  }

  if (processEffects) {
    const effectInput = fs.existsSync(defaultEffectInput) ? defaultEffectInput : defaultEffectOutput;
    const effectOutput = applyToGame ? defaultEffectOutput : path.join(outputDir, 'combat-effects.png');
    try {
      if (prebuild) {
        const meta = prebuildSheet(effectInput, effectOutput, EFFECT_COLS, EFFECT_ROWS);
        report.effects = { status: 'prebuild', ...meta };
        console.log(`[预生成] combat-effects -> 128x160`);
      } else {
        copyFile(effectInput, effectOutput);
        report.effects = { status: 'copied' };
        console.log('[复制] combat-effects');
      }
    } catch (error) {
      report.effects = { status: 'failed', error: error.message };
      console.error(`[失败] combat-effects: ${error.message}`);
    }
  }

  if (processTiles) {
    const { normalizeForestTiles } = require('./normalize-forest-tiles');
    const tileInput = fs.existsSync(defaultTileInput) ? defaultTileInput : defaultTileOutput;
    const tileOutput = applyToGame ? defaultTileOutput : path.join(outputDir, 'forest.png');
    try {
      if (prebuild) {
        normalizeForestTiles(tileInput, tileOutput);
        report.tiles = { status: 'prebuild' };
        console.log('[预生成] forest -> 128x32');
      } else {
        copyFile(tileInput, tileOutput);
        report.tiles = { status: 'copied' };
        console.log('[复制] forest');
      }
    } catch (error) {
      report.tiles = { status: 'failed', error: error.message };
    }
  }

  const reportPath = path.join(rootDir, 'public', 'assets', 'extraction-report.json');
  ensureDir(reportPath);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) run();

module.exports = { syncSprites, prebuildSheet };
