import { Game } from './game';
import { Renderer } from './renderer';
import { NetworkManager } from './network';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// Set canvas size
canvas.width = 800;
canvas.height = 600;

const game = new Game();
const renderer = new Renderer(ctx, canvas.width, canvas.height);
const network = new NetworkManager(game);

let playerName = '';

// Join game
function joinGame(): void {
  const input = document.getElementById('playerNameInput') as HTMLInputElement;
  playerName = input.value.trim() || 'Player' + Math.floor(Math.random() * 1000);
  document.getElementById('joinDialog')!.style.display = 'none';
  document.getElementById('gameContainer')!.style.display = 'flex';
  network.join(playerName);
}

// Input handling
const keys: Record<string, boolean> = {};

window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  keys[e.code] = true;

  if (e.code === 'Space' || e.key.toLowerCase() === 'j') {
    e.preventDefault();
    network.attack();
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
  keys[e.code] = false;
});

// Game loop
let lastTime = Date.now();

function gameLoop(): void {
  const now = Date.now();
  const deltaTime = (now - lastTime) / 1000;
  lastTime = now;

  // Handle player input
  let dx = 0;
  let dy = 0;

  if (keys['w'] || keys['arrowup']) dy -= 1;
  if (keys['s'] || keys['arrowdown']) dy += 1;
  if (keys['a'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;

  if (dx !== 0 || dy !== 0) {
    network.move(dx, dy);
  }

  // Update and render
  game.update(deltaTime);
  renderer.render(game.gameState, game.currentPlayerId, game.lastAttackTime);

  // Update HUD
  updateHUD();

  requestAnimationFrame(gameLoop);
}

function updateHUD(): void {
  const player = game.currentPlayer;
  if (!player) return;

  document.getElementById('health')!.textContent = `生命 ${Math.ceil(player.health)}/${player.maxHealth}`;
  document.getElementById('level')!.textContent = `等级 ${player.level}`;
  const weaponBonus: Record<string, number> = {
    rustySword: 0,
    ironSword: 8,
    battleAxe: 18,
    crystalBlade: 28,
  };
  const weaponNames: Record<string, string> = {
    rustySword: '生锈短剑',
    ironSword: '铁剑',
    battleAxe: '战斧',
    crystalBlade: '水晶刃',
  };
  const attackDamage = player.damage + (weaponBonus[player.weapon] ?? 0);

  document.getElementById('damage')!.textContent = `伤害 ${attackDamage.toFixed(1)}`;
  document.getElementById('armor')!.textContent = `护甲 ${player.armor.toFixed(1)}`;
  document.getElementById('xp')!.textContent = `经验 ${Math.floor(player.experience)}/${player.experienceToNextLevel}`;
  document.getElementById('weapon')!.textContent = weaponNames[player.weapon] ?? player.weaponName;
  document.getElementById('range')!.textContent = `范围 ${player.attackRange}`;
  document.getElementById('wave')!.textContent = `第 ${game.gameState.wave} 波`;
  document.getElementById('objective')!.textContent = `${game.gameState.waveKills}/${game.gameState.killsToNextWave}`;
  document.getElementById('score')!.textContent = `分数 ${game.gameState.score}`;
  document.getElementById('enemyCount')!.textContent = String(Object.keys(game.gameState.enemies).length);
}

// Setup join button
document.getElementById('joinButton')!.addEventListener('click', joinGame);
document.getElementById('playerNameInput')!.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinGame();
});

// Start game loop
requestAnimationFrame(gameLoop);
