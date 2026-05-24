const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FRAME = 32;
const TILE_NAMES = ['grass', 'tree', 'bush', 'stone'];
const DEFAULT_INPUT = path.join(__dirname, '..', 'public', 'assets', 'tiles', 'forest.png');
const DEFAULT_OUTPUT = DEFAULT_INPUT;
const DEFAULT_MANIFEST = path.join(__dirname, '..', 'public', 'assets', 'tiles', 'forest.json');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

class Surface {
  constructor(width, height, data = null) {
    this.width = width;
    this.height = height;
    this.data = data ?? Buffer.alloc(width * height * 4);
  }

  static fromPng(buffer) {
    const signature = buffer.subarray(0, 8).toString('hex');
    if (signature !== '89504e470d0a1a0a') {
      throw new Error('不是有效的 PNG 文件');
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let colorType = 6;
    const idatChunks = [];

    while (offset < buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      const data = buffer.subarray(offset + 8, offset + 8 + length);
      offset += 12 + length;

      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        colorType = data[9];
      } else if (type === 'IDAT') {
        idatChunks.push(data);
      } else if (type === 'IEND') {
        break;
      }
    }

    const bytesPerPixel = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (!bytesPerPixel) {
      throw new Error(`不支持的 PNG 颜色类型: ${colorType}`);
    }

    const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
    const surface = new Surface(width, height);
    const rowByteWidth = width * bytesPerPixel;
    let sourceOffset = 0;

    const paethPredictor = (left, up, upLeft) => {
      const p = left + up - upLeft;
      const pLeft = Math.abs(p - left);
      const pUp = Math.abs(p - up);
      const pUpLeft = Math.abs(p - upLeft);
      if (pLeft <= pUp && pLeft <= pUpLeft) return left;
      if (pUp <= pUpLeft) return up;
      return upLeft;
    };

    let previous = Buffer.alloc(rowByteWidth);

    for (let y = 0; y < height; y++) {
      const filterType = inflated[sourceOffset++];
      const row = Buffer.alloc(rowByteWidth);

      for (let i = 0; i < rowByteWidth; i++) {
        const raw = inflated[sourceOffset++];
        const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
        const up = previous[i];
        const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;

        if (filterType === 0) row[i] = raw;
        else if (filterType === 1) row[i] = (raw + left) & 0xff;
        else if (filterType === 2) row[i] = (raw + up) & 0xff;
        else if (filterType === 3) row[i] = (raw + Math.floor((left + up) / 2)) & 0xff;
        else row[i] = (raw + paethPredictor(left, up, upLeft)) & 0xff;
      }

      for (let x = 0; x < width; x++) {
        if (colorType === 6) {
          const i = x * 4;
          surface.setPixel(x, y, [row[i], row[i + 1], row[i + 2], row[i + 3]]);
        } else if (colorType === 2) {
          const i = x * 3;
          surface.setPixel(x, y, [row[i], row[i + 1], row[i + 2], 255]);
        } else if (colorType === 4) {
          const i = x * 2;
          const gray = row[i];
          surface.setPixel(x, y, [gray, gray, gray, row[i + 1]]);
        } else if (colorType === 0) {
          const gray = row[x];
          surface.setPixel(x, y, [gray, gray, gray, 255]);
        }
      }

      previous = row;
    }

    return surface;
  }

  getPixel(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color[0];
    this.data[i + 1] = color[1];
    this.data[i + 2] = color[2];
    this.data[i + 3] = color[3] ?? 255;
  }

