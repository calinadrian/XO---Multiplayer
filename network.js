/**
 * network.js - Network Communication Layer
 *
 * Handles WebSocket connection to the signaling server and WebRTC
 * peer-to-peer data channel for real-time game communication.
 *
 * Architecture:
 * 1. WebSocket to signaling server for lobby management & initial signaling
 * 2. WebRTC Data Channel for direct P2P game moves (once connected)
 * 3. WebSocket fallback if WebRTC fails
 *
 * Usage:
 *   const network = new Network(serverUrl);
 *   network.on('message', handler);
 *   network.connect();
 */

class Network {
  /**
   * @param {string} serverUrl - WebSocket URL of the signaling server
   * @param {object} options - Configuration options
   * @param {boolean} options.useWebRTC - Whether to attempt WebRTC (default: true)
   * @param {boolean} options.useFallback - Whether to use WebSocket fallback (default: true)
   */
  constructor(serverUrl, options = {}) {
    // Auto-detect server URL from current page location
    // Works when served from the same server (port 8080)
    // or when a custom URL is provided
    if (!serverUrl) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname || 'localhost';
      const port = window.location.port || '8080';
      serverUrl = `${proto}//${host}:${port}/ws`;
    }
    this.serverUrl = serverUrl;
    this.useWebRTC = options.useWebRTC !== false;
    this.useFallback = options.useFallback !== false;

    // WebSocket connection to signaling server
    this.ws = null;
    this.playerId = null;

    // WebRTC peer connection
    this.pc = null;
    this.dataChannel = null;
    this.isWebRTCConnected = false;

    // WebSocket fallback channel
    this.wsFallbackActive = false;

    // Event emitters (simple pub/sub)
    this._events = {};

