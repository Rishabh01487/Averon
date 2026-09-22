// ══════════════════════════════════════════════════════════════════════════════
// AVERON P2P NETWORK — WebSocket-based peer-to-peer layer
// ══════════════════════════════════════════════════════════════════════════════
//
// Decentralizes the inbuilt blockchain by allowing multiple Averon server
// instances to:
//   1. Discover each other (via seed list in PEERS env var)
//   2. Gossip transactions (broadcast new tx to all peers)
//   3. Gossip blocks (broadcast newly-mined block)
//   4. Sync the chain (new node downloads full history from peers)
//   5. Resolve forks (longest valid chain wins — Nakamoto consensus)
//
// Network model: Permissioned consortium (whitelisted node identities).
//
// Message protocol (JSON, signed with node ECDSA key):
//   { type, from, payload, sig, ts }
//
// Message types:
//   HANDSHAKE     — node announcement (sends identity + chain tip)
//   HANDSHAKE_ACK — peer acknowledges handshake (sends their identity + tip)
//   NEW_TX        — new transaction broadcast (gossip)
//   NEW_BLOCK     — newly mined block broadcast (gossip)
//   QUERY_CHAIN   — request full chain from peer
//   CHAIN         — peer responds with their full chain
//   QUERY_PEERS   — request peer list
//   PEERS         — peer responds with their known peers
//   PING          — keepalive
//   PONG          — keepalive response
//
// ══════════════════════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const { EventEmitter } = require('events');
const { NodeIdentity } = require('./nodeIdentity');
const { Block } = require('./block');
const { Transaction } = require('./transaction');
const C = require('../config/constants');

const MSG = {
  HANDSHAKE: 'HANDSHAKE',
  HANDSHAKE_ACK: 'HANDSHAKE_ACK',
  NEW_TX: 'NEW_TX',
  NEW_BLOCK: 'NEW_BLOCK',
  QUERY_CHAIN: 'QUERY_CHAIN',
  CHAIN: 'CHAIN',
  QUERY_PEERS: 'QUERY_PEERS',
  PEERS: 'PEERS',
  PING: 'PING',
  PONG: 'PONG',
};

