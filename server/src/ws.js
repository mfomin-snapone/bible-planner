import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { db } from "./db.js";

// userId → Set of WebSocket connections
const connections = new Map();

export function createWsServer(httpServer) {
  const jwtSecret =
    process.env.JWT_SECRET ||
    (() => { throw new Error("JWT_SECRET not set"); })();

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

    // Handle incoming client messages (typing indicators, etc.)
    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === "typing:start" || msg.event === "typing:stop") {
          const { channelId, username } = msg.data ?? {};
          if (channelId && username) {
            await broadcastToChannel(channelId, msg.event, { channelId, userId, username }, userId);
          }
        }
      } catch { /* ignore malformed */ }
    });

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

/** Broadcast an event to all participants of a channel (DM or group/thread). */
export async function broadcastToChannel(channelId, event, data, excludeUserId = null) {
  try {
    const { rows } = await db.execute({
      sql: `SELECT cp.user_id FROM channel_participants cp WHERE cp.channel_id = ?
            UNION
            SELECT gm.user_id FROM group_members gm
            JOIN channels c ON c.group_id = gm.group_id
            WHERE c.id = ?`,
      args: [channelId, channelId],
    });
    for (const row of rows) {
      const uid = String(row.user_id);
      if (uid !== excludeUserId) pushToUser(uid, event, data);
    }
  } catch { /* ignore */ }
}
