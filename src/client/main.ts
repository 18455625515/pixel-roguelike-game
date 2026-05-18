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
  renderer.render(game.gameState);

  // Update HUD
  updateHUD();

  requestAnimationFrame(gameLoop);
}

function updateHUD(): void {
  const player = game.currentPlayer;
  if (!player) return;

  document.getElementById('health')!.textContent = `HP: ${Math.ceil(player.health)}/${player.maxHealth}`;
  document.getElementById('level')!.textContent = `Level: ${player.level}`;
  document.getElementById('damage')!.textContent = `DMG: ${player.damage.toFixed(1)}`;
  document.getElementById('armor')!.textContent = `ARM: ${player.armor.toFixed(1)}`;
  document.getElementById('wave')!.textContent = `Wave: ${game.gameState.wave}`;
  document.getElementById('score')!.textContent = `Score: ${game.gameState.score}`;
}

// Setup join button
document.getElementById('joinButton')!.addEventListener('click', joinGame);
document.getElementById('playerNameInput')!.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinGame();
});

// Start game loop
requestAnimationFrame(gameLoop);
