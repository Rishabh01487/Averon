// ══════════════════════════════════════════════════════════════════════════════
// AVERON EVENT BUS — In-memory pub/sub for real-time events
// ══════════════════════════════════════════════════════════════════════════════

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const cbs = this.listeners.get(event);
    if (cbs) this.listeners.set(event, cbs.filter(cb => cb !== callback));
  }

  emit(event, data) {
    const cbs = this.listeners.get(event) || [];
    for (const cb of cbs) {
      try { cb(data); } catch (e) { console.error(`Event error [${event}]:`, e.message); }
    }
    // Also emit to wildcard listeners
    const wildcards = this.listeners.get('*') || [];
    for (const cb of wildcards) {
      try { cb({ event, data }); } catch {}
    }
  }
}

// Singleton
const eventBus = new EventBus();

// Event names
const EVENTS = {
  BLOCK_MINED: 'BLOCK_MINED',
  TRADE_EXECUTED: 'TRADE_EXECUTED',
  ORDER_PLACED: 'ORDER_PLACED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  PRICE_UPDATED: 'PRICE_UPDATED',
  ASSET_CREATED: 'ASSET_CREATED',
  ASSET_STATUS_CHANGED: 'ASSET_STATUS_CHANGED',
  ASSET_FUNDED: 'ASSET_FUNDED',
  TOKEN_PURCHASED: 'TOKEN_PURCHASED',
  COINS_MINTED: 'COINS_MINTED',
  USER_REGISTERED: 'USER_REGISTERED',
  NOTIFICATION: 'NOTIFICATION',
  ESCROW_LOCKED: 'ESCROW_LOCKED',
  ESCROW_RELEASED: 'ESCROW_RELEASED',
  CIRCUIT_BREAKER: 'CIRCUIT_BREAKER',
};

module.exports = { eventBus, EVENTS };