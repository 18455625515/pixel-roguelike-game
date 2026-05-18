const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FRAME = 32;
const COLUMNS = ['idle', 'walk1', 'walk2', 'attack'];
const DIRECTIONS = ['down', 'left', 'right', 'up'];
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'sprites');
const TILE_OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'tiles');

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
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }

  setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color[0];
    this.data[i + 1] = color[1];
    this.data[i + 2] = color[2];
    this.data[i + 3] = color[3] ?? 255;
  }

  rect(x, y, width, height, color) {
    for (let yy = y; yy < y + height; yy++) {
      for (let xx = x; xx < x + width; xx++) {
        this.setPixel(xx, yy, color);
      }
    }
  }

  checker(x, y, width, height, colorA, colorB) {
    for (let yy = y; yy < y + height; yy++) {
      for (let xx = x; xx < x + width; xx++) {
        this.setPixel(xx, yy, (xx + yy) % 2 === 0 ? colorA : colorB);
      }
    }
  }

  mirrorFrame(sourceX, sourceY, targetX, targetY, width, height) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const source = ((sourceY + y) * this.width + sourceX + x) * 4;
        const color = [
          this.data[source],
          this.data[source + 1],
          this.data[source + 2],
          this.data[source + 3],
        ];
        this.setPixel(targetX + width - 1 - x, targetY + y, color);
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

const colors = {
  outline: [28, 20, 24, 255],
  shadow: [47, 39, 55, 180],
  eye: [255, 250, 214, 255],
  sword: [214, 228, 232, 255],
  player: {
    skin: [219, 171, 120, 255],
    hair: [74, 49, 45, 255],
    tunic: [64, 169, 159, 255],
    trim: [248, 196, 64, 255],
    pants: [42, 75, 117, 255],
    boots: [69, 45, 35, 255],
  },
  goblin: {
    skin: [103, 177, 83, 255],
    dark: [48, 94, 54, 255],
    cloth: [118, 73, 53, 255],
    accent: [221, 80, 62, 255],
  },
  orc: {
    skin: [91, 135, 63, 255],
    dark: [39, 73, 45, 255],
    cloth: [96, 67, 56, 255],
    accent: [164, 154, 128, 255],
  },
  troll: {
    skin: [121, 95, 78, 255],
    dark: [69, 53, 51, 255],
    cloth: [66, 72, 88, 255],
    accent: [171, 132, 87, 255],
  },
  dragon: {
    skin: [185, 48, 55, 255],
    dark: [105, 32, 45, 255],
    wing: [86, 44, 74, 255],
    accent: [247, 185, 68, 255],
  },
};

const forest = {
  grassA: [38, 91, 54, 255],
  grassB: [44, 111, 63, 255],
  grassC: [70, 141, 76, 255],
  leafDark: [25, 78, 47, 255],
  leaf: [41, 118, 61, 255],
  leafLight: [75, 159, 84, 255],
  bark: [100, 70, 48, 255],
  barkDark: [61, 45, 38, 255],
  stone: [91, 103, 98, 255],
  flower: [231, 91, 96, 255],
};

function frameOffset(column, direction) {
  return {
    x: COLUMNS.indexOf(column) * FRAME,
    y: DIRECTIONS.indexOf(direction) * FRAME,
  };
}

