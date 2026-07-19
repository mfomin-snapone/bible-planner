import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";

// userId → WebSocket connection(s)
const connections = new Map();

export function createWsServer(httpServer) {
  const jwtSecret =
    process.env.JWT_SECRET ||
    (() => {
      throw new Error("JWT_SECRET not set");
    })();

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    let userId = null;

    try {
      const url = new URL(req.url, "ws://localhost");
      const token = url.searchParams.get("token");
      if (!token) throw new Error("No token");
      const payload = jwt.verify(token, jwtSecret);
      userId = payload.sub;
    } catch {
      ws.close(1008, "Invalid token");
      return;
    }

    // Support multiple tabs / devices for the same user
    if (!connections.has(userId)) connections.set(userId, new Set());
    connections.get(userId).add(ws);

    ws.on("close", () => {
      connections.get(userId)?.delete(ws);
      if (connections.get(userId)?.size === 0) connections.delete(userId);
    });

    ws.on("error", () => ws.terminate());
  });

  return wss;
}

/** Push a JSON event to all sockets for a given userId. */
export function pushToUser(userId, event, data) {
  const sockets = connections.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify({ event, data });
  for (const ws of sockets) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(payload); } catch { /* ignore */ }
    }
  }
}
