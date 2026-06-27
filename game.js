/**
 * game.js - Tic-Tac-Toe Game Logic
 *
 * Pure game logic with no UI or networking dependencies.
 * Handles board state, move validation, win/draw detection,
 * and turn management.
 *
 * Usage:
 *   const game = new Game();
 *   game.makeMove(index);
 *   const result = game.getResult();
 */

class Game {
  constructor() {
    this.reset();
  }

  /**
   * Reset the game to initial state
   * @param {string} firstPlayer - Player who goes first ('X' or 'O')
   */
  reset(firstPlayer = 'X') {
    // Board: 9 cells, null = empty
    this.board = Array(9).fill(null);

    // Current player's turn
    this.currentPlayer = firstPlayer;

    // Game state: 'playing', 'won', 'draw'
    this.state = 'playing';

    // Winner symbol or null
    this.winner = null;

    // Winning line (3 indices) or null
    this.winningLine = null;

    // Move count
    this.moveCount = 0;

    // History of moves (for potential undo)
    this.history = [];
  }

  /**
   * Check if a move is valid
   * @param {number} index - Cell index (0-8)
   * @returns {boolean}
   */
  isValidMove(index) {
    return (
      index >= 0 &&
      index <= 8 &&
      this.board[index] === null &&
      this.state === 'playing'
    );
  }

  /**
   * Make a move on the board
   * @param {number} index - Cell index (0-8)
   * @returns {object|null} Move result or null if invalid
   */
  makeMove(index) {
    if (!this.isValidMove(index)) {
      return null;
    }

    // Record the move
    this.board[index] = this.currentPlayer;
    this.history.push({ index, player: this.currentPlayer });
    this.moveCount++;

    // Check for win
    const winResult = this._checkWin();
    if (winResult) {
      this.state = 'won';
      this.winner = this.currentPlayer;
      this.winningLine = winResult;
      return { type: 'win', player: this.currentPlayer, line: winResult };
    }

    // Check for draw
    if (this.moveCount === 9) {
      this.state = 'draw';
      return { type: 'draw' };
    }

    // Switch turns
    this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
    return { type: 'move', nextPlayer: this.currentPlayer };
  }

  /**
   * Check for a win condition
   * @returns {number[]|null} Winning line indices or null
   * @private
   */
  _checkWin() {
    // All possible winning lines
    const lines = [
      [0, 1, 2], // Top row
      [3, 4, 5], // Middle row
      [6, 7, 8], // Bottom row
      [0, 3, 6], // Left column
      [1, 4, 7], // Middle column
      [2, 5, 8], // Right column
      [0, 4, 8], // Diagonal top-left to bottom-right
      [2, 4, 6]  // Diagonal top-right to bottom-left
    ];

    for (const line of lines) {
      const [a, b, c] = line;
      if (
        this.board[a] !== null &&
        this.board[a] === this.board[b] &&
        this.board[a] === this.board[c]
      ) {
        return line;
      }
    }

    return null;
  }

  /**
   * Get the current game result
   * @returns {object} Game result info
   */
  getResult() {
    return {
      state: this.state,
      winner: this.winner,
      winningLine: this.winningLine,
      currentPlayer: this.currentPlayer,
      moveCount: this.moveCount
    };
  }

  /**
   * Get the board state (useful for serialization)
   * @returns {Array} Board array
   */
  getBoardState() {
    return [...this.board];
  }

  /**
   * Restore board state from array (for syncing with opponent)
   * @param {Array} boardState - Board array to restore
   */
  setBoardState(boardState) {
    this.board = [...boardState];
    this.moveCount = boardState.filter(cell => cell !== null).length;

    // Recalculate current player based on move count
    this.currentPlayer = this.moveCount % 2 === 0 ? 'X' : 'O';

    // Check if the restored state has a winner
    const winResult = this._checkWin();
    if (winResult) {
      this.state = 'won';
      this.winner = this.board[winResult[0]];
      this.winningLine = winResult;
    } else if (this.moveCount === 9) {
      this.state = 'draw';
    } else {
      this.state = 'playing';
    }
  }

  /**
   * Undo the last move (for local testing)
   * @returns {object|null} The undone move or null
   */
  undoLastMove() {
    if (this.history.length === 0) return null;

    const lastMove = this.history.pop();
    this.board[lastMove.index] = null;
    this.moveCount--;
    this.currentPlayer = lastMove.player;

    // Reset game state if needed
    if (this.state !== 'playing') {
      const winResult = this._checkWin();
      if (winResult) {
        this.state = 'won';
        this.winner = this.board[winResult[0]];
        this.winningLine = winResult;
      } else if (this.moveCount === 9) {
        this.state = 'draw';
      } else {
        this.state = 'playing';
        this.winner = null;
        this.winningLine = null;
      }
    }

    return lastMove;
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Game;
}
