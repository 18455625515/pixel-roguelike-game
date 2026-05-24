/**
 * Split 4x4 sprite sheets into individual PNG frames.
 *
 * The source images are expected to be regular sheets:
 *   columns: idle, walk1, walk2, attack
 *   rows:    down, left, right, up
 *
 * By default this script cuts exact grid cells. It does not infer one large
 * alpha bounding box first, because that can shift cell edges and pull in
 * neighboring frames or border artifacts.
 *
 * Usage:
 *   npm run split:sprites
 *   node scripts/split-sprite-sheets.js --scale 32 --rebuild-sheet
 *   node scripts/split-sprite-sheets.js --only worker --dry-run
 */

const fs = require('fs');
const path = require('path');
const { Surface } = require('./normalize-forest-tiles');

const GRID_COLS = 4;
const GRID_ROWS = 4;
const GAME_FRAME = 32;
const GAME_SHEET = GAME_FRAME * GRID_COLS;

const COLUMNS = ['idle', 'walk1', 'walk2', 'attack'];
const DIRECTIONS = ['down', 'left', 'right', 'up'];

const rootDir = path.join(__dirname, '..');
const defaultInput = path.join(rootDir, 'public', 'assets', 'generated-openai', 'sprites');
const defaultOutput = path.join(rootDir, 'public', 'assets', 'sprites', 'frames');
const defaultSheetDir = path.join(rootDir, 'public', 'assets', 'sprites');
const defaultReport = path.join(rootDir, 'public', 'assets', 'sprite-split-report.json');

const includeRaw = hasFlag('--include-raw');
const dryRun = hasFlag('--dry-run');
const rebuildSheet = hasFlag('--rebuild-sheet');
const skipSmallSheets = hasFlag('--skip-small');
const trimFrames = hasFlag('--trim');

const inputDir = getPathArg('--input', defaultInput);
const outputDir = getPathArg('--output', defaultOutput);
const sheetDir = getPathArg('--sheet-dir', defaultSheetDir);
const onlyName = getStringArg('--only', '');
const targetFrameSize = Number(getStringArg('--scale', '0'));

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getStringArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function getPathArg(flag, fallback) {
  return path.resolve(getStringArg(flag, fallback));
}

function usage() {
  console.log(`Usage:
  node scripts/split-sprite-sheets.js [options]

Options:
  --input <dir>       Sprite sheet directory. Default: public/assets/generated-openai/sprites
  --output <dir>      Frame output directory. Default: public/assets/sprites/frames
  --only <name>       Process one sprite name only.
  --scale <px>        Resize each frame to px by px. Example: --scale 32
  --rebuild-sheet     Also write a 128x128 game sheet to --sheet-dir.
  --sheet-dir <dir>   Rebuilt sheet output directory. Default: public/assets/sprites
  --trim              Trim transparent padding inside each cell before optional scaling.
  --skip-small        Skip sheets that are already 128x128 or smaller.
  --include-raw       Include generate_* files.
  --dry-run           Analyze only; do not write files.
  --help              Show this help.`);
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readPngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function shouldSkip(fileName, filePath) {
  if (!fileName.toLowerCase().endsWith('.png')) return true;
  if (fileName.includes('.raw.')) return true;
  if (fileName.includes('-original-')) return true;
  if (!includeRaw && fileName.startsWith('generate_')) return true;
  if (filePath.includes(`${path.sep}frames${path.sep}`)) return true;

  if (skipSmallSheets) {
    const size = readPngSize(filePath);
    if (size.width <= GAME_SHEET && size.height <= GAME_SHEET) return true;
  }

  return false;
}

function getGridCellRegion(source, col, row) {
  const x0 = Math.round((source.width * col) / GRID_COLS);
  const y0 = Math.round((source.height * row) / GRID_ROWS);
  const x1 = Math.round((source.width * (col + 1)) / GRID_COLS);
  const y1 = Math.round((source.height * (row + 1)) / GRID_ROWS);

  return {
    x: x0,
    y: y0,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
    column: COLUMNS[col],
    direction: DIRECTIONS[row],
    col,
    row,
    frameName: `${COLUMNS[col]}_${DIRECTIONS[row]}`,
  };
}

function extractRegion(source, region) {
  const output = new Surface(region.width, region.height);
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      output.setPixel(x, y, source.getPixel(region.x + x, region.y + y));
    }
  }
  return output;
}

