export class WSClient {
  constructor({ url }) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
    this.isOpen = false;
    this.connectionState = "disconnected";

    this._pendingSends = [];
    this._pingInterval = null;
    this._lastPingAt = 0;
    this._reconnectAttempts = 0;
    this._reconnectTimeout = null;
    this._maxReconnectDelay = 30000;
    this._initialReconnectDelay = 1000;

    this._latency = null;
    this._pingsSent = 0;
    this._pongsReceived = 0;
    this._lastPongAt = 0;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const fns = this.handlers.get(type);
    if (!fns) return;
    for (const fn of fns) fn(payload);
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this._clearReconnectTimeout();
    this.connectionState = this.connectionState === "disconnected" ? "connecting" : "reconnecting";
    this.emit("connectionState", { state: this.connectionState });

    try {
      this.ws = new WebSocket(this.url);

      this.ws.addEventListener("open", () => {
        this.isOpen = true;
        this.connectionState = "connected";
        this._reconnectAttempts = 0;
        this.emit("connectionState", { state: this.connectionState });
        this.emit("open", {});
        for (const msg of this._pendingSends.splice(0)) this.send(msg);
        this._startPing();
      });

      this.ws.addEventListener("message", (ev) => {
        let msg = null;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!msg || typeof msg.type !== "string") return;
        this.emit("message", msg);
        this.emit(msg.type, msg);
      });

      this.ws.addEventListener("close", (ev) => {
        this.isOpen = false;
        this.connectionState = "disconnected";
        this.emit("connectionState", { state: this.connectionState });
        this.emit("close", { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
        this._stopPing();

        if (!ev.wasClean || ev.code !== 1000) {
          this._scheduleReconnect();
        }
      });

      this.ws.addEventListener("error", (ev) => {
        this.emit("error", { error: ev });
      });
    } catch (err) {
      this.connectionState = "disconnected";
      this.emit("connectionState", { state: this.connectionState });
      this.emit("error", { error: err });
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    this._clearReconnectTimeout();
    const delay = Math.min(
      this._initialReconnectDelay * Math.pow(2, this._reconnectAttempts),
      this._maxReconnectDelay
    );
    this._reconnectAttempts += 1;
    this.connectionState = "reconnecting";
    this.emit("connectionState", { state: this.connectionState, attempt: this._reconnectAttempts, delay });

    this._reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  _clearReconnectTimeout() {
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = null;
    }
  }

  disconnect() {
    this._clearReconnectTimeout();
    this._stopPing();
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.connectionState = "disconnected";
    this.isOpen = false;
    this.emit("connectionState", { state: this.connectionState });
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this._pendingSends.push(msg);
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  _startPing() {
    this._stopPing();
    this._pingsSent = 0;
    this._pongsReceived = 0;
    this._pingInterval = setInterval(() => {
      if (!this.isOpen) {
        this._stopPing();
        return;
      }
      this._lastPingAt = performance.now();
      this._pingsSent += 1;
      this.send({ type: "ping", at: Date.now() });
      this._checkConnectionQuality();
    }, 1500);
  }

  _stopPing() {
    if (this._pingInterval) clearInterval(this._pingInterval);
    this._pingInterval = null;
  }

  _checkConnectionQuality() {
    const pongRatio = this._pingsSent > 0 ? this._pongsReceived / this._pingsSent : 1;
    const timeSinceLastPong = this._lastPongAt > 0 ? Date.now() - this._lastPongAt : 0;

    if (pongRatio < 0.5 && this._pingsSent > 3) {
      this.emit("connectionQuality", { quality: "poor", pongRatio, latency: this._latency });
    } else if (timeSinceLastPong > 5000 && this._pingsSent > 2) {
      this.emit("connectionQuality", { quality: "degraded", pongRatio, latency: this._latency });
    }
  }

  getConnectionQuality() {
    const pongRatio = this._pingsSent > 0 ? this._pongsReceived / this._pingsSent : 1;
    return {
      state: this.connectionState,
      latency: this._latency,
      pongRatio,
      isHealthy: this.isOpen && pongRatio > 0.7 && (this._latency === null || this._latency < 500)
    };
  }

  setUrl(url) {
    this.url = url;
  }

  recordPong() {
    this._pongsReceived += 1;
    this._lastPongAt = Date.now();
    if (this._lastPingAt > 0) {
      this._latency = Math.round(performance.now() - this._lastPingAt);
      this.emit("latency", { latency: this._latency });
    }
  }
}

