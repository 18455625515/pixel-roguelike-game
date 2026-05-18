import express from 'express';
import { Server } from 'ws';
import http from 'http';
import path from 'path';
import { Game } from './game';
import { Message, GameStateMessage, JoinMessage, MoveMessage } from '../shared/types';

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

const PORT = process.env.PORT || 3000;
const game = new Game();
let lastUpdateTime = Date.now();

// Serve compiled client assets first, then the source public directory for index.html.
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(__dirname, '../../public')));

// Main game loop
setInterval(() => {
  const now = Date.now();
  const deltaTime = (now - lastUpdateTime) / 1000; // Convert to seconds
  lastUpdateTime = now;

  game.update(deltaTime);

  // Broadcast game state to all clients
  const gameState = game.getState();
  const message: GameStateMessage = {
    type: 'gameState',
    payload: gameState as any,
  };

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send(JSON.stringify(message));
    }
  });
}, 1000 / 60); // 60 FPS

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');
  let playerId: string | null = null;

  ws.on('message', (data: Buffer) => {
    try {
      const message: Message = JSON.parse(data.toString());

      switch (message.type) {
        case 'join':
          const joinMsg = message as JoinMessage;
          const player = game.addPlayer(joinMsg.payload.name);
          playerId = player.id;
          ws.send(
            JSON.stringify({
              type: 'joinSuccess',
              payload: {
                playerId: player.id,
                player: { ...player },
              },
            })
          );
          break;

        case 'move':
          if (playerId) {
            const moveMsg = message as MoveMessage;
            const { dx, dy } = moveMsg.payload;
            game.movePlayer(playerId, dx, dy, 0.016); // Approximate delta time
          }
          break;

        case 'attack':
          if (playerId) {
            game.attack(playerId);
          }
          break;

        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    if (playerId) {
      game.removePlayer(playerId);
      console.log(`Player ${playerId} disconnected`);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
