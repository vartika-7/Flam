const WebSocket = require("ws");
const { DrawingState } = require("./drawing-state");
const { saveRoom, loadRoom } = require("./persistence");

function wsSend(ws, msg) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

const USER_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899"
];

function pickColor(i) {
  return USER_COLORS[i % USER_COLORS.length];
}

class Rooms {
  constructor() {
    this.rooms = new Map();
    this.clients = new Map();
  }

  getOrCreateRoom(roomId) {
    const id = roomId || "lobby";
    let room = this.rooms.get(id);
    if (!room) {
      const persisted = loadRoom(id);
      room = {
        id,
        clients: new Set(),
        state: new DrawingState(persisted || null),
        colorIdx: 0
      };
      this.rooms.set(id, room);
    }
    return room;
  }

  createClient(ws) {
    const client = {
      id: randomId("u"),
      ws,
      roomId: null,
      name: null,
      color: null
    };
    this.clients.set(client.id, client);
    wsSend(ws, { type: "hello", userId: client.id });
    return client;
  }

  removeClient(client) {
    if (!client) return;
    if (client.roomId) {
      const room = this.rooms.get(client.roomId);
      if (room) {
        room.clients.delete(client);
        this.broadcastRoom(room, { type: "presence:leave", userId: client.id });
        this.broadcastRoom(room, { type: "presence:list", users: this.roomUserList(room) });
      }
    }
    this.clients.delete(client.id);
  }

  roomUserList(room) {
    return Array.from(room.clients).map((c) => ({
      userId: c.id,
      name: c.name,
      color: c.color
    }));
  }

  broadcastRoom(room, msg, exceptClientId = null) {
    for (const c of room.clients) {
      if (exceptClientId && c.id === exceptClientId) continue;
      wsSend(c.ws, msg);
    }
  }

  joinRoom(client, roomId, name) {
    const room = this.getOrCreateRoom(roomId);

    if (client.roomId && client.roomId !== room.id) {
      const old = this.rooms.get(client.roomId);
      if (old) old.clients.delete(client);
    }

    client.roomId = room.id;
    client.name = String(name || `User-${client.id.slice(-4)}`);
    if (!client.color) {
      client.color = pickColor(room.colorIdx);
      room.colorIdx += 1;
    }

    room.clients.add(client);

    wsSend(client.ws, {
      type: "room:joined",
      roomId: room.id,
      me: { userId: client.id, name: client.name, color: client.color },
      users: this.roomUserList(room),
      snapshot: room.state.snapshot()
    });

    this.broadcastRoom(room, { type: "presence:join", userId: client.id, name: client.name, color: client.color }, client.id);
    this.broadcastRoom(room, { type: "presence:list", users: this.roomUserList(room) });
  }

  handleClientMessage(client, msg) {
    if (msg.type === "room:join") {
      this.joinRoom(client, msg.roomId, msg.name);
      return;
    }

    if (msg.type === "ping") {
      wsSend(client.ws, { type: "pong", at: Date.now(), echo: msg.at || null });
      return;
    }

    if (!client.roomId) {
      wsSend(client.ws, { type: "error", message: "Join a room first." });
      return;
    }

    const room = this.rooms.get(client.roomId);
    if (!room) {
      wsSend(client.ws, { type: "error", message: "Room not found." });
      return;
    }

    if (msg.type === "cursor") {
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this.broadcastRoom(room, { type: "cursor", userId: client.id, x, y, at: Date.now() }, client.id);
      return;
    }

    if (msg.type === "stroke:begin" || msg.type === "stroke:point" || msg.type === "stroke:end") {
      const payload = { ...msg, userId: client.id, color: client.color };
      this.broadcastRoom(room, payload, client.id);

      if (msg.type === "stroke:end") {
        try {
          const commit = room.state.addStroke({
            id: String(msg.strokeId || ""),
            userId: client.id,
            tool: String(msg.tool || "brush"),
            color: String(msg.color || client.color),
            width: Number(msg.width) || 4,
            points: Array.isArray(msg.points) ? msg.points : [],
            shape: msg.shape || null,
            text: msg.text || null,
            x: msg.x != null ? Number(msg.x) : null,
            y: msg.y != null ? Number(msg.y) : null,
            fontSize: msg.fontSize != null ? Number(msg.fontSize) : null,
            imageData: msg.imageData || null,
            height: msg.height != null ? Number(msg.height) : null
          });

          if (commit) {
            saveRoom(room.id, room.state);
            this.broadcastRoom(room, { type: "stroke:commit", stroke: commit.stroke, op: commit.op });
          }
        } catch (err) {
          wsSend(client.ws, { type: "error", message: `Invalid stroke: ${err.message}` });
        }
      }
      return;
    }

    if (msg.type === "history:undo") {
      const op = room.state.undo(client.id);
      if (op) {
        saveRoom(room.id, room.state);
        this.broadcastRoom(room, { type: "history:undo", op });
      }
      return;
    }

    if (msg.type === "history:redo") {
      const op = room.state.redo(client.id);
      if (op) {
        saveRoom(room.id, room.state);
        this.broadcastRoom(room, { type: "history:redo", op });
      }
      return;
    }

    wsSend(client.ws, { type: "error", message: `Unknown message type: ${msg.type}` });
  }
}

module.exports = { Rooms };