function drawHumanoid(surface, originX, originY, direction, frame, palette) {
  const step = frame === 'walk1' ? -2 : frame === 'walk2' ? 2 : 0;
  const attacking = frame === 'attack';
  const side = direction === 'left' || direction === 'right';
  const faceLeft = direction === 'left';
  const facingUp = direction === 'up';

  surface.rect(originX + 9, originY + 29, 14, 2, colors.shadow);

  surface.rect(originX + 10, originY + 14, 12, 10, colors.outline);
  surface.rect(originX + 11, originY + 15, 10, 8, palette.tunic);
  surface.rect(originX + 11, originY + 21, 10, 2, palette.trim);

  surface.rect(originX + 9, originY + 23, 5, 6 + Math.max(step, 0), colors.outline);
  surface.rect(originX + 18, originY + 23, 5, 6 + Math.max(-step, 0), colors.outline);
  surface.rect(originX + 10, originY + 23, 3, 5 + Math.max(step, 0), palette.pants);
  surface.rect(originX + 19, originY + 23, 3, 5 + Math.max(-step, 0), palette.pants);
  surface.rect(originX + 8, originY + 28 + Math.max(step, 0), 6, 2, palette.boots);
  surface.rect(originX + 18, originY + 28 + Math.max(-step, 0), 6, 2, palette.boots);

  surface.rect(originX + 8, originY + 5, 16, 12, colors.outline);
  surface.rect(originX + 9, originY + 6, 14, 10, palette.skin);
  surface.rect(originX + 8, originY + 5, 16, 4, palette.hair);

  if (facingUp) {
    surface.rect(originX + 9, originY + 8, 14, 5, palette.hair);
  } else if (side) {
    const eyeX = faceLeft ? originX + 10 : originX + 19;
    surface.rect(eyeX, originY + 11, 2, 2, colors.eye);
  } else {
    surface.rect(originX + 11, originY + 11, 2, 2, colors.eye);
    surface.rect(originX + 19, originY + 11, 2, 2, colors.eye);
  }

  if (attacking) {
    if (direction === 'left') {
      surface.rect(originX + 2, originY + 13, 9, 2, colors.sword);
      surface.rect(originX + 4, originY + 11, 2, 6, colors.sword);
    } else if (direction === 'right') {
      surface.rect(originX + 21, originY + 13, 9, 2, colors.sword);
      surface.rect(originX + 26, originY + 11, 2, 6, colors.sword);
    } else if (direction === 'up') {
      surface.rect(originX + 15, originY + 0, 2, 8, colors.sword);
      surface.rect(originX + 13, originY + 1, 6, 2, colors.sword);
    } else {
      surface.rect(originX + 15, originY + 19, 2, 10, colors.sword);
      surface.rect(originX + 13, originY + 25, 6, 2, colors.sword);
    }
  }
}

function drawMonster(surface, originX, originY, direction, frame, palette, kind) {
  const step = frame === 'walk1' ? -1 : frame === 'walk2' ? 1 : 0;
  const attacking = frame === 'attack';
  const isDragon = kind === 'dragon';
  const isTroll = kind === 'troll';

  surface.rect(originX + 8, originY + 29, 16, 2, colors.shadow);

  if (isDragon) {
    surface.rect(originX + 3, originY + 12, 8, 10, colors.outline);
    surface.rect(originX + 21, originY + 12, 8, 10, colors.outline);
    surface.rect(originX + 4, originY + 13, 6, 8, palette.wing);
    surface.rect(originX + 22, originY + 13, 6, 8, palette.wing);
  }

  const bodyWidth = isTroll ? 18 : 16;
  const bodyX = originX + (32 - bodyWidth) / 2;
  surface.rect(bodyX, originY + 13, bodyWidth, 12, colors.outline);
  surface.rect(bodyX + 1, originY + 14, bodyWidth - 2, 10, palette.skin);
  surface.rect(bodyX + 4, originY + 22, bodyWidth - 8, 3, palette.cloth ?? palette.dark);

  surface.rect(originX + 8, originY + 6, 16, 11, colors.outline);
  surface.rect(originX + 9, originY + 7, 14, 9, palette.skin);

  if (kind === 'goblin') {
    surface.rect(originX + 5, originY + 8, 4, 4, colors.outline);
    surface.rect(originX + 23, originY + 8, 4, 4, colors.outline);
    surface.rect(originX + 6, originY + 9, 3, 2, palette.skin);
    surface.rect(originX + 23, originY + 9, 3, 2, palette.skin);
  }

  if (kind === 'orc') {
    surface.rect(originX + 10, originY + 4, 4, 3, palette.accent);
    surface.rect(originX + 18, originY + 4, 4, 3, palette.accent);
    surface.rect(originX + 12, originY + 15, 2, 2, colors.eye);
    surface.rect(originX + 18, originY + 15, 2, 2, colors.eye);
  } else if (direction !== 'up') {
    surface.rect(originX + 11, originY + 11, 2, 2, colors.eye);
    surface.rect(originX + 19, originY + 11, 2, 2, colors.eye);
  }

  if (isTroll) {
    surface.rect(originX + 7, originY + 4, 18, 3, palette.dark);
    surface.rect(originX + 6, originY + 18, 3, 7, colors.outline);
    surface.rect(originX + 23, originY + 18, 3, 7, colors.outline);
  }

  surface.rect(originX + 10, originY + 25, 5, 4 + Math.max(step, 0), colors.outline);
  surface.rect(originX + 17, originY + 25, 5, 4 + Math.max(-step, 0), colors.outline);
  surface.rect(originX + 11, originY + 25, 3, 3 + Math.max(step, 0), palette.dark);
  surface.rect(originX + 18, originY + 25, 3, 3 + Math.max(-step, 0), palette.dark);

  if (attacking) {
    if (isDragon) {
      surface.rect(originX + 12, originY + 2, 8, 3, palette.accent);
      surface.rect(originX + 14, originY + 0, 4, 2, palette.accent);
    } else {
      surface.rect(originX + 5, originY + 16, 5, 3, palette.accent);
      surface.rect(originX + 22, originY + 16, 5, 3, palette.accent);
    }
  }
}