  copyRect(source, sx, sy, sw, sh, dx, dy) {
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        this.setPixel(dx + x, dy + y, source.getPixel(sx + x, sy + y));
      }
    }
  }

  toPng() {
    const raw = Buffer.alloc((this.width * 4 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      const rowStart = y * (this.width * 4 + 1);
      raw[rowStart] = 0;
      this.data.copy(raw, rowStart + 1, y * this.width * 4, (y + 1) * this.width * 4);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

function detectTileRegions(surface, tileCount = 4) {
  const alphaThreshold = 64;
  const opaquePixels = [];

  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      if (surface.getPixel(x, y)[3] > alphaThreshold) {
        opaquePixels.push({ x, y });
      }
    }
  }

  if (opaquePixels.length === 0) {
    throw new Error('未在图片中检测到不透明像素');
  }

  let sumX = 0;
  let sumY = 0;
  for (const pixel of opaquePixels) {
    sumX += pixel.x;
    sumY += pixel.y;
  }
  const centerX = sumX / opaquePixels.length;
  const centerY = sumY / opaquePixels.length;
  const bandHeight = Math.max(96, Math.floor(surface.height * 0.22));
  const bandMinY = Math.max(0, Math.floor(centerY - bandHeight / 2));
  const bandMaxY = Math.min(surface.height - 1, Math.floor(centerY + bandHeight / 2));
  const bandPixels = opaquePixels.filter((pixel) => pixel.y >= bandMinY && pixel.y <= bandMaxY);

  if (bandPixels.length === 0) {
    throw new Error('未在瓦片主行区域检测到内容');
  }

  let minX = bandPixels[0].x;
  let maxX = bandPixels[0].x;
  for (const pixel of bandPixels) {
    minX = Math.min(minX, pixel.x);
    maxX = Math.max(maxX, pixel.x);
  }

  const totalWidth = maxX - minX + 1;
  const sliceWidth = Math.floor(totalWidth / tileCount);
  const regions = [];

  for (let index = 0; index < tileCount; index++) {
    const sliceStart = minX + index * sliceWidth;
    const sliceEnd = index === tileCount - 1 ? maxX : sliceStart + sliceWidth - 1;
    const slicePixels = bandPixels.filter((pixel) => pixel.x >= sliceStart && pixel.x <= sliceEnd);

    if (slicePixels.length === 0) {
      throw new Error(`第 ${index + 1} 列未检测到瓦片内容`);
    }

    let regionMinX = slicePixels[0].x;
    let regionMaxX = slicePixels[0].x;
    let regionMinY = slicePixels[0].y;
    let regionMaxY = slicePixels[0].y;
    for (const pixel of slicePixels) {
      regionMinX = Math.min(regionMinX, pixel.x);
      regionMaxX = Math.max(regionMaxX, pixel.x);
      regionMinY = Math.min(regionMinY, pixel.y);
      regionMaxY = Math.max(regionMaxY, pixel.y);
    }

    const width = regionMaxX - regionMinX + 1;
    const height = regionMaxY - regionMinY + 1;
    const size = Math.max(width, height);
    const x = Math.max(0, regionMinX + Math.floor((width - size) / 2));
    const y = Math.max(0, regionMinY + Math.floor((height - size) / 2));

    regions.push({
      x,
      y,
      width: Math.min(size, surface.width - x),
      height: Math.min(size, surface.height - y),
    });
  }

  return regions;
}

function resampleTile(source, region) {
  const output = new Surface(FRAME, FRAME);
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const sx = region.x + Math.floor(((x + 0.5) / FRAME) * region.width);
      const sy = region.y + Math.floor(((y + 0.5) / FRAME) * region.height);
      output.setPixel(x, y, source.getPixel(sx, sy));
    }
  }
  return output;
}

function normalizeForestTiles(inputPath = DEFAULT_INPUT, outputPath = DEFAULT_OUTPUT, manifestPath = DEFAULT_MANIFEST) {
  const source = Surface.fromPng(fs.readFileSync(inputPath));
  const regions = detectTileRegions(source);
  const sheet = new Surface(FRAME * regions.length, FRAME);

  regions.forEach((region, index) => {
    const tile = resampleTile(source, region);
    sheet.copyRect(tile, 0, 0, FRAME, FRAME, index * FRAME, 0);
  });

  fs.writeFileSync(outputPath, sheet.toPng());
  const manifest = {
    tileWidth: FRAME,
    tileHeight: FRAME,
    columns: regions.length,
    tiles: TILE_NAMES.slice(0, regions.length),
    sheet: path.basename(outputPath),
    source: path.basename(inputPath),
    normalizedAt: new Date().toISOString(),
    frames: regions.map((region, index) => ({
      name: TILE_NAMES[index],
      source: region,
      x: index * FRAME,
      y: 0,
      width: FRAME,
      height: FRAME,
    })),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  const inputPath = process.argv[2] || DEFAULT_INPUT;
  const outputPath = process.argv[3] || DEFAULT_OUTPUT;
  const manifest = normalizeForestTiles(inputPath, outputPath);
  console.log(`已规范化地形精灵图：${outputPath}`);
  console.log(`尺寸：${manifest.columns * manifest.tileWidth}x${manifest.tileHeight}`);
  manifest.frames.forEach((frame) => {
    console.log(`  ${frame.name}: 源区域 ${frame.source.width}x${frame.source.height} @ (${frame.source.x}, ${frame.source.y})`);
  });
}

module.exports = { normalizeForestTiles, Surface };