    // ICE servers for WebRTC (use public STUN servers)
    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };

    // Connection state tracking
    this.connectionState = 'disconnected'; // disconnected, connecting, connected
  }

  // ─── Event System ──────────────────────────────────────────────

  /**
   * Register an event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push(callback);
  }

  /**
   * Emit an event with data
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data) {
    if (this._events[event]) {
      this._events[event].forEach(cb => cb(data));
    }
  }

  // ─── WebSocket Connection ──────────────────────────────────────

  /**
   * Connect to the signaling server via WebSocket
   * @returns {Promise} Resolves when connected
   */
  connect() {
    return new Promise((resolve, reject) => {
      this.connectionState = 'connecting';

      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          this.connectionState = 'connected';
          this.emit('ws_connected', true);
          resolve();
        };

        this.ws.onmessage = (event) => {
          this._handleServerMessage(JSON.parse(event.data));
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.connectionState = 'error';
          this.emit('ws_error', error);
          reject(error);
        };

        this.ws.onclose = () => {
          this.connectionState = 'disconnected';
          this.emit('ws_disconnected', true);
        };
      } catch (err) {
        this.connectionState = 'error';
        reject(err);
      }
    });
  }

  /**
   * Disconnect from the signaling server
   */
  disconnect() {
    this.closeWebRTC();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectionState = 'disconnected';
  }

  /**
   * Handle incoming messages from the signaling server
   * @param {object} message - Parsed message
   */
  _handleServerMessage(message) {
    switch (message.type) {
      case 'registered':
        this.playerId = message.playerId;
        this.emit('registered', { playerId: this.playerId });
        break;

      case 'lobby_created':
      case 'lobby_joined':
      case 'lobby_update':
        this.emit('lobby_update', message.lobby);
        break;

      case 'lobby_list':
        this.emit('lobby_list', message.lobbies);
        break;

      case 'game_start':
        this.emit('game_start', {
          board: message.board,
          firstPlayer: message.firstPlayer,
          players: message.players
        });
        break;

      case 'opponent_move':
        this.emit('opponent_move', { move: message.move, board: message.board });
        break;

      case 'opponent_result':
        this.emit('opponent_result', {
          winner: message.winner,
          isDraw: message.isDraw
        });
        break;

      case 'left_lobby':
        this.emit('left_lobby', true);
        break;

      case 'signal':
        // WebRTC signaling message - forward to peer connection
        this._handleWebRTCSignal(message.signal);
        break;

      case 'error':
        console.error('Server error:', message.message);
        this.emit('error', message.message);
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  // ─── Lobby Operations ──────────────────────────────────────────

  /**
   * Register with the server
   * @param {string} playerName - Display name
   * @returns {Promise}
   */
  register(playerName) {
    return new Promise((resolve, reject) => {
      const handler = (data) => {
        this.off('registered', handler);
        resolve(data);
      };
      this.on('registered', handler);
      this.ws.send(JSON.stringify({
        type: 'register',
        playerName: playerName,
        playerId: this.playerId
      }));
    });
  }

  /**
   * Create a new lobby
   * @param {string} playerName - Display name
   * @returns {Promise}
   */
  createLobby(playerName) {
    return new Promise((resolve, reject) => {
      const handler = (data) => {
        this.off('lobby_created', handler);
        resolve(data);
      };
      this.on('lobby_created', handler);
      this.ws.send(JSON.stringify({
        type: 'create_lobby',
        playerName: playerName
      }));
    });
  }

  /**
   * Join a lobby by ID
   * @param {string} playerName - Display name
   * @param {string} lobbyId - Lobby ID to join
   * @returns {Promise}
   */
  joinLobby(playerName, lobbyId) {
    return new Promise((resolve, reject) => {
      const handler = (data) => {
        this.off('lobby_joined', handler);
        resolve(data);
      };
      this.on('lobby_joined', handler);
      this.ws.send(JSON.stringify({
        type: 'join_lobby',
        playerName: playerName,
        lobbyId: lobbyId
      }));
    });
  }

  /**
   * Request the list of available lobbies
   */
  requestLobbyList() {
    this.ws.send(JSON.stringify({ type: 'lobby_list' }));
  }

  /**
   * Toggle ready status
   */
  toggleReady() {
    this.ws.send(JSON.stringify({ type: 'ready_toggle' }));
  }

  /**
   * Toggle rematch status
   */
  toggleRematch() {
    this.ws.send(JSON.stringify({ type: 'rematch_toggle' }));
  }

  /**
   * Leave the current lobby
   */
  leaveLobby() {
    this.ws.send(JSON.stringify({ type: 'leave_lobby' }));
  }

  /**
   * Send a game move
   * @param {number} index - Board cell index (0-8)
   * @param {Array} board - Current board state
   */
  sendMove(index, board) {
    // Try WebRTC first, always fall back to WebSocket
    if (this.isWebRTCConnected && this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({
        type: 'game_move',
        move: index,
        board: board
      }));
    }
    // Always send via WebSocket as well for reliability
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'game_move',
        move: index,
        board: board
      }));
    }
  }

  /**
   * Send a game result notification
   * @param {string|null} winner - Winner symbol or null for draw
   * @param {boolean} isDraw - Whether it's a draw
   */
  sendResult(winner, isDraw) {
    // Try WebRTC first
    if (this.isWebRTCConnected && this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({
        type: 'game_result',
        winner: winner,
        isDraw: isDraw
      }));
    }
    // Always send via WebSocket as well for reliability
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'game_result',
        winner: winner,
        isDraw: isDraw
      }));
    }
  }

  // ─── WebRTC Peer Connection ────────────────────────────────────

  /**
   * Initialize WebRTC peer connection for P2P communication
   * @param {string} opponentPlayerId - The opponent's player ID
   * @returns {Promise}
   */
  async initializeWebRTC(opponentPlayerId) {
    if (!this.useWebRTC) return;

    try {
      this.pc = new RTCPeerConnection(this.iceServers);

      // Listen for incoming data channel (for the answering side)
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this._setupDataChannel();
      };

      // Listen for ICE candidates
      this.pc.onicecandidate = (event) => {
        if (event.candidate) {
          // Send ICE candidate to opponent via signaling server
          this.ws.send(JSON.stringify({
            type: 'signal',
            signal: { type: 'ice', candidate: event.candidate }
          }));
        }
      };

      // Listen for connection state changes
      this.pc.onconnectionstatechange = () => {
        console.log('WebRTC connection state:', this.pc.connectionState);
        if (this.pc.connectionState === 'connected') {
          this.isWebRTCConnected = true;
          this.wsFallbackActive = false;
          this.emit('p2p_connected', true);
        } else if (this.pc.connectionState === 'disconnected' ||
                   this.pc.connectionState === 'failed') {
          this.isWebRTCConnected = false;
          // Fall back to WebSocket if available
          if (this.useFallback) {
            this.wsFallbackActive = true;
            this.emit('p2p_fallback', true);
          }
        }
      };

      // Listen for ICE connection state changes
      this.pc.oniceconnectionstatechange = () => {
        console.log('ICE state:', this.pc.iceConnectionState);
      };

    } catch (err) {
      console.error('WebRTC initialization error:', err);
      // Fall back to WebSocket
      if (this.useFallback) {
        this.wsFallbackActive = true;
        this.emit('p2p_fallback', true);
      }
    }
  }

  /**
   * Create an offer (for the host)
   * @returns {Promise} Resolves with the offer SDP
   */
  async createOffer() {
    if (!this.pc) {
      await this.initializeWebRTC();
      if (!this.pc) return;
    }

    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // Wait for the offer to be set, then send via signaling server
      await new Promise((resolve) => {
        const check = () => {
          if (this.pc?.localDescription) {
            this.ws.send(JSON.stringify({
              type: 'signal',
              signal: {
                type: 'offer',
                sdp: this.pc.localDescription.sdp
              }
            }));
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      this.emit('webRTC_offer_created', true);
    } catch (err) {
      console.error('WebRTC offer error:', err);
    }
  }

  /**
   * Handle incoming offer and create answer
   * @param {string} offerSDP - The SDP offer from the host
   */
  async handleOffer(offerSDP) {
    if (!this.pc) {
      await this.initializeWebRTC();
      if (!this.pc) return;
    }

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({
        type: 'offer',
        sdp: offerSDP
      }));

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      await new Promise((resolve) => {
        const check = () => {
          if (this.pc?.localDescription) {
            this.ws.send(JSON.stringify({
              type: 'signal',
              signal: {
                type: 'answer',
                sdp: this.pc.localDescription.sdp
              }
            }));
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      this.emit('webRTC_answer_created', true);
    } catch (err) {
      console.error('WebRTC answer error:', err);
    }
  }

  /**
   * Create a data channel (for the host)
   */
  createDataChannel() {
    if (!this.pc) return;

    this.dataChannel = this.pc.createDataChannel('game', {
      ordered: true // Ensure messages arrive in order
    });
    this._setupDataChannel();
  }

  /**
   * Set up the data channel event handlers
   */
  _setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('Data channel opened');
      this.isWebRTCConnected = true;
      this.wsFallbackActive = false;
      this.emit('p2p_connected', true);
    };

    this.dataChannel.onmessage = (event) => {
      const message = JSON.parse(event.data);
      switch (message.type) {
        case 'game_move':
          this.emit('opponent_move', { move: message.move, board: message.board });
          break;
        case 'game_result':
          this.emit('opponent_result', {
            winner: message.winner,
            isDraw: message.isDraw
          });
          break;
      }
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel closed');
      this.isWebRTCConnected = false;
      if (this.useFallback) {
        this.wsFallbackActive = true;
      }
    };

    this.dataChannel.onerror = (err) => {
      console.error('Data channel error:', err);
    };
  }

  /**
   * Handle incoming WebRTC signals
   * @param {object} signal - The signal data
   */
  _handleWebRTCSignal(signal) {
    if (!this.pc) return;

    try {
      switch (signal.type) {
        case 'offer':
          this.handleOffer(signal.sdp);
          break;

        case 'answer':
          this.pc.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: signal.sdp
          }));
          break;

        case 'ice':
          this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          break;

        case 'game_move':
          this.emit('opponent_move', { move: signal.move, board: signal.board });
          break;

        case 'game_result':
          this.emit('opponent_result', {
            winner: signal.winner,
            isDraw: signal.isDraw
          });
          break;
      }
    } catch (err) {
      console.error('Error handling WebRTC signal:', err);
    }
  }

  /**
   * Close WebRTC connection
   */
  closeWebRTC() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.isWebRTCConnected = false;
    this.wsFallbackActive = false;
  }

  // ─── Utility ───────────────────────────────────────────────────

  /**
   * Remove a specific event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback to remove
   */
  off(event, callback) {
    if (this._events[event]) {
      this._events[event] = this._events[event].filter(cb => cb !== callback);
    }
  }

  /**
   * Get the current connection state
   * @returns {string} Connection state
   */
  getState() {
    return this.connectionState;
  }

  /**
   * Check if P2P connection is active
   * @returns {boolean}
   */
  isP2PActive() {
    return this.isWebRTCConnected;
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Network;
}
