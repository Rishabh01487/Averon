// ══════════════════════════════════════════════════════════════════════════════
// AVERON EVENT BUS — In-memory pub/sub for real-time events
// ══════════════════════════════════════════════════════════════════════════════

class EventBus {
  constructor() {
    this.listeners = new Map();
  }