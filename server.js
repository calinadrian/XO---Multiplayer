/**
 * server.js - Signaling Server for Tic-Tac-Toe
 *
 * This Node.js server handles:
 * - HTTP static file serving (serves index.html, CSS, JS)
 * - WebSocket signaling for lobby management
 * - WebRTC SDP/ICE exchange for P2P connection
 *
 * It does NOT handle any game logic.
 *
 * Usage:
 *   npm install ws
 *   node server.js
 *
 * To expose publicly, run behind a reverse proxy (nginx/caddy)
 * with HTTPS. WebRTC requires secure contexts (HTTPS or localhost).
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────
const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname);

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ─── Data Stores ─────────────────────────────────────────────────
// Map of lobbyId -> lobby info
const lobbies = new Map();

// Map of playerId -> { ws, lobbyId, role }
const players = new Map();

// ─── HTTP Server (Static File Serving + WebSocket Upgrade) ───────
const server = http.createServer((req, res) => {
  // Parse URL and get file path
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Get file extension and MIME type
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Read and serve file
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA fallback: serve index.html for any non-file route
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, indexContent) => {
          if (err2) {
            res.writeHead(500);
            res.end('Server Error');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          res.end(indexContent);
        });
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// Attach WebSocket server to the HTTP server
const wss = new WebSocket.Server({ server, path: '/ws' });

// ─── Lobby Management ────────────────────────────────────────────

/**
 * Generate a unique 8-character lobby ID
 */
function generateLobbyId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create a new lobby
 * @param {string} playerId - The player creating the lobby
 * @param {string} playerName - The player's display name
 * @returns {object} Lobby info
 */
function createLobby(playerId, playerName, wsRef) {
  const lobbyId = generateLobbyId();
  const lobby = {
    id: lobbyId,
    hostId: playerId,
    players: [
      { id: playerId, name: playerName, ready: false, color: 'X' }
    ],
    createdAt: Date.now()
  };
  lobbies.set(lobbyId, lobby);
  // Preserve existing ws if already registered, otherwise use wsRef
  const existing = players.get(playerId);
  players.set(playerId, { ws: (wsRef || existing?.ws) ?? null, lobbyId, role: 'host' });
  return lobby;
}

/**
 * Join an existing lobby
 * @param {string} playerId - The player joining
 * @param {string} playerName - The player's display name
 * @param {string} lobbyId - The lobby to join
 * @returns {object|null} Lobby info or null if not found/full
 */
function joinLobby(playerId, playerName, lobbyId, wsRef) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return null;
  if (lobby.players.length >= 2) return null; // Lobby is full

  lobby.players.push({
    id: playerId,
    name: playerName,
    ready: false,
    color: 'O'
  });

  // Preserve existing ws if already registered, otherwise use wsRef
  const existing = players.get(playerId);
  players.set(playerId, { ws: (wsRef || existing?.ws) ?? null, lobbyId, role: 'guest' });

  // If both players are in, broadcast updated lobby to both
  if (lobby.players.length === 2) {
    broadcastLobbyUpdate(lobbyId);
  }

  return lobby;
}

/**
 * Get the list of all non-full lobbies
 * @returns {Array} List of lobby summaries
 */
function getLobbyList() {
  const result = [];
  for (const [id, lobby] of lobbies) {
    if (lobby.players.length < 2) {
      result.push({
        id: id,
        hostName: lobby.players[0].name,
        playerCount: lobby.players.length,
        maxPlayers: 2
      });
    }
  }
  return result;
}

/**
 * Broadcast lobby state to all players in a lobby
 */
function broadcastLobbyUpdate(lobbyId) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;

  const message = JSON.stringify({
    type: 'lobby_update',
    lobby: lobby
  });

  for (const player of lobby.players) {
    const playerData = players.get(player.id);
    if (playerData?.ws?.readyState === WebSocket.OPEN) {
      playerData.ws.send(message);
    }
  }
}

/**
 * Remove a player from their lobby
 */
function removePlayer(playerId) {
  const playerData = players.get(playerId);
  if (!playerData) return;

  const lobby = lobbies.get(playerData.lobbyId);
  if (lobby) {
    lobby.players = lobby.players.filter(p => p.id !== playerId);

    // Always delete the lobby when any player leaves - a 1-player lobby has no purpose
    if (lobby.players.length > 0) {
      broadcastLobbyUpdate(playerData.lobbyId);
    }
    lobbies.delete(playerData.lobbyId);
  }

  players.delete(playerId);
}

// ─── Signaling ───────────────────────────────────────────────────

/**
 * Forward a signaling message to the opponent in the same lobby
 * @param {string} fromPlayerId - Sender player ID
 * @param {object} message - The signaling message
 */function forwardSignaling(fromPlayerId, message) {
  const playerData = players.get(fromPlayerId);
  if (!playerData) return;

  const lobby = lobbies.get(playerData.lobbyId);
  if (!lobby) return;

  // Find the other player
  const opponent = lobby.players.find(p => p.id !== fromPlayerId);
  if (!opponent) return;

  const opponentData = players.get(opponent.id);
  if (opponentData?.ws?.readyState === WebSocket.OPEN) {
    opponentData.ws.send(JSON.stringify(message));
  }
}

// ─── WebSocket Connection Handling ───────────────────────────────

