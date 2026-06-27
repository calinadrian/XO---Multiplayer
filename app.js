/**
 * app.js - Main Application Controller
 *
 * Orchestrates all modules:
 * - Initializes Network, Game, and LobbyController
 * - Handles UI event bindings
 * - Coordinates game flow: Name → Lobby → Game → Result → Rematch
 *
 * This is the entry point of the application.
 */

// ─── Global Instances ───────────────────────────────────────────────
let network;
let game;
let lobbyController;

// ─── DOM Element References ─────────────────────────────────────────
const dom = {};

// ─── Initialize Application ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Cache DOM elements
  cacheDOMElements();

  // Initialize modules
  // Auto-detect server URL from current page location
  // When served from the same server, this resolves to ws://host:port/ws
  network = new Network(null);
  game = new Game();
  lobbyController = new LobbyController(
    network,
    onGameStart,
    onOpponentMove,
    onGameResult,
    onRematchReady
  );

  // Bind UI event listeners
  bindUIEvents();

  // Show name entry screen
  lobbyController.showScreen('name');

  // Pre-fill name if saved
  if (dom.nameInput.value) {
    dom.nameInput.value = localStorage.getItem('tictactoe_name') || '';
  }
});

/**
 * Copy lobby ID to clipboard
 */
function copyLobbyId() {
  const id = dom.lobbyIdDisplay?.textContent;
  if (id && id !== '------') {
    navigator.clipboard.writeText(id).then(() => {
      showNotification('Lobby ID copied!', 'success');
    }).catch(() => {
      showNotification('Failed to copy', 'error');
    });
  }
}

/**
 * Cache frequently used DOM elements
 */
function cacheDOMElements() {
  // Name screen
  dom.nameInput = document.getElementById('name-input');
  dom.nameSubmit = document.getElementById('name-submit');

  // Lobby list screen
  dom.createLobbyBtn = document.getElementById('create-lobby-btn');
  dom.joinLobbyBtn = document.getElementById('join-lobby-btn');
  dom.lobbyIdInput = document.getElementById('lobby-id-input');
  dom.lobbyListItems = document.getElementById('lobby-list-items');
  dom.refreshLobbyBtn = document.getElementById('refresh-lobby-btn');

  // Lobby screen
  dom.lobbyIdDisplay = document.getElementById('lobby-id-display');
  dom.lobbyPlayers = document.getElementById('lobby-players');
  dom.readyBtn = document.getElementById('ready-btn');
  dom.leaveLobbyBtn = document.getElementById('leave-lobby-btn');

  // Waiting overlay
  dom.waitingOverlay = document.getElementById('waiting-overlay');

  // Game screen
  dom.gameBoard = document.getElementById('game-board');
  dom.gameStatus = document.getElementById('game-status');
  dom.playerXTimer = document.getElementById('player-x-timer');
  dom.playerOTimer = document.getElementById('player-o-timer');
  // Result overlay
  dom.resultOverlay = document.getElementById('result-overlay');
  dom.resultMessage = document.getElementById('result-message');
  dom.resultBackLobbyBtn = document.getElementById('result-back-lobby-btn');

  // Notification container
  dom.notificationContainer = document.getElementById('notification-container');
}

/**
 * Bind all UI event listeners
 */
function bindUIEvents() {
  // Name submission
  dom.nameSubmit.addEventListener('click', handleNameSubmit);
  dom.nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleNameSubmit();
  });

  // Lobby list actions
  dom.createLobbyBtn.addEventListener('click', handleCreateLobby);
  dom.joinLobbyBtn.addEventListener('click', handleJoinLobby);
  dom.lobbyIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleJoinLobby();
  });
  dom.refreshLobbyBtn.addEventListener('click', () => {
    lobbyController.refreshLobbyList();
  });

  // Lobby actions
  dom.readyBtn.addEventListener('click', handleReadyToggle);
  dom.leaveLobbyBtn.addEventListener('click', handleLeaveLobby);

  // Game board clicks
  dom.gameBoard.addEventListener('click', handleBoardClick);

  // Back to lobby button
  dom.resultBackLobbyBtn.addEventListener('click', handleBackToLobby);
}

