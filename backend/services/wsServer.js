const { eventBus, EVENTS } = require('./eventBus');
const { verifyAccessToken } = require('../middleware/auth');

class WebSocketServer {
  constructor(httpServer) {
    this.clients = new Map();
    this.channels = new Map();
    this.server = httpServer;
    this.wss = null;
    this._init();
  }

  _init() {
    try {
      const { WebSocketServer: WSS } = require('ws');
      this.wss = new WSS({ server: this.server });
      console.log('  🔌 WebSocket server ready');

      this.wss.on('connection', (ws, req) => {
        const clientId = 'client_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
        const clientInfo = { ws, id: clientId, channels: new Set(), userId: null, ip: req.socket?.remoteAddress || '', connectedAt: Date.now() };

        this.clients.set(clientId, clientInfo);

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this._handleMessage(clientId, msg);
          } catch { this._send(clientId, { type: 'error', message: 'Invalid message format' }); }
        });

        ws.on('close', () => this._removeClient(clientId));

        this._send(clientId, { type: 'connected', clientId, message: 'Connected to Averon WebSocket' });
      });
    } catch (e) {
      console.log('  ⚠ WebSocket unavailable (ws package not installed)');
    }

    this._bindEvents();
  }

  _handleMessage(clientId, msg) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (msg.type) {
      case 'subscribe':
        if (msg.channel) {
          client.channels.add(msg.channel);
          if (!this.channels.has(msg.channel)) this.channels.set(msg.channel, new Set());
          this.channels.get(msg.channel).add(clientId);
          this._send(clientId, { type: 'subscribed', channel: msg.channel });
        }
        break;
      case 'unsubscribe':
        if (msg.channel) {
          client.channels.delete(msg.channel);
          this.channels.get(msg.channel)?.delete(clientId);
          this._send(clientId, { type: 'unsubscribed', channel: msg.channel });
        }
        break;
      case 'auth':
        // Verify JWT token before trusting the userId
        if (msg.token) {
          try {
            const decoded = verifyToken(msg.token);
            if (decoded && decoded.userId) {
              client.userId = decoded.userId;
              this._send(clientId, { type: 'authenticated', userId: decoded.userId });
            } else {
              this._send(clientId, { type: 'auth_error', message: 'Invalid token' });
            }
          } catch (e) {
            this._send(clientId, { type: 'auth_error', message: 'Token verification failed' });
          }
        } else {
          this._send(clientId, { type: 'auth_error', message: 'Token required for authentication' });
        }
        break;
      case 'ping':
        this._send(clientId, { type: 'pong', timestamp: Date.now() });
        break;
    }
  }

  _send(clientId, data) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === 1) {
      try { client.ws.send(JSON.stringify(data)); } catch {}
    }
  }

  _broadcast(channel, data) {
    const members = this.channels.get(channel);
    if (!members) return;
    for (const clientId of members) {
      this._send(clientId, { channel, ...data, timestamp: Date.now() });
    }
  }

  _broadcastToAll(data) {
    for (const [clientId] of this.clients) {
      this._send(clientId, data);
    }
  }

  _broadcastToUser(userId, data) {
    for (const [, client] of this.clients) {
      if (client.userId === userId) {
        this._send(client.id, data);
      }
    }
  }

  _removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      for (const channel of client.channels) {
        this.channels.get(channel)?.delete(clientId);
      }
      this.clients.delete(clientId);
    }
  }

  _bindEvents() {
    eventBus.on(EVENTS.BLOCK_MINED, (data) => this._broadcast('blocks', { type: 'block_mined', data }));
    eventBus.on(EVENTS.TRADE_EXECUTED, (data) => this._broadcast('trades', { type: 'trade_executed', data }));
    eventBus.on(EVENTS.PRICE_UPDATED, (data) => this._broadcast('price', { type: 'price_updated', data }));
    eventBus.on(EVENTS.ASSET_CREATED, (data) => this._broadcast('assets', { type: 'asset_created', data }));
    eventBus.on(EVENTS.TOKEN_PURCHASED, (data) => this._broadcast('assets', { type: 'token_purchased', data }));
    eventBus.on(EVENTS.ASSET_FUNDED, (data) => this._broadcast('assets', { type: 'asset_funded', data }));
    eventBus.on(EVENTS.ORDER_PLACED, (data) => this._broadcast('orders', { type: 'order_placed', data }));
    eventBus.on(EVENTS.COINS_MINTED, (data) => this._broadcast('price', { type: 'coins_minted', data }));
    eventBus.on(EVENTS.USER_REGISTERED, (data) => this._broadcast('users', { type: 'user_registered', data }));
  }

  getStats() {
    const channelStats = {};
    for (const [name, members] of this.channels.entries()) {
      channelStats[name] = members.size;
    }
    return {
      connectedClients: this.clients.size,
      activeChannels: this.channels.size,
      channels: channelStats,
    };
  }
}

module.exports = { WebSocketServer };