wss.on('connection', (ws) => {
  let currentPlayerId = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleClientMessage(ws, currentPlayerId, message);
    } catch (err) {
      console.error('Error parsing message:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    if (currentPlayerId) {
      removePlayer(currentPlayerId);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  /**
   * Handle incoming messages from clients
   */
  function handleClientMessage(ws, playerId, message) {
    switch (message.type) {
      case 'register':
        // Client identifies itself
        currentPlayerId = playerId || `player_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        players.set(currentPlayerId, { ws, lobbyId: null, role: null });
        ws.send(JSON.stringify({
          type: 'registered',
          playerId: currentPlayerId
        }));
        break;

      case 'create_lobby':
        if (!currentPlayerId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not registered' }));
          return;
        }
        const newLobby = createLobby(currentPlayerId, message.playerName, ws);
        ws.send(JSON.stringify({
          type: 'lobby_created',
          lobby: newLobby
        }));
        break;

      case 'join_lobby':
        if (!currentPlayerId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not registered' }));
          return;
        }
        const joinedLobby = joinLobby(currentPlayerId, message.playerName, message.lobbyId, ws);
        if (joinedLobby) {
          ws.send(JSON.stringify({
            type: 'lobby_joined',
            lobby: joinedLobby
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Lobby not found or full'
          }));
        }
        break;

      case 'lobby_list':
        // Send list of available lobbies
        ws.send(JSON.stringify({
          type: 'lobby_list',
          lobbies: getLobbyList()
        }));
        break;

      case 'ready_toggle':
        if (!currentPlayerId) return;
        const lobby = lobbies.get(players.get(currentPlayerId)?.lobbyId);
        if (lobby) {
          const player = lobby.players.find(p => p.id === currentPlayerId);
          if (player) {
            player.ready = !player.ready;
            broadcastLobbyUpdate(lobby.id);

            // If both ready, notify both to start game
            if (lobby.players.every(p => p.ready)) {
              const gameStartMsg = JSON.stringify({
                type: 'game_start',
                board: [],
                firstPlayer: lobby.players[0].color,
                players: lobby.players.map(p => ({ id: p.id, color: p.color, name: p.name }))
              });
              // Reset ready states for next game
              for (const p of lobby.players) {
                p.ready = false;
              }
              broadcastLobbyUpdate(lobby.id);
              // Notify both players
              for (const p of lobby.players) {
                const pData = players.get(p.id);
                if (pData?.ws?.readyState === WebSocket.OPEN) {
                  pData.ws.send(gameStartMsg);
                }
              }
            }
          }
        }
        break;

      case 'leave_lobby':
        if (!currentPlayerId) return;
        removePlayer(currentPlayerId);
        ws.send(JSON.stringify({ type: 'left_lobby' }));
        break;

      case 'rematch_toggle':
        if (!currentPlayerId) return;
        const rLobby = lobbies.get(players.get(currentPlayerId)?.lobbyId);
        if (rLobby) {
          const rPlayer = rLobby.players.find(p => p.id === currentPlayerId);
          if (rPlayer) {
            rPlayer.ready = !rPlayer.ready;

            // Check if both ready for rematch
            if (rLobby.players.every(p => p.ready)) {
              // Reset board, swap first player
              const newFirstPlayer = rLobby.players[0].color === 'X' ? 'O' : 'X';
              for (const p of rLobby.players) {
                const pData = players.get(p.id);
                if (pData?.ws?.readyState === WebSocket.OPEN) {
                  pData.ws.send(JSON.stringify({
                    type: 'game_start',
                    board: [],
                    firstPlayer: newFirstPlayer
                  }));
                }
              }
            } else {
              broadcastLobbyUpdate(rLobby.id);
            }
          }
        }
        break;

      case 'game_move':
        // Forward the move to the opponent
        if (!currentPlayerId) return;
        forwardSignaling(currentPlayerId, {
          type: 'opponent_move',
          move: message.move,
          board: message.board
        });
        break;

      case 'game_result':
        // Forward game result to opponent
        if (!currentPlayerId) return;
        forwardSignaling(currentPlayerId, {
          type: 'opponent_result',
          winner: message.winner,
          isDraw: message.isDraw
        });
        break;

      case 'game_move_ws':
        // WebSocket fallback for game moves
        if (!currentPlayerId) return;
        forwardSignaling(currentPlayerId, {
          type: 'opponent_move',
          move: message.move,
          board: message.board
        });
        break;

      case 'game_result_ws':
        // WebSocket fallback for game results
        if (!currentPlayerId) return;
        forwardSignaling(currentPlayerId, {
          type: 'opponent_result',
          winner: message.winner,
          isDraw: message.isDraw
        });
        break;

      case 'signal':
        // WebRTC signaling message - forward to opponent
        if (!currentPlayerId) return;
        forwardSignaling(currentPlayerId, {
          type: 'signal',
          signal: message.signal
        });
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  }
});

// ─── Cleanup ─────────────────────────────────────────────────────

// Remove lobbies that have been idle for too long
setInterval(() => {
  const now = Date.now();
  for (const [id, lobby] of lobbies) {
    if (now - lobby.createdAt > 5 * 60 * 1000) { // 5 minutes
      lobbies.delete(id);
    }
  }
}, 60000);

// ─── Start Server ────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║   Multiplayer Tic-Tac-Toe Server         ║`);
  console.log(`  ╠══════════════════════════════════════════╣`);
  console.log(`  ║  HTTP:  http://localhost:${PORT}          ║`);
  console.log(`  ║  WS:    ws://localhost:${PORT}/ws         ║`);
  console.log(`  ║                                          ║`);
  console.log(`  ║  Open http://localhost:${PORT} in browser ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});

console.log('Press Ctrl+C to stop.');