function getContentBounds(surface, threshold = 8) {
  let minX = surface.width;
  let minY = surface.height;
  let maxX = -1;
  let maxY = -1;
  let pixelCount = 0;

  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      if (surface.getPixel(x, y)[3] > threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        pixelCount++;
      }
    }
  }

  if (pixelCount === 0) {
    return { x: 0, y: 0, width: surface.width, height: surface.height, pixelCount };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    pixelCount,
  };
}

function trimSurface(surface) {
  const bounds = getContentBounds(surface);
  const trimmed = extractRegion(surface, bounds);
  return { surface: trimmed, bounds };
}

function resampleSurface(surface, targetSize) {
  const output = new Surface(targetSize, targetSize);
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const sx = Math.min(surface.width - 1, Math.floor(((x + 0.5) / targetSize) * surface.width));
      const sy = Math.min(surface.height - 1, Math.floor(((y + 0.5) / targetSize) * surface.height));
      output.setPixel(x, y, surface.getPixel(sx, sy));
    }
  }
  return output;
}

function extractAllFrames(source) {
  const frames = [];

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const region = getGridCellRegion(source, col, row);
      let surface = extractRegion(source, region);
      let trimBounds = null;

      if (trimFrames) {
        const trimmed = trimSurface(surface);
        surface = trimmed.surface;
        trimBounds = trimmed.bounds;
      }

      if (targetFrameSize > 0) {
        surface = resampleSurface(surface, targetFrameSize);
      }

      frames.push({
        ...region,
        surface,
        outputWidth: surface.width,
        outputHeight: surface.height,
        trimBounds,
        index: row * GRID_COLS + col,
      });
    }
  }

  return { frames, sourceSize: { width: source.width, height: source.height } };
}

function buildSheetFromFrames(frames) {
  const sheet = new Surface(GAME_SHEET, GAME_SHEET);

  for (const frame of frames) {
    const tile =
      frame.surface.width === GAME_FRAME && frame.surface.height === GAME_FRAME
        ? frame.surface
        : resampleSurface(frame.surface, GAME_FRAME);
    sheet.copyRect(tile, 0, 0, GAME_FRAME, GAME_FRAME, frame.col * GAME_FRAME, frame.row * GAME_FRAME);
  }

  return sheet;
}