// ─── Event Handlers ─────────────────────────────────────────────────

/**
 * Handle name submission
 */
function handleNameSubmit() {
  const name = dom.nameInput.value.trim();
  if (name) {
    lobbyController.connect(name);
  }
}

/**
 * Handle create lobby button click
 */
async function handleCreateLobby() {
  dom.createLobbyBtn.disabled = true;
  dom.createLobbyBtn.textContent = 'Creating...';
  await lobbyController.createLobby();
  dom.createLobbyBtn.disabled = false;
  dom.createLobbyBtn.textContent = 'Create Lobby';
}

/**
 * Handle join lobby button click
 */
async function handleJoinLobby() {
  const lobbyId = dom.lobbyIdInput.value.trim().toUpperCase();
  if (lobbyId.length === 8) {
    await lobbyController.joinLobby(lobbyId);
    dom.lobbyIdInput.value = '';
  } else {
    showNotification('Please enter a valid 8-character lobby ID', 'error');
  }
}

/**
 * Handle ready toggle
 */
function handleReadyToggle() {
  lobbyController.toggleReady();
}

/**
 * Handle leave lobby
 */
function handleLeaveLobby() {
  lobbyController.leaveLobby();
}

/**
 * Handle board cell click
 */
function handleBoardClick(event) {
  const cell = event.target.closest('.cell');
  if (!cell) return;

  const index = parseInt(cell.dataset.index, 10);
  if (isNaN(index)) return;

  // Check if it's this player's turn
  const result = game.getResult();
  if (result.state !== 'playing') return; // Game over
  if (result.currentPlayer !== lobbyController.playerColor) return; // Not my turn

  // Try to make the move
  const moveResult = game.makeMove(index);
  if (!moveResult) return; // Invalid move

  // Update UI
  renderBoard();
  updateGameStatus();

  // If game ended, show result
  if (moveResult.type === 'win' || moveResult.type === 'draw') {
    onGameResult(moveResult.player || null, moveResult.type === 'draw');
    return;
  }

  // Send move to opponent
  network.sendMove(index, game.getBoardState());
}

/**
 * Handle rematch request
 */
function handleRematch() {
  lobbyController.toggleRematch();
}

/**
 * Handle back to lobby
 */
function handleBackToLobby() {
  // Hide overlays
  hideResultOverlay();
  // Leave the current lobby (left_lobby event will show lobby_list screen)
  lobbyController.leaveLobby();
  // Reset game active flag so lobby screen can be shown
  lobbyController._gameActive = false;
  // Reset ready states
  lobbyController.isReady = false;
  lobbyController.isRematchReady = false;
  // Refresh lobby list for updated data
  network.requestLobbyList();
}

/**
 * Handle rematch ready toggle from lobby
 */
function onRematchReady() {
  // Rematch is handled through the lobby ready system
  // The lobby controller manages the rematch toggle
}

// ─── Game Flow Callbacks ────────────────────────────────────────────

/**
 * Called when a game starts
 * @param {string} firstPlayer - 'X' or 'O'
 */
function onGameStart(firstPlayer) {
  // Hide result overlay from previous game
  hideResultOverlay();

  // Hide waiting overlay
  if (dom.waitingOverlay) {
    dom.waitingOverlay.classList.remove('active');
  }

  // Reset game
  game.reset(firstPlayer);

  // playerColor is already set correctly by lobby.js from the server's players list
  // Only update if not already set (e.g., from game_start message)
  if (!lobbyController.playerColor) {
    lobbyController.setPlayerColor(firstPlayer === 'X' ? 'X' : 'O');
  }

  // Update player names in game info bar
  if (lobbyController.lobby?.players.length === 2) {
    const xPlayer = lobbyController.lobby.players.find(p => p.color === 'X');
    const oPlayer = lobbyController.lobby.players.find(p => p.color === 'O');
    if (dom.playerXTimer) {
      const xNameEl = document.getElementById('x-name');
      if (xNameEl) xNameEl.textContent = xPlayer?.name || 'Player X';
    }
    if (dom.playerOTimer) {
      const oNameEl = document.getElementById('o-name');
      if (oNameEl) oNameEl.textContent = oPlayer?.name || 'Player O';
    }
  }

  // Show game screen
  lobbyController.showScreen('game');

  // Render initial board
  renderBoard();

  // Update status
  updateGameStatus();
}

