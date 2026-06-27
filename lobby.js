/**
 * lobby.js - Lobby & Ready System Controller
 *
 * Manages the lobby flow:
 * - Entering name and connecting to server
 * - Creating or joining lobbies
 * - Viewing lobby list
 * - Managing player ready status
 * - Displaying lobby state (players, ready status, connection)
 *
 * This module handles ONLY lobby UI state and transitions.
 * Game logic is delegated to game.js.
 */

class LobbyController {
  /**
   * @param {Network} network - Network instance
   * @param {Function} onGameStart - Callback when game starts: (firstPlayer) => void
   * @param {Function} onOpponentMove - Callback for opponent moves: (move, board) => void
   * @param {Function} onGameResult - Callback for game end: (winner, isDraw) => void
   * @param {Function} onRematchReady - Callback for rematch toggle
   */
  constructor(network, onGameStart, onOpponentMove, onGameResult, onRematchReady) {
    this.network = network;
    this.onGameStart = onGameStart;
    this.onOpponentMove = onOpponentMove;
    this.onGameResult = onGameResult;
    this.onRematchReady = onRematchReady;

    // Current state
    this.playerName = '';
    this.playerColor = null; // 'X' or 'O'
    this.lobby = null;
    this.isInLobby = false;
    this.isReady = false;
    this.isRematchReady = false;
    this.isHost = false;
    this.opponentName = '';

    // Track whether a game is actively in progress
    this._gameActive = false;

    // Bind event handlers
    this._bindNetworkEvents();

    // Load saved name from localStorage
    this.playerName = localStorage.getItem('tictactoe_name') || '';
  }

  /**
   * Bind network event listeners
   * @private
   */
  _bindNetworkEvents() {
    // Lobby updates (from server)
    this.network.on('lobby_update', (lobby) => {
      this.lobby = lobby;
      this._updateLobbyUI();

      // Check if both players are ready
      if (lobby.players.length === 2 && lobby.players.every(p => p.ready)) {
        this._showWaitingForOpponent();
      }
    });

    // Lobby list
    this.network.on('lobby_list', (lobbies) => {
      this._renderLobbyList(lobbies);
    });

    // Game start signal
    this.network.on('game_start', (data) => {
      // Determine our color from the players list
      if (data.players) {
        const myPlayer = data.players.find(p => p.id === this.network.playerId);
        if (myPlayer) {
          this.playerColor = myPlayer.color;
        }
        // Set opponent name
        const opponent = data.players.find(p => p.id !== this.network.playerId);
        if (opponent) {
          this.opponentName = opponent.name;
        }
      }
      // Reset ready states for new game
      this.isReady = false;
      this.isRematchReady = false;
      this._gameActive = true;
      this.onGameStart(data.firstPlayer);
    });

    // Opponent move
    this.network.on('opponent_move', (data) => {
      this.onOpponentMove(data.move, data.board);
    });

    // Opponent game result
    this.network.on('opponent_result', (data) => {
      this.onGameResult(data.winner, data.isDraw);
    });

    // Left lobby
    this.network.on('left_lobby', () => {
      this.isInLobby = false;
      this.lobby = null;
      this.isReady = false;
      this.isRematchReady = false;
      this._gameActive = false;
      // Hide result overlay if visible
      const resultOverlay = document.getElementById('result-overlay');
      if (resultOverlay) {
        resultOverlay.classList.remove('active');
      }
      // Reset create lobby button state
      const createBtn = document.getElementById('create-lobby-btn');
      if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Lobby';
      }
      this._showScreen('lobby_list');
    });

    // Connection errors
    this.network.on('error', (msg) => {
      this._showNotification(msg, 'error');
    });

    // P2P connection established
    this.network.on('p2p_connected', () => {
      this._showNotification('Connected to opponent!', 'success');
    });

