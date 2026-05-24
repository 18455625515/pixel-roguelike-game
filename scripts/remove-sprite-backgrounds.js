/**
 * Remove flat or near-flat backgrounds from large sprite sheets.
 *
 * This script only removes pixels that are connected to the image edge and
 * close to the sampled edge background color. That keeps similarly colored
 * details inside the character from being erased.
 *
 * Usage:
 *   node scripts/remove-sprite-backgrounds.js --dry-run
 *   node scripts/remove-sprite-backgrounds.js --output public/assets/generated-openai/sprites-transparent
 *   node scripts/remove-sprite-backgrounds.js --only worker --tolerance 28 --feather 2
 */

const fs = require('fs');
const path = require('path');
const { Surface } = require('./normalize-forest-tiles');

const rootDir = path.join(__dirname, '..');
const defaultInput = path.join(rootDir, 'public', 'assets', 'generated-openai', 'sprites');
const defaultOutput = path.join(rootDir, 'public', 'assets', 'generated-openai', 'sprites-transparent');
const defaultReport = path.join(rootDir, 'public', 'assets', 'background-removal-report.json');

const dryRun = hasFlag('--dry-run');
const overwrite = hasFlag('--overwrite');
const includeRaw = hasFlag('--include-raw');
const inputDir = getPathArg('--input', defaultInput);
const outputDir = getPathArg('--output', overwrite ? inputDir : defaultOutput);
const onlyName = getStringArg('--only', '');
const tolerance = Number(getStringArg('--tolerance', '30'));
const feather = Number(getStringArg('--feather', '1'));

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
  node scripts/remove-sprite-backgrounds.js [options]