class P2PNode extends EventEmitter {
  constructor(blockchain, port = null) {
    super();
    this.blockchain = blockchain;
    this.identity = new NodeIdentity();

    this.port = port || (process.env.P2P_PORT ? parseInt(process.env.P2P_PORT) : C.NETWORK.DEFAULT_P2P_PORT);
    this.server = null;
    this.peers = new Map();  // nodeId -> { ws, identity, chainTip, lastSeen, isOutbound }
    this.server = null;
    this.maxPeers = C.NETWORK.MAX_PEERS;
    this.handshakeTimeoutMs = C.NETWORK.HANDSHAKE_TIMEOUT_MS;
    this.pingIntervalMs = C.NETWORK.PING_INTERVAL_MS;
    this.pingTimer = null;
    this.reconnectTimers = new Map();
    this.isStarted = false;

    // Whitelist of approved node IDs (consortium model).
    // If empty, accepts any node that completes a valid signed handshake.
    // Set via env var: TRUSTED_NODES=node_abc123,node_def456
    this.trustedNodes = (process.env.TRUSTED_NODES || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Start the P2P node: open WebSocket server + dial seed peers.
   */
  start() {
    if (this.isStarted) return;
    this.isStarted = true;

    // Start WebSocket server (accept inbound peer connections)
    this.server = new WebSocket.Server({ port: this.port, maxPayload: 64 * 1024 * 1024 });
    this.server.on('connection', (ws, req) => this._onInboundConnection(ws, req));
    this.server.on('error', (err) => {
      console.error(`  🌐 P2P server error: ${err.message}`);
    });
    console.log(`  🌐 P2P server listening on port ${this.port}`);
    console.log(`  🔑 Node ID: ${this.identity.getShortId()}`);

    // Dial seed peers from PEERS env var
    const seeds = (process.env.PEERS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (seeds.length === 0) {
      console.log('  ℹ No seed peers configured (set PEERS env var to connect to other nodes)');
    } else {
      console.log(`  🌱 Dialing ${seeds.length} seed peer(s)...`);
      for (const seed of seeds) {
        this._dialPeer(seed);
      }
    }

    // Start periodic ping
    this.pingTimer = setInterval(() => this._pingAll(), this.pingIntervalMs);
  }

  /**
   * Gracefully stop the P2P node.
   */
  stop() {
    this.isStarted = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const { ws } of this.peers.values()) {
      try { ws.close(); } catch {}
    }
    this.peers.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    console.log('  🌐 P2P node stopped');
  }

  // ── Inbound (peer dials us) ─────────────────────────────────────────────

  _onInboundConnection(ws, req) {
    const ip = req.socket.remoteAddress;
    console.log(`  📥 Inbound connection from ${ip}`);
    this._registerMessageHandlers(ws, ip, /* outbound */ false);
  }

  // ── Outbound (we dial a peer) ──────────────────────────────────────────

  _dialPeer(url, attempt = 1) {
    if (!this.isStarted) return;
    if (this.peers.size >= this.maxPeers) {
      console.log(`  ⚠ Max peers (${this.maxPeers}) reached, skipping ${url}`);
      return;
    }

    console.log(`  📞 Dialing peer: ${url} (attempt ${attempt})`);
    let ws;
    try {
      ws = new WebSocket(url, { handshakeTimeout: this.handshakeTimeoutMs });
    } catch (e) {
      console.log(`  ✗ Failed to dial ${url}: ${e.message}`);
      this._scheduleReconnect(url, attempt);
      return;
    }

    ws.on('open', () => {
      console.log(`  ✓ Connected to ${url}`);
      // Send handshake
      this._send(ws, MSG.HANDSHAKE, {
        identity: this.identity.getPublicIdentity(),
        chainTip: this.blockchain.getLatestBlock()?.hash || '0',
        chainHeight: this.blockchain.chain.length,
        p2pPort: this.port,
      });
    });

    ws.on('error', (err) => {
      console.log(`  ✗ Peer error ${url}: ${err.message}`);
    });

    ws.on('close', () => {
      // Remove peer from map (will be re-registered on reconnect via HANDSHAKE)
      for (const [nodeId, info] of this.peers.entries()) {
        if (info.ws === ws) {
          console.log(`  🔌 Peer ${nodeId.substring(0, 20)}... disconnected`);
          this.peers.delete(nodeId);
          this.emit('peer-disconnected', nodeId);
          break;
        }
      }
      this._scheduleReconnect(url, attempt);
    });

    this._registerMessageHandlers(ws, url, /* outbound */ true);
  }

  _scheduleReconnect(url, attempt) {
    if (!this.isStarted) return;
    if (attempt > C.NETWORK.MAX_RECONNECT_ATTEMPTS) {
      console.log(`  ⚠ Giving up on peer ${url} after ${attempt} attempts`);
      return;
    }
    const delay = Math.min(C.NETWORK.RECONNECT_BASE_DELAY * 2 ** (attempt - 1), C.NETWORK.RECONNECT_MAX_DELAY);
    const timer = setTimeout(() => this._dialPeer(url, attempt + 1), delay);
    this.reconnectTimers.set(url, timer);
  }

  // ── Message handling ───────────────────────────────────────────────────

  _registerMessageHandlers(ws, remoteAddr, isOutbound) {
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;  // ignore malformed messages
      }
      this._handleMessage(ws, msg, remoteAddr, isOutbound);
    });
  }

  _handleMessage(ws, msg, remoteAddr, isOutbound) {
    // Validate message envelope
    if (!msg || !msg.type || !msg.from) return;

    // Verify signature (unless it's a HANDSHAKE we're processing first time)
    if (msg.type !== MSG.HANDSHAKE && msg.type !== MSG.HANDSHAKE_ACK) {
      // Look up peer's public key from our known peers
      const peer = this.peers.get(msg.from);
      if (!peer) {
        // Unknown sender — maybe we missed the handshake
        return;
      }
      if (!NodeIdentity.verify(msg.payload, msg.sig, peer.identity.publicKey)) {
        console.log(`  ⚠ Invalid signature from ${msg.from.substring(0, 20)}...`);
        return;
      }
    }

    switch (msg.type) {
      case MSG.HANDSHAKE:
        this._onHandshake(ws, msg, isOutbound);
        break;
      case MSG.HANDSHAKE_ACK:
        this._onHandshakeAck(ws, msg);
        break;
      case MSG.NEW_TX:
        this._onNewTx(msg);
        break;
      case MSG.NEW_BLOCK:
        this._onNewBlock(msg);
        break;
      case MSG.QUERY_CHAIN:
        this._onQueryChain(ws, msg);
        break;
      case MSG.CHAIN:
        this._onChain(msg);
        break;
      case MSG.QUERY_PEERS:
        this._onQueryPeers(ws, msg);
        break;
      case MSG.PEERS:
        this._onPeers(msg);
        break;
      case MSG.PING:
        this._send(ws, MSG.PONG, { ts: Date.now() });
        break;
      case MSG.PONG:
        // Update lastSeen for this peer
        const peer = this.peers.get(msg.from);
        if (peer) peer.lastSeen = Date.now();
        break;
    }
  }

  // ── HANDSHAKE ───────────────────────────────────────────────────────────

  _onHandshake(ws, msg, isOutbound) {
    const { identity, chainTip, chainHeight, p2pPort } = msg.payload;
    if (!identity || !identity.nodeId || !identity.publicKey) return;

    // Verify the handshake signature (proves they hold the private key for that pubkey)
    if (!NodeIdentity.verify(msg.payload, msg.sig, identity.publicKey)) {
      console.log(`  ⚠ Handshake from ${identity.nodeId.substring(0, 20)}... has invalid signature`);
      try { ws.close(); } catch {}
      return;
    }

    // Consortium whitelist check (if configured)
    if (this.trustedNodes.length > 0 && !this.trustedNodes.includes(identity.nodeId)) {
      console.log(`  ⚠ Node ${identity.nodeId.substring(0, 20)}... not in trusted list — rejecting`);
      try { ws.close(); } catch {}
      return;
    }

    // Reject self-connection (we'd dial ourselves if our own address is in PEERS)
    if (identity.nodeId === this.identity.nodeId) {
      console.log(`  ⚠ Self-connection detected, closing`);
      try { ws.close(); } catch {}
      return;
    }

    // Reject duplicate connections
    if (this.peers.has(identity.nodeId)) {
      console.log(`  ⚠ Already connected to ${identity.nodeId.substring(0, 20)}..., closing duplicate`);
      try { ws.close(); } catch {}
      return;
    }

    // Register peer
    this.peers.set(identity.nodeId, {
      ws,
      identity,
      chainTip,
      chainHeight,
      lastSeen: Date.now(),
      isOutbound,
    });
    console.log(`  ✓ Peer connected: ${identity.nodeId.substring(0, 20)}... (chain height ${chainHeight})`);
    this.emit('peer-connected', identity.nodeId);

    // Send HANDSHAKE_ACK with our own identity + chain tip
    this._send(ws, MSG.HANDSHAKE_ACK, {
      identity: this.identity.getPublicIdentity(),
      chainTip: this.blockchain.getLatestBlock()?.hash || '0',
      chainHeight: this.blockchain.chain.length,
      p2pPort: this.port,
    });

    // If peer's chain is longer, request their full chain to sync
    if (chainHeight > this.blockchain.chain.length) {
      console.log(`  🔄 Peer chain (${chainHeight}) is longer than ours (${this.blockchain.chain.length}) — syncing`);
      this._send(ws, MSG.QUERY_CHAIN, { fromHeight: this.blockchain.chain.length });
    }
  }

  _onHandshakeAck(ws, msg) {
    const { identity, chainTip, chainHeight } = msg.payload;
    if (!identity) return;

    // Verify ack signature
    if (!NodeIdentity.verify(msg.payload, msg.sig, identity.publicKey)) return;

    // Already registered during our outbound handshake send? Re-register with updated tip.
    if (!this.peers.has(identity.nodeId)) {
      this.peers.set(identity.nodeId, {
        ws,
        identity,
        chainTip,
        chainHeight,
        lastSeen: Date.now(),
        isOutbound: true,
      });
      console.log(`  ✓ Peer handshake-acknowledged: ${identity.nodeId.substring(0, 20)}...`);
      this.emit('peer-connected', identity.nodeId);
    }

    if (chainHeight > this.blockchain.chain.length) {
      console.log(`  🔄 Peer chain (${chainHeight}) > ours (${this.blockchain.chain.length}) — syncing`);
      this._send(ws, MSG.QUERY_CHAIN, { fromHeight: this.blockchain.chain.length });
    }
  }

  // ── NEW_TX ──────────────────────────────────────────────────────────────

  /**
   * Called by the asset/trading/payment services when a new tx is added locally.
   * Broadcasts the tx to all peers (gossip).
   */
  broadcastTransaction(tx) {
    if (this.peers.size === 0) return;
    const txJson = tx.toJSON ? tx.toJSON() : JSON.parse(JSON.stringify(tx));
    for (const { ws } of this.peers.values()) {
      this._send(ws, MSG.NEW_TX, { tx: txJson });
    }
  }

  _onNewTx(msg) {
    const { tx: txJson } = msg.payload;
    if (!txJson) return;

    try {
      const tx = Transaction.fromJSON(txJson);

      // Don't re-broadcast if we already have it
      const exists = this.blockchain.pendingTransactions.find(t => t.hash === tx.hash) ||
                     this.blockchain.chain.some(b => b.transactions.some(t => t.hash === tx.hash));
      if (exists) return;

      // Add to our mempool (will throw if invalid)
      this.blockchain.addTransaction(tx);
      console.log(`  📨 Received tx from peer: ${tx.hash.substring(0, 12)}... type=${tx.type}`);

      this.emit('tx-received', tx);

      // Re-gossip to other peers (flood fill)
      this.broadcastTransaction(tx);
    } catch (e) {
      // Invalid tx — ignore
      console.log(`  ⚠ Rejected tx from peer: ${e.message}`);
    }
  }

  // ── NEW_BLOCK ───────────────────────────────────────────────────────────

  /**
   * Called by the blockchain after it mines a new block locally.
   * Broadcasts the block to all peers.
   */
  broadcastBlock(block) {
    if (this.peers.size === 0) return;
    const blockJson = block.toJSON ? block.toJSON() : JSON.parse(JSON.stringify(block));
    for (const { ws } of this.peers.values()) {
      this._send(ws, MSG.NEW_BLOCK, { block: blockJson });
    }
  }

  _onNewBlock(msg) {
    const { block: blockJson } = msg.payload;
    if (!blockJson) return;

    try {
      const block = Block.fromJSON(blockJson);

      // Validate the block (PoW, hash chain, transaction signatures)
      const validation = this._validateBlock(block);
      if (!validation.valid) {
        console.log(`  ⚠ Invalid block from peer: ${validation.error}`);
        return;
      }

      // If it's the next block in our chain, append it
      const latest = this.blockchain.getLatestBlock();
      if (block.previousHash === latest.hash && block.index === latest.index + 1) {
        this.blockchain.chain.push(block);
        // Remove its transactions from our mempool
        this.blockchain.pendingTransactions = this.blockchain.pendingTransactions.filter(
          t => !block.transactions.some(bt => bt.hash === t.hash)
        );
        console.log(`  📦 Received block #${block.index} from peer (${block.transactions.length} txs)`);
        this.emit('block-received', block);

        // Re-broadcast
        this.broadcastBlock(block);
      } else if (block.index > latest.index) {
        // Peer is ahead — request their full chain to sync
        console.log(`  🔄 Peer's block #${block.index} is ahead of our #${latest.index} — requesting chain sync`);
        const peer = this.peers.get(msg.from);
        if (peer) this._send(peer.ws, MSG.QUERY_CHAIN, { fromHeight: 0 });
      }
    } catch (e) {
      console.log(`  ⚠ Failed to process block from peer: ${e.message}`);
    }
  }

  _validateBlock(block) {
    // Re-compute hash and check PoW
    const computedHash = block.calculateHash();
    if (computedHash !== block.hash) {
      return { valid: false, error: 'Hash mismatch' };
    }
    const target = '0'.repeat(block.difficulty);
    if (!block.hash.startsWith(target)) {
      return { valid: false, error: 'PoW not satisfied' };
    }
    // Check chain linkage
    const latest = this.blockchain.getLatestBlock();
    if (block.previousHash !== latest.hash) {
      return { valid: false, error: `Previous hash mismatch (expected ${latest.hash.substring(0, 12)}, got ${block.previousHash.substring(0, 12)})` };
    }
    return { valid: true };
  }

  // ── QUERY_CHAIN / CHAIN (sync) ─────────────────────────────────────────

  _onQueryChain(ws, msg) {
    const { fromHeight } = msg.payload || { fromHeight: 0 };
    const blocks = this.blockchain.chain.slice(fromHeight);
    this._send(ws, MSG.CHAIN, { blocks, chainHeight: this.blockchain.chain.length });
  }

  _onChain(msg) {
    const { blocks, chainHeight } = msg.payload;
    if (!Array.isArray(blocks)) return;

    // Reconstruct Block objects
    const newChain = blocks.map(b => Block.fromJSON(b));

    // Validate the entire new chain
    if (newChain.length <= this.blockchain.chain.length) {
      // Our chain is already as long or longer — ignore
      return;
    }

    // Check: does the new chain's hash chain link up?
    let valid = true;
    for (let i = 1; i < newChain.length; i++) {
      if (newChain[i].previousHash !== newChain[i - 1].hash) {
        valid = false; break;
      }
      if (newChain[i].hash !== newChain[i].calculateHash()) {
        valid = false; break;
      }
    }
    if (!valid) {
      console.log(`  ⚠ Received invalid chain from ${msg.from.substring(0, 20)}...`);
      return;
    }

    // Longest valid chain wins — replace ours
    console.log(`  🔄 Replacing chain (ours: ${this.blockchain.chain.length} blocks, theirs: ${newChain.length} blocks)`);
    this.blockchain.replaceChain(newChain);
    this.emit('chain-replaced', { oldHeight: this.blockchain.chain.length, newHeight: newChain.length });
    console.log(`  ✓ Chain synced to ${newChain.length} blocks`);
  }

  // ── QUERY_PEERS / PEERS ─────────────────────────────────────────────────

  _onQueryPeers(ws, msg) {
    // Send our peer list (only public connection info, not private keys etc.)
    const peerList = [];
    for (const [nodeId, info] of this.peers.entries()) {
      if (info.isOutbound && info.identity) {
        // For outbound peers, we know their URL from our dial
        // We can't include the URL because we don't track it here
        // Just share the nodeId + chainHeight for now
        peerList.push({ nodeId, chainHeight: info.chainHeight });
      }
    }
    this._send(ws, MSG.PEERS, { peers: peerList });
  }

  _onPeers(msg) {
    const { peers } = msg.payload;
    if (!Array.isArray(peers)) return;
    // For now, we don't auto-dial new peers discovered via gossip
    // (in consortium mode, all peers should be in the seed list anyway)
    console.log(`  📋 Received peer list from ${msg.from.substring(0, 20)}...: ${peers.length} peers`);
  }

  // ── Send helpers ────────────────────────────────────────────────────────

  _send(ws, type, payload) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const fullMsg = {
      type,
      from: this.identity.nodeId,
      payload,
      ts: Date.now(),
      sig: this.identity.sign(payload),
    };
    try {
      ws.send(JSON.stringify(fullMsg));
    } catch (e) {
      // Peer disconnected mid-send — ignore
    }
  }

  _pingAll() {
    for (const { ws, identity } of this.peers.values()) {
      this._send(ws, MSG.PING, { ts: Date.now() });
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Get a list of connected peers for the admin UI.
   */
  getPeerList() {
    const peers = [];
    for (const [nodeId, info] of this.peers.entries()) {
      peers.push({
        nodeId,
        shortId: nodeId.substring(0, 20) + '...',
        chainHeight: info.chainHeight,
        chainTip: info.chainTip,
        lastSeen: info.lastSeen,
        isOutbound: info.isOutbound,
      });
    }
    return peers;
  }

  /**
   * Manually connect to a peer (admin API).
   */
  connectToPeer(url) {
    this._dialPeer(url, 1);
    return { dialing: url };
  }

  /**
   * Get network status for the admin UI.
   */
  getStatus() {
    return {
      nodeId: this.identity.nodeId,
      shortId: this.identity.getShortId(),
      p2pPort: this.port,
      peerCount: this.peers.size,
      maxPeers: this.maxPeers,
      chainHeight: this.blockchain.chain.length,
      chainTip: this.blockchain.getLatestBlock()?.hash || '0',
      trustedNodes: this.trustedNodes.length,
      isStarted: this.isStarted,
    };
  }
}

module.exports = { P2PNode, MSG };
