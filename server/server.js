const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");

const { Rooms } = require("./rooms");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();
app.use(express.static(path.join(__dirname, "..", "client")));

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const rooms = new Rooms();

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function wsSend(ws, msg) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    const json = JSON.stringify(msg);
    ws.send(json);
  } catch (err) {
    console.error("Failed to send WebSocket message:", err.message);
  }
}

wss.on("connection", (ws) => {
  const client = rooms.createClient(ws);

  ws.on("message", (raw) => {
    const msg = safeJsonParse(String(raw));
    if (!msg || typeof msg.type !== "string") return;

    try {
      rooms.handleClientMessage(client, msg);
    } catch (err) {
      wsSend(ws, { type: "error", message: err?.message || "Unknown error" });
    }
  });

  ws.on("close", () => {
    rooms.removeClient(client);
  });

  ws.on("error", () => {
    rooms.removeClient(client);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use.\n` +
        `Try:\n` +
        `  PORT=3001 npm start\n` +
        `or stop the process using port ${PORT}.`
    );
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
