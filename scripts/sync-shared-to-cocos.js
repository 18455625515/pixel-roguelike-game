const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sharedDir = path.join(root, 'src', 'shared');
const targetDir = path.join(root, 'cocos-client', 'assets', 'scripts', 'sim');

const files = ['rts-types.ts', 'rts-world.ts', 'pathfinding.ts', 'world-map.ts', 'building-catalog.ts', 'map-data.ts'];

fs.mkdirSync(targetDir, { recursive: true });

files.forEach((file) => {
  const source = path.join(sharedDir, file);
  const target = path.join(targetDir, file);
  fs.copyFileSync(source, target);
  console.log(`[sync] ${file} -> cocos-client/assets/scripts/sim/`);
});