/**
 * Called when opponent makes a move
 * @param {number} moveIndex - Cell index
 * @param {Array} boardState - Full board state
 */
function onOpponentMove(moveIndex, boardState) {
  // Restore board state from opponent
  game.setBoardState(boardState);

  // Render the board
  renderBoard();

  // Highlight the opponent's last move
  const cell = dom.gameBoard?.querySelector(`[data-index="${moveIndex}"]`);
  if (cell) {
    cell.classList.add('last-move');
    setTimeout(() => cell.classList.remove('last-move'), 500);
  }

  // Update status
  updateGameStatus();
}

/**
 * Called when a game ends
 * @param {string|null} winner - Winner symbol or null for draw
 * @param {boolean} isDraw - Whether it's a draw
 */
function onGameResult(winner, isDraw) {
  // Send result to opponent
  network.sendResult(winner, isDraw);

  // Show result overlay
  if (isDraw) {
    showResultOverlay('Draw!', 'The game is a draw.');
  } else {
    const isMe = winner === lobbyController.playerColor;
    if (isMe) {
      showResultOverlay('You Win!', `Congratulations! You won as ${winner}!`);
    } else {
      showResultOverlay('You Lose!', `Opponent (${winner}) won the game.`);
    }
  }
}

// ─── UI Rendering Functions ─────────────────────────────────────────

/**
 * Render the game board
 */
function renderBoard() {
  if (!dom.gameBoard) return;

  const boardState = game.getBoardState();
  const result = game.getResult();

  dom.gameBoard.innerHTML = boardState.map((cell, index) => {
    const isEmpty = cell === null;
    const isWinningCell = result.winningLine?.includes(index);
    const cellClass = `cell ${isEmpty ? 'empty' : cell.toLowerCase()} ${isWinningCell ? 'winning' : ''}`;

    return `<div class="${cellClass}" data-index="${index}">${cell || ''}</div>`;
  }).join('');
}

/**
 * Update the game status display
 */
function updateGameStatus() {
  if (!dom.gameStatus) return;

  const result = game.getResult();

  // Update timer highlights
  if (dom.playerXTimer && dom.playerOTimer) {
    dom.playerXTimer.classList.toggle('active', result.currentPlayer === 'X' && result.state === 'playing');
    dom.playerOTimer.classList.toggle('active', result.currentPlayer === 'O' && result.state === 'playing');
  }

  // Update status text
  if (result.state === 'playing') {
    const isMyTurn = result.currentPlayer === lobbyController.playerColor;
    dom.gameStatus.textContent = isMyTurn ? 'Your turn!' : `${lobbyController.opponentName}'s turn`;
  } else if (result.state === 'won') {
    const isMe = result.winner === lobbyController.playerColor;
    dom.gameStatus.textContent = isMe ? 'You win!' : `${lobbyController.opponentName} wins!`;
  } else {
    dom.gameStatus.textContent = "It's a draw!";
  }
}

/**
 * Show result overlay
 * @param {string} title - Result title
 * @param {string} message - Result message
 */
function showResultOverlay(title, message) {
  if (!dom.resultOverlay) return;

  dom.resultMessage.innerHTML = `<h2>${title}</h2><p>${message}</p>`;
  dom.resultOverlay.classList.add('active');
}

/**
 * Hide result overlay
 */
function hideResultOverlay() {
  if (dom.resultOverlay) {
    dom.resultOverlay.classList.remove('active');
  }
}

/**
 * Show a notification toast
 * @param {string} message - Notification text
 * @param {string} type - Type: 'success', 'error', 'info'
 */
function showNotification(message, type = 'info') {
  if (!dom.notificationContainer) return;

  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;

  dom.notificationContainer.appendChild(notification);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Make lobbyController globally accessible for inline onclick handlers
window.lobbyController = lobbyController;