function writeFrameManifest(roleDir, name, frames, sourceSize) {
  const manifest = {
    role: name,
    sourceSize,
    columns: COLUMNS,
    directions: DIRECTIONS,
    method: trimFrames ? 'grid-4x4-trim-cell' : 'grid-4x4-exact-cell',
    extractedAt: new Date().toISOString(),
    frameCount: frames.length,
    frames: frames.map((frame) => ({
      file: `${frame.frameName}.png`,
      name: frame.frameName,
      column: frame.column,
      direction: frame.direction,
      index: frame.index,
      size: `${frame.outputWidth}x${frame.outputHeight}`,
      sourceRegion: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      trimBounds: frame.trimBounds,
    })),
  };

  const manifestPath = path.join(roleDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function processSpriteFile(fileName) {
  const name = path.basename(fileName, '.png');
  if (onlyName && onlyName !== name) return null;

  const inputPath = path.join(inputDir, fileName);
  const roleDir = path.join(outputDir, name);
  const source = Surface.fromPng(fs.readFileSync(inputPath));
  const result = extractAllFrames(source);
  const writtenFrames = [];

  if (!dryRun) {
    fs.mkdirSync(roleDir, { recursive: true });

    for (const frame of result.frames) {
      const framePath = path.join(roleDir, `${frame.frameName}.png`);
      fs.writeFileSync(framePath, frame.surface.toPng());
      writtenFrames.push(path.relative(rootDir, framePath));
    }

    writeFrameManifest(roleDir, name, result.frames, result.sourceSize);

    if (rebuildSheet) {
      const sheetPath = path.join(sheetDir, `${name}.png`);
      ensureDirForFile(sheetPath);
      fs.writeFileSync(sheetPath, buildSheetFromFrames(result.frames).toPng());
    }
  }

  return {
    status: dryRun ? 'dry-run' : 'ok',
    name,
    input: path.relative(rootDir, inputPath),
    outputDir: path.relative(rootDir, roleDir),
    sourceSize: result.sourceSize,
    method: trimFrames ? 'grid-4x4-trim-cell' : 'grid-4x4-exact-cell',
    frameSize: targetFrameSize > 0 ? `${targetFrameSize}x${targetFrameSize}` : 'native-cell',
    frames: result.frames.map((frame) => ({
      name: frame.frameName,
      size: `${frame.outputWidth}x${frame.outputHeight}`,
      source: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      trimBounds: frame.trimBounds,
    })),
    writtenFrames,
  };
}

function run() {
  if (hasFlag('--help')) {
    usage();
    return;
  }

  if (!Number.isFinite(targetFrameSize) || targetFrameSize < 0) {
    throw new Error('--scale must be a non-negative number');
  }

  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory does not exist: ${inputDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(inputDir).filter((file) => !shouldSkip(file, path.join(inputDir, file)));
  if (files.length === 0) {
    console.warn(`No PNG files found in: ${inputDir}`);
    return;
  }

  console.log('--- Split 4x4 sprite sheets into 16 frame PNGs ---');
  console.log(`Input: ${path.relative(rootDir, inputDir)}`);
  console.log(`Output: ${path.relative(rootDir, outputDir)}${path.sep}<sprite>${path.sep}`);
  console.log(`Method: ${trimFrames ? 'exact grid, trim each cell' : 'exact grid cells'}`);
  console.log(`Scale: ${targetFrameSize > 0 ? `${targetFrameSize}x${targetFrameSize}` : 'native cell size'}`);
  if (rebuildSheet) console.log(`Rebuilt sheets: ${path.relative(rootDir, sheetDir)}${path.sep}<sprite>.png`);
  if (dryRun) console.log('Dry run: no files will be written');

  const report = {
    generatedAt: new Date().toISOString(),
    method: trimFrames ? 'grid-4x4-trim-cell' : 'grid-4x4-exact-cell',
    targetFrameSize: targetFrameSize || 'native-cell',
    rebuildSheet,
    dryRun,
    inputDir: path.relative(rootDir, inputDir),
    outputDir: path.relative(rootDir, outputDir),
    sprites: [],
  };

  let okCount = 0;

  for (const file of files) {
    try {
      const entry = processSpriteFile(file);
      if (!entry) continue;
      report.sprites.push(entry);
      okCount++;
      const first = entry.frames[0];
      console.log(`[${entry.status}] ${entry.name}: ${entry.sourceSize.width}x${entry.sourceSize.height} -> 16 frames (${first.size})`);
    } catch (error) {
      report.sprites.push({
        status: 'failed',
        name: path.basename(file, '.png'),
        error: error.message,
      });
      console.error(`[failed] ${path.basename(file, '.png')}: ${error.message}`);
    }
  }

  if (!dryRun) {
    ensureDirForFile(defaultReport);
    fs.writeFileSync(defaultReport, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report: ${path.relative(rootDir, defaultReport)}`);
  }

  const failed = report.sprites.filter((item) => item.status === 'failed').length;
  console.log(`Done: ${okCount} sprites, ${okCount * 16} frames, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  extractAllFrames,
  getGridCellRegion,
  resampleSurface,
  COLUMNS,
  DIRECTIONS,
};
