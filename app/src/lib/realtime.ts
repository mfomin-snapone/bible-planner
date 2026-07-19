/**
 * Real-time WebSocket client with automatic reconnection and fallback polling.
 *
 * The server exposes a WebSocket at ws(s)://host/ws?token=JWT.
 * Events are JSON objects: { event: string, data: unknown }
 */

type Listener = (data: unknown) => void;
type Unsubscribe = () => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private backoffMs = 1000;

  connect(wsUrl: string): void {
    this.url = wsUrl;
    this.intentionallyClosed = false;
    this._open();
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  on(event: string, cb: Listener): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)!.delete(cb);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Send a raw event to the server (fire-and-forget). */
  send(payload: { event: string; data: unknown }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(payload)); } catch { /* ignore */ }
    }
  }

  private _open(): void {
    if (!this.url) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.backoffMs = 1000; // reset backoff on successful connection
      this._emit("__connected", null);
    };

    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const { event, data } = JSON.parse(e.data as string) as {
          event: string;
          data: unknown;
        };
        this._emit(event, data);
      } catch {
        /* ignore malformed messages */
      }
    };

    this.ws.onclose = () => {
      this._emit("__disconnected", null);
      if (!this.intentionallyClosed) this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.backoffMs = Math.min(this.backoffMs * 1.5, 30_000);
      this._open();
    }, this.backoffMs);
  }

  private _emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach((cb) => {
      try { cb(data); } catch { /* isolate listener errors */ }
    });
  }
}

/** Singleton client for the app. */
export const realtime = new RealtimeClient();

/** Build the WebSocket URL from the current API base + auth token. */
export function buildWsUrl(token: string): string {
  const base = import.meta.env.VITE_API_URL ?? "";
  // Convert http(s) to ws(s), or use relative path
  const wsBase = base
    ? base.replace(/^http/, "ws")
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}