Options:
  --input <dir>       Source sprite sheet directory. Default: public/assets/generated-openai/sprites
  --output <dir>      Transparent output directory. Default: public/assets/generated-openai/sprites-transparent
  --only <name>       Process one sprite name only.
  --tolerance <n>     RGB distance tolerance from edge background. Default: 30
  --feather <px>      Soften alpha for pixels near removed background. Default: 1
  --overwrite         Write output back to --input. Use carefully.
  --include-raw       Include generate_* files.
  --dry-run           Analyze only; do not write files.
  --help              Show this help.`);
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function shouldSkip(fileName) {
  if (!fileName.toLowerCase().endsWith('.png')) return true;
  if (fileName.includes('.raw.')) return true;
  if (fileName.includes('-original-')) return true;
  if (!includeRaw && fileName.startsWith('generate_')) return true;
  if (onlyName && path.basename(fileName, '.png') !== onlyName) return true;
  return false;
}

function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function sampleEdgeBackground(surface) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(surface.width, surface.height) / 64));

  for (let x = 0; x < surface.width; x += step) {
    samples.push(surface.getPixel(x, 0));
    samples.push(surface.getPixel(x, surface.height - 1));
  }

  for (let y = 0; y < surface.height; y += step) {
    samples.push(surface.getPixel(0, y));
    samples.push(surface.getPixel(surface.width - 1, y));
  }

  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const mid = samples[Math.floor(samples.length / 2)];
  return [mid[0], mid[1], mid[2], 255];
}

function isBackgroundLike(surface, x, y, background, limit) {
  const pixel = surface.getPixel(x, y);
  if (pixel[3] === 0) return true;
  return colorDistance(pixel, background) <= limit;
}

function makeBackgroundMask(surface, background, limit) {
  const total = surface.width * surface.height;
  const mask = new Uint8Array(total);
  const queue = [];

  function push(x, y) {
    if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
    const index = y * surface.width + x;
    if (mask[index]) return;
    if (!isBackgroundLike(surface, x, y, background, limit)) return;
    mask[index] = 1;
    queue.push(index);
  }

  for (let x = 0; x < surface.width; x++) {
    push(x, 0);
    push(x, surface.height - 1);
  }

  for (let y = 0; y < surface.height; y++) {
    push(0, y);
    push(surface.width - 1, y);
  }

  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const x = index % surface.width;
    const y = Math.floor(index / surface.width);
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  return mask;
}

function hasMaskedNeighbor(mask, width, height, x, y, radius) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (mask[ny * width + nx]) return true;
    }
  }
  return false;
}

function removeBackground(surface) {
  const background = sampleEdgeBackground(surface);
  const mask = makeBackgroundMask(surface, background, tolerance);
  const output = new Surface(surface.width, surface.height, Buffer.from(surface.data));
  let removed = 0;
  let softened = 0;

  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      const index = y * surface.width + x;
      if (mask[index]) {
        output.setPixel(x, y, [0, 0, 0, 0]);
        removed++;
      } else if (feather > 0 && hasMaskedNeighbor(mask, surface.width, surface.height, x, y, feather)) {
        const pixel = output.getPixel(x, y);
        const distance = colorDistance(pixel, background);
        const softLimit = tolerance + feather * 18;
        if (distance <= softLimit) {
          const keep = Math.max(0, Math.min(1, (distance - tolerance) / Math.max(1, softLimit - tolerance)));
          pixel[3] = Math.round(pixel[3] * keep);
          output.setPixel(x, y, pixel);
          softened++;
        }
      }
    }
  }

  return { surface: output, background, removed, softened };
}

function processFile(fileName) {
  const name = path.basename(fileName, '.png');
  const inputPath = path.join(inputDir, fileName);
  const outputPath = path.join(outputDir, fileName);
  const source = Surface.fromPng(fs.readFileSync(inputPath));
  const result = removeBackground(source);

  if (!dryRun) {
    ensureDirForFile(outputPath);
    fs.writeFileSync(outputPath, result.surface.toPng());
  }

  return {
    status: dryRun ? 'dry-run' : 'ok',
    name,
    input: path.relative(rootDir, inputPath),
    output: path.relative(rootDir, outputPath),
    size: `${source.width}x${source.height}`,
    background: result.background.slice(0, 3),
    tolerance,
    feather,
    removedPixels: result.removed,
    softenedPixels: result.softened,
    removedPercent: Number(((result.removed / (source.width * source.height)) * 100).toFixed(2)),
  };
}

function run() {
  if (hasFlag('--help')) {
    usage();
    return;
  }

  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('--tolerance must be a non-negative number');
  }

  if (!Number.isFinite(feather) || feather < 0) {
    throw new Error('--feather must be a non-negative number');
  }

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  const files = fs.readdirSync(inputDir).filter((file) => !shouldSkip(file));
  const report = {
    generatedAt: new Date().toISOString(),
    method: 'edge-connected-background-flood-fill',
    inputDir: path.relative(rootDir, inputDir),
    outputDir: path.relative(rootDir, outputDir),
    tolerance,
    feather,
    dryRun,
    sprites: [],
  };

  console.log('--- Remove edge-connected sprite backgrounds ---');
  console.log(`Input: ${path.relative(rootDir, inputDir)}`);
  console.log(`Output: ${path.relative(rootDir, outputDir)}`);
  console.log(`Tolerance: ${tolerance}`);
  console.log(`Feather: ${feather}`);
  if (dryRun) console.log('Dry run: no files will be written');

  for (const file of files) {
    try {
      const entry = processFile(file);
      report.sprites.push(entry);
      console.log(
        `[${entry.status}] ${entry.name}: bg rgb(${entry.background.join(',')}) removed ${entry.removedPercent}% softened ${entry.softenedPixels}`,
      );
    } catch (error) {
      report.sprites.push({ status: 'failed', name: path.basename(file, '.png'), error: error.message });
      console.error(`[failed] ${path.basename(file, '.png')}: ${error.message}`);
    }
  }

  if (!dryRun) {
    ensureDirForFile(defaultReport);
    fs.writeFileSync(defaultReport, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report: ${path.relative(rootDir, defaultReport)}`);
  }

  const failed = report.sprites.filter((item) => item.status === 'failed').length;
  console.log(`Done: ${report.sprites.length - failed} sprites, ${failed} failed`);
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
  removeBackground,
  sampleEdgeBackground,
  makeBackgroundMask,
};
