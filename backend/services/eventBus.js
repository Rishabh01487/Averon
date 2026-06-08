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