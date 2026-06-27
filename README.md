# Tic-Tac-Toe — Multiplayer

A complete multiplayer Tic-Tac-Toe game that runs entirely in the browser with **WebRTC peer-to-peer** communication for gameplay and a **WebSocket signaling server** for lobby management.

## Features

- **Real-time multiplayer** via WebRTC P2P data channels
- **Lobby system** — create, join, and list lobbies with unique IDs
- **Ready system** — both players click ready to start
- **Rematch support** — request and accept rematches
- **WebSocket fallback** — works even if WebRTC is blocked
- **Clean modern UI** with dark theme
- **Move sync** — board state is synchronized between peers
- **Win/draw detection** with visual highlighting

## Architecture

```
┌──────────────┐         WebSocket          ┌──────────────┐
│   Browser    │◄──────────────────────────►│   Server     │
│   Client A   │         (signaling)        │  (Node.js)   │
└──────┬───────┘                            └──────────────┘
       │                                              │
       │         WebRTC Data Channel (P2P)            │
       └──────────────────────────────────────────────┘
                  (game moves)
```

### Separation of Concerns

| Component | Responsibility |
|-----------|---------------|
| **Signaling Server** | Lobby creation/joining, player matchmaking, WebRTC SDP/ICE exchange. Does NOT handle game logic. |
| **Network Layer** | WebSocket connection to server + WebRTC P2P data channel for game moves. |
| **Game Logic** | Pure Tic-Tac-Toe rules — move validation, win/draw detection, turn management. |
| **Lobby System** | UI state for lobby flow, ready toggling, player display. |
| **Main Controller** | Orchestrates all modules, handles UI events, coordinates game flow. |

## File Structure

```
TicTacToe/
├── index.html      # UI layout — name entry, lobby list, lobby, game screens
├── style.css       # Modern dark theme with CSS custom properties
├── app.js          # Main controller — UI bindings, game flow orchestration
├── lobby.js        # Lobby & ready system controller
├── game.js         # Pure Tic-Tac-Toe game logic
├── network.js      # WebSocket + WebRTC network communication layer
├── server.js       # Node.js WebSocket signaling server
├── package.json    # Dependencies (ws)
└── README.md       # This file
```

## Prerequisites

- **Node.js** 16+ (for the signaling server)
- A modern browser with WebRTC support (Chrome, Firefox, Edge, Safari)

## Installation & Running

### 1. Install Server Dependencies

```bash
npm install
```

### 2. Start the Server

```bash
npm start
# or
node server.js
```

The server does **everything** — serves the game files AND handles WebSocket signaling.
Default port: `8080`. Change with `PORT=3000 node server.js`.

### 3. Play Locally

Open `http://localhost:8080` in your browser. Open a second tab for a second player.

### 4. Play on Your Network (LAN)

1. Find your local IP: `ipconfig` (Windows) or `hostname -I` (Linux/Mac)
2. Share `http://YOUR_LOCAL_IP:8080` with others on the same network
3. Both players connect to that address

### 5. Play Over the Internet (WAN)

For cross-network play, you need to expose your server publicly.

**Option A: ngrok (easiest, recommended for testing)**
```bash
# Install ngrok, then:
ngrok http 8080
```
Share the `https://xxxx.ngrok-free.app` URL with the other player.

**Option B: Port forwarding**
1. Forward port 8080 on your router to your machine's local IP
2. Find your public IP: visit `https://ifconfig.me`
3. Share `http://YOUR_PUBLIC_IP:8080` with the other player

**Option C: Cloud hosting (VPS)**
1. Upload files to a VPS (DigitalOcean, AWS, etc.)
2. Run `npm install && node server.js`
3. Open port 8080 in security groups
4. Share `http://YOUR_VPS_IP:8080`

### 6. Play!

1. Both players open the same URL in their browser
2. Enter your name
3. Player 1 clicks **"Create Lobby"** — share the 8-char ID
4. Player 2 enters the ID and clicks **"Join"**
5. Both click **"I'm Ready"**
6. Game starts automatically!

## How Multiplayer Works

### Lobby Flow

1. **Player A** enters their name → connects to signaling server
2. **Player A** creates a lobby → server generates a unique 8-char ID
3. **Player B** enters their name → connects to signaling server
4. **Player B** joins Player A's lobby → server adds them
5. Both players see the lobby with names, colors, and ready status

### Ready & Start

1. Both players click **"I'm Ready"**
2. When both are ready, the server sends a `game_start` signal
3. The host (Player X) goes first

### Game Moves

1. **Player A** clicks a cell → local move validation → board updated
2. The move is sent to **Player B** via:
   - **WebRTC P2P data channel** (primary, direct connection)
   - **WebSocket relay through server** (fallback if WebRTC fails)
3. **Player B** receives the move → updates their board

### Game End

1. Win/draw is detected locally by both players
2. Result is sent to the opponent
3. Result overlay is shown to both players
4. Either player can request a **rematch**

## Network Protocol

### WebSocket Messages (to/from server)

| Type | Direction | Description |
|------|-----------|-------------|
| `register` | Client → Server | Identify player with name |
| `lobby_created` | Server → Client | New lobby created |
| `lobby_joined` | Server → Client | Successfully joined lobby |
| `lobby_update` | Server → Client | Lobby state changed |
| `lobby_list` | Server → Client | List of available lobbies |
| `ready_toggle` | Client → Server | Toggle ready status |
| `game_start` | Server → Client | Both ready, start game |
| `opponent_move` | Server → Client | Opponent's move |
| `opponent_result` | Server → Client | Game ended |
| `left_lobby` | Server → Client | Player left the lobby |
| `signal` | Both | WebRTC signaling (SDP/ICE) |

### WebRTC Data Channel Messages

| Type | Description |
|------|-------------|
| `game_move` | Cell index + full board state |
| `game_result` | Winner symbol + draw flag |

## Configuration

### Server Port

Edit `server.js` or use environment variable:

```javascript
const PORT = process.env.PORT || 8080;
```

### Client Server URL

Edit `app.js` to change the signaling server URL:

```javascript
network = new Network('ws://your-server.com:8080');
```

### WebRTC ICE Servers

Edit `network.js` to add TURN servers for NAT traversal:

```javascript
this.iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:your-turn-server.com:3478', username: 'user', credential: 'pass' }
  ]
};
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Failed to connect to server" | Make sure `node server.js` is running |
| "Lobby not found or full" | Check the lobby ID is correct and hasn't been filled |
| Moves not syncing | Check browser console for WebRTC errors; server fallback should activate |
| Can't connect P2P | May need TURN server if behind strict NAT/firewall |

## License

MIT