function makeSheet(name, drawer) {
  const surface = new Surface(FRAME * COLUMNS.length, FRAME * DIRECTIONS.length);
  for (const direction of DIRECTIONS) {
    for (const column of COLUMNS) {
      const { x, y } = frameOffset(column, direction);
      drawer(surface, x, y, direction, column);
    }
  }

  const fileName = `${name}.png`;
  fs.writeFileSync(path.join(OUT_DIR, fileName), surface.toPng());
  return fileName;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TILE_OUT_DIR, { recursive: true });

const sheets = {
  player: makeSheet('player', (surface, x, y, direction, frame) => {
    drawHumanoid(surface, x, y, direction, frame, colors.player);
  }),
  goblin: makeSheet('goblin', (surface, x, y, direction, frame) => {
    drawMonster(surface, x, y, direction, frame, colors.goblin, 'goblin');
  }),
  orc: makeSheet('orc', (surface, x, y, direction, frame) => {
    drawMonster(surface, x, y, direction, frame, colors.orc, 'orc');
  }),
  troll: makeSheet('troll', (surface, x, y, direction, frame) => {
    drawMonster(surface, x, y, direction, frame, colors.troll, 'troll');
  }),
  dragon: makeSheet('dragon', (surface, x, y, direction, frame) => {
    drawMonster(surface, x, y, direction, frame, colors.dragon, 'dragon');
  }),
};

const manifest = {
  frameWidth: FRAME,
  frameHeight: FRAME,
  columns: COLUMNS,
  directions: DIRECTIONS,
  sheets,
};

fs.writeFileSync(
  path.join(OUT_DIR, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);

function drawGrassTile(surface, x, y) {
  surface.checker(x, y, FRAME, FRAME, forest.grassA, forest.grassB);
  surface.rect(x + 4, y + 5, 2, 5, forest.grassC);
  surface.rect(x + 18, y + 3, 2, 4, forest.grassC);
  surface.rect(x + 25, y + 19, 2, 5, forest.grassC);
  surface.rect(x + 8, y + 23, 3, 2, forest.grassC);
  surface.rect(x + 14, y + 15, 2, 2, forest.flower);
}

function drawTreeTile(surface, x, y) {
  drawGrassTile(surface, x, y);
  surface.rect(x + 13, y + 16, 6, 12, forest.barkDark);
  surface.rect(x + 14, y + 16, 4, 12, forest.bark);
  surface.rect(x + 7, y + 5, 18, 15, forest.leafDark);
  surface.rect(x + 9, y + 3, 14, 17, forest.leaf);
  surface.rect(x + 12, y + 6, 8, 6, forest.leafLight);
  surface.rect(x + 5, y + 11, 4, 7, forest.leaf);
  surface.rect(x + 23, y + 11, 4, 7, forest.leaf);
}

function drawBushTile(surface, x, y) {
  drawGrassTile(surface, x, y);
  surface.rect(x + 5, y + 15, 22, 10, forest.leafDark);
  surface.rect(x + 7, y + 13, 18, 10, forest.leaf);
  surface.rect(x + 10, y + 15, 5, 3, forest.leafLight);
  surface.rect(x + 19, y + 16, 4, 3, forest.leafLight);
}

function drawStoneTile(surface, x, y) {
  drawGrassTile(surface, x, y);
  surface.rect(x + 10, y + 16, 13, 8, [49, 56, 58, 255]);
  surface.rect(x + 11, y + 14, 11, 8, forest.stone);
  surface.rect(x + 14, y + 15, 5, 2, [139, 151, 143, 255]);
}

function makeForestTiles() {
  const surface = new Surface(FRAME * 4, FRAME);
  drawGrassTile(surface, 0, 0);
  drawTreeTile(surface, FRAME, 0);
  drawBushTile(surface, FRAME * 2, 0);
  drawStoneTile(surface, FRAME * 3, 0);
  fs.writeFileSync(path.join(TILE_OUT_DIR, 'forest.png'), surface.toPng());

  const tileManifest = {
    tileWidth: FRAME,
    tileHeight: FRAME,
    tiles: ['grass', 'tree', 'bush', 'stone'],
    sheet: 'forest.png',
  };
  fs.writeFileSync(
    path.join(TILE_OUT_DIR, 'forest.json'),
    `${JSON.stringify(tileManifest, null, 2)}\n`
  );
}

makeForestTiles();

console.log(`Generated ${Object.keys(sheets).length} sprite sheets in ${OUT_DIR}`);
console.log(`Generated forest tiles in ${TILE_OUT_DIR}`);