    // Fallback to WebSocket
    this.network.on('p2p_fallback', () => {
      this._showNotification('Using server relay for communication', 'info');
    });
  }

  // ─── Public API ────────────────────────────────────────────────

  /**
   * Set player name and connect to server
   * @param {string} name - Player display name
   * @returns {Promise}
   */
  async connect(name) {
    this.playerName = name.trim() || 'Anonymous';
    localStorage.setItem('tictactoe_name', this.playerName);

    try {
      await this.network.connect();
      await this.network.register(this.playerName);
      this._showScreen('lobby_list');
      this.network.requestLobbyList();
    } catch (err) {
      this._showNotification('Failed to connect to server. Make sure the signaling server is running.', 'error');
      this._showScreen('name');
    }
  }

  /**
   * Create a new lobby
   * @returns {Promise}
   */
  async createLobby() {
    try {
      await this.network.createLobby(this.playerName);
      // lobby_update will be triggered automatically
    } catch (err) {
      this._showNotification('Failed to create lobby', 'error');
    }
  }

  /**
   * Join a lobby by ID
   * @param {string} lobbyId - Lobby ID
   * @returns {Promise}
   */
  async joinLobby(lobbyId) {
    try {
      await this.network.joinLobby(this.playerName, lobbyId.toUpperCase());
      // lobby_update will be triggered automatically
    } catch (err) {
      this._showNotification('Failed to join lobby', 'error');
    }
  }

  /**
   * Toggle ready status
   */
  toggleReady() {
    this.isReady = !this.isReady;
    this.network.toggleReady();
  }

  /**
   * Toggle rematch status
   */
  toggleRematch() {
    this.isRematchReady = !this.isRematchReady;
    this.onRematchReady();
    this.network.toggleRematch();
  }

  /**
   * Leave the current lobby
   */
  leaveLobby() {
    this.network.leaveLobby();
  }

  /**
   * Request updated lobby list
   */
  refreshLobbyList() {
    this.network.requestLobbyList();
  }

  // ─── UI Rendering ──────────────────────────────────────────────

  /**
   * Switch to a specific screen
   * @param {string} screen - Screen name: 'name', 'lobby_list', 'lobby', 'game'
   */
  showScreen(screen) {
    this._showScreen(screen);
  }

  /**
   * Set the player's color and update UI
   * @param {string} color - 'X' or 'O'
   */
  setPlayerColor(color) {
    this.playerColor = color;
  }

  /**
   * Set opponent name for display
   * @param {string} name
   */
  setOpponentName(name) {
    this.opponentName = name;
  }

  /**
   * Show waiting screen for opponent to connect
   */
  showWaitingForOpponent() {
    this._showWaitingForOpponent();
  }

  // ─── Internal UI Methods ───────────────────────────────────────

  /**
   * Show a specific screen
   * @private
   */
  _showScreen(screen) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));

    // Show target screen
    const screenEl = document.getElementById(`screen-${screen}`);
    if (screenEl) {
      screenEl.classList.add('active');
    }
  }

  /**
   * Update lobby UI with current lobby data
   * @private
   */
  _updateLobbyUI() {
    if (!this.lobby) return;

    this.isInLobby = true;
    this.isHost = this.lobby.hostId === this.network.playerId;

    // Determine player color
    const myPlayer = this.lobby.players.find(p => p.id === this.network.playerId);
    if (myPlayer) {
      this.playerColor = myPlayer.color;
      this.isReady = myPlayer.ready;
    }

    // Find opponent
    const opponent = this.lobby.players.find(p => p.id !== this.network.playerId);
    if (opponent) {
      this.opponentName = opponent.name;
    }

    // Update game info bar player names (if game screen is visible)
    const xNameEl = document.getElementById('x-name');
    const oNameEl = document.getElementById('o-name');
    if (xNameEl && oNameEl && this.lobby.players.length === 2) {
      const xPlayer = this.lobby.players.find(p => p.color === 'X');
      const oPlayer = this.lobby.players.find(p => p.color === 'O');
      if (xNameEl) xNameEl.textContent = xPlayer?.name || 'Player X';
      if (oNameEl) oNameEl.textContent = oPlayer?.name || 'Player O';
    }

    // Update player list
    const playerListEl = document.getElementById('lobby-players');
    if (playerListEl) {
      playerListEl.innerHTML = this.lobby.players.map(player => `
        <div class="lobby-player ${player.id === this.network.playerId ? 'you' : ''}">
          <div class="player-info">
            <span class="player-symbol ${player.color.toLowerCase()}">${player.color}</span>
            <span class="player-name">${player.name}${player.id === this.network.playerId ? ' (You)' : ''}</span>
            ${player.id === this.lobby.hostId ? '<span class="host-badge">HOST</span>' : ''}
          </div>
          <div class="player-status">
            <span class="ready-indicator ${player.ready ? 'ready' : 'not-ready'}">
              ${player.ready ? '✓ Ready' : '○ Not Ready'}
            </span>
          </div>
        </div>
      `).join('');
    }

    // Update lobby ID display
    const lobbyIdEl = document.getElementById('lobby-id-display');
    if (lobbyIdEl) {
      lobbyIdEl.textContent = this.lobby.id;
    }

    // Update ready button (enabled when both players are in the lobby)
    const readyBtn = document.getElementById('ready-btn');
    if (readyBtn) {
      readyBtn.innerHTML = this.isReady
        ? '<span class="btn-icon">✓</span> Ready Up'
        : '<span class="btn-icon">✓</span> I\'m Ready';
      readyBtn.disabled = this.lobby.players.length < 2;
    }

    // Sync rematch ready state from server
    const myRematchPlayer = this.lobby.players.find(p => p.id === this.network.playerId);
    if (myRematchPlayer) {
      this.isRematchReady = myRematchPlayer.ready;
    }

    // If a game is active, don't switch screens (stay on game/result)
    if (this._gameActive) return;

    // If both players ready, wait for game start (don't show lobby screen)
    if (this.lobby.players.length === 2 && this.lobby.players.every(p => p.ready)) {
      this._showWaitingForOpponent();
    } else {
      // Show lobby screen
      this._showScreen('lobby');
    }
  }

  /**
   * Render the lobby list
   * @param {Array} lobbies - List of lobbies
   * @private
   */
  _renderLobbyList(lobbies) {
    const listEl = document.getElementById('lobby-list-items');
    if (!listEl) return;

    if (lobbies.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No lobbies available. Create one!</div>';
      return;
    }

    listEl.innerHTML = lobbies.map(lobby => `
      <div class="lobby-item" onclick="lobbyController.joinLobby('${lobby.id}')">
        <div class="lobby-item-info">
          <span class="lobby-id">${lobby.id}</span>
          <span class="lobby-host">Created by ${lobby.hostName}</span>
        </div>
        <div class="lobby-item-status">
          <span class="player-count">${lobby.playerCount}/${lobby.maxPlayers}</span>
          <button class="join-btn" onclick="event.stopPropagation(); lobbyController.joinLobby('${lobby.id}')">Join</button>
        </div>
      </div>
    `).join('');
  }

  /**
   * Show waiting screen
   * @private
   */
  _showWaitingForOpponent() {
    const waitingEl = document.getElementById('waiting-overlay');
    if (waitingEl) {
      waitingEl.classList.add('active');
    }
  }

  /**
   * Hide waiting screen
   * @private
   */
  hideWaitingOverlay() {
    const waitingEl = document.getElementById('waiting-overlay');
    if (waitingEl) {
      waitingEl.classList.remove('active');
    }
  }

  /**
   * Show a notification toast
   * @param {string} message - Notification text
   * @param {string} type - Type: 'success', 'error', 'info'
   * @private
   */
  _showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    container.appendChild(notification);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LobbyController;
}
