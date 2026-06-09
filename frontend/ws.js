class AveronWS {
  constructor(url) {
    this.url = url || `ws://${window.location.host}`;
    this.ws = null;
    this.listeners = {};
    this.connected = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnect = 10;
    this._connect();
  }

  _connect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      console.warn('WebSocket not available:', e.message);
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this._emit('connected', {});
      if (window.Averon?.getState) {
        const state = window.Averon.getState();
        if (state?.user?.id) this._send({ type: 'auth', userId: state.user.id });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connected') this._emit('ready', msg);
        else if (msg.channel) this._emit(msg.channel, msg);
        else this._emit(msg.type, msg);
      } catch {}
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._reconnect();
    };

    this.ws.onerror = () => {};
  }

  _reconnect() {
    if (this.reconnectAttempts >= this.maxReconnect) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  _send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  subscribe(channel) {
    this._send({ type: 'subscribe', channel });
  }

  unsubscribe(channel) {
    this._send({ type: 'unsubscribe', channel });
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  _emit(event, data) {
    if (!this.listeners[event]) return;
    for (const cb of this.listeners[event]) cb(data);
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    this.maxReconnect = 0;
    if (this.ws) this.ws.close();
  }
}

if (typeof window !== 'undefined') {
  window.AveronWS = AveronWS;
}
