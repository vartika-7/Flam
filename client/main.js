import { WSClient } from "./websocket.js";
import { CanvasEngine } from "./canvas.js";

function $(sel) {
  return document.querySelector(sel);
}

function makeStrokeId(userId) {
  return `${userId}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function rafThrottle(fn) {
  let scheduled = false;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...lastArgs);
    });
  };
}

function wsUrlFromLocation() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

const ui = {
  roomId: $("#roomId"),
  displayName: $("#displayName"),
  joinBtn: $("#joinBtn"),
  connState: $("#connState"),

  toolBrush: $("#toolBrush"),
  toolEraser: $("#toolEraser"),
  toolRect: $("#toolRect"),
  toolCircle: $("#toolCircle"),
  toolText: $("#toolText"),
  toolImage: $("#toolImage"),
  color: $("#color"),
  width: $("#width"),
  undoBtn: $("#undoBtn"),
  redoBtn: $("#redoBtn"),
  imageUpload: $("#imageUpload"),
  imageUploadContainer: $("#imageUploadContainer"),
  textInput: $("#textInput"),
  textInputContainer: $("#textInputContainer"),

  userList: $("#userList"),
  meLabel: $("#meLabel"),
  roomLabel: $("#roomLabel"),
  latencyLabel: $("#latencyLabel"),
  fpsLabel: $("#fpsLabel"),

  baseCanvas: $("#baseCanvas"),
  liveCanvas: $("#liveCanvas"),
  cursorLayer: $("#cursorLayer")
};

const engine = new CanvasEngine({ baseCanvas: ui.baseCanvas, liveCanvas: ui.liveCanvas });
const ws = new WSClient({ url: wsUrlFromLocation() });

let me = { userId: null, name: null, color: "#111111" };
let currentRoom = null;
let lastRoomId = null;
let lastName = null;

let tool = "brush";
let isDown = false;
let currentStrokeId = null;
let currentPoints = [];
let lastSentIdx = 0;
let shiftStraight = false;
let shapeStart = null;
let fps = 0;
let lastFpsUpdate = 0;
let frameCount = 0;

const cursors = new Map();

function setConnPill(state, kind, extra = "") {
  ui.connState.textContent = extra ? `${state} ${extra}` : state;
  ui.connState.classList.remove("ok", "warn", "bad", "connecting");
  ui.connState.classList.add(kind);
  ui.connState.title = `Connection: ${state}`;
}

function renderUsers(users) {
  ui.userList.innerHTML = "";
  for (const u of users || []) {
    const li = document.createElement("li");
    li.className = "userItem";
    const left = document.createElement("div");
    left.className = "userLeft";
    const sw = document.createElement("div");
    sw.className = "swatch";
    sw.style.background = u.color || "#999";
    const name = document.createElement("div");
    name.textContent = u.name || u.userId;
    left.appendChild(sw);
    left.appendChild(name);

    const right = document.createElement("div");
    right.className = "muted";
    right.textContent = u.userId === me.userId ? "You" : "";

    li.appendChild(left);
    li.appendChild(right);
    ui.userList.appendChild(li);
  }
}

function ensureCursor(userId, { name, color } = {}) {
  if (userId === me.userId) return null;
  let c = cursors.get(userId);
  if (c) return c;
  const el = document.createElement("div");
  el.className = "cursor";
  const label = document.createElement("div");
  label.className = "cursorLabel";
  label.textContent = name || userId;
  el.style.background = color || "#999";
  ui.cursorLayer.appendChild(el);
  ui.cursorLayer.appendChild(label);
  c = { el, labelEl: label, color: color || "#999", name: name || userId, lastAt: Date.now() };
  cursors.set(userId, c);
  return c;
}

function updateCursor(userId, x, y, meta) {
  const c = ensureCursor(userId, meta);
  if (!c) return;
  c.lastAt = Date.now();
  c.el.style.left = `${x}px`;
  c.el.style.top = `${y}px`;
  c.labelEl.style.left = `${x}px`;
  c.labelEl.style.top = `${y}px`;
  if (meta?.color) c.el.style.background = meta.color;
  if (meta?.name) c.labelEl.textContent = meta.name;
}

function gcCursors() {
  const now = Date.now();
  for (const [userId, c] of cursors.entries()) {
    if (now - c.lastAt < 3500) continue;
    c.el.remove();
    c.labelEl.remove();
    cursors.delete(userId);
  }
}

setInterval(gcCursors, 800);

function setTool(next) {
  tool = next;
  ui.toolBrush.classList.toggle("active", tool === "brush");
  ui.toolEraser.classList.toggle("active", tool === "eraser");
  ui.toolRect.classList.toggle("active", tool === "rect");
  ui.toolCircle.classList.toggle("active", tool === "circle");
  ui.toolText.classList.toggle("active", tool === "text");
  ui.toolImage.classList.toggle("active", tool === "image");
  
  ui.imageUploadContainer.style.display = tool === "image" ? "grid" : "none";
  ui.textInputContainer.style.display = tool === "text" ? "grid" : "none";
}

ui.toolBrush.addEventListener("click", () => setTool("brush"));
ui.toolEraser.addEventListener("click", () => setTool("eraser"));
ui.toolRect.addEventListener("click", () => setTool("rect"));
ui.toolCircle.addEventListener("click", () => setTool("circle"));
ui.toolText.addEventListener("click", () => setTool("text"));
ui.toolImage.addEventListener("click", () => setTool("image"));

ui.undoBtn.addEventListener("click", () => ws.send({ type: "history:undo" }));
ui.redoBtn.addEventListener("click", () => ws.send({ type: "history:redo" }));

function joinRoom() {
  const roomId = (ui.roomId.value || "lobby").trim();
  const name = (ui.displayName.value || "").trim();
  lastRoomId = roomId;
  lastName = name;
  if (ws.isOpen) {
    ws.send({ type: "room:join", roomId, name });
  } else {
    ws.send({ type: "room:join", roomId, name });
  }
}

function rejoinRoomIfNeeded() {
  if (lastRoomId && lastName && ws.isOpen && currentRoom !== lastRoomId) {
    ws.send({ type: "room:join", roomId: lastRoomId, name: lastName });
  }
}

ui.joinBtn.addEventListener("click", joinRoom);
ui.roomId.addEventListener("keydown", (e) => e.key === "Enter" && joinRoom());
ui.displayName.addEventListener("keydown", (e) => e.key === "Enter" && joinRoom());

function resize() {
  const stack = document.querySelector(".canvasStack");
  engine.resizeTo(stack);
}
window.addEventListener("resize", resize);
resize();

function pointFromEvent(ev) {
  const x = Number(ev.clientX) || 0;
  const y = Number(ev.clientY) || 0;
  const p = engine.toCanvasPoint(x, y);
  return { x: p.x, y: p.y, t: Date.now() };
}

function coalesceStraight(points) {
  if (!shiftStraight || points.length < 2) return points;
  const a = points[0];
  const b = points[points.length - 1];
  return [a, b];
}

function beginStroke(point) {
  if (!me.userId || !currentRoom) return;
  
  if (tool === "rect" || tool === "circle") {
    isDown = true;
    shapeStart = point;
    currentStrokeId = makeStrokeId(me.userId);
    return;
  }
  
  if (tool === "text") {
    const text = ui.textInput.value.trim();
    if (!text) return;
    currentStrokeId = makeStrokeId(me.userId);
    const stroke = {
      id: currentStrokeId,
      userId: me.userId,
      tool: "text",
      color: ui.color.value,
      x: point.x,
      y: point.y,
      text,
      fontSize: Number(ui.width.value) * 4
    };
    engine.commitStroke(stroke);
    ws.send({ type: "stroke:end", strokeId: currentStrokeId, ...stroke });
    ui.textInput.value = "";
    return;
  }
  
  isDown = true;
  currentStrokeId = makeStrokeId(me.userId);
  currentPoints = [point];
  lastSentIdx = 0;
  ws.send({
    type: "stroke:begin",
    strokeId: currentStrokeId,
    tool,
    color: ui.color.value,
    width: Number(ui.width.value),
    point
  });
}

const sendPointsThrottled = rafThrottle(() => {
  if (!isDown) return;
  if (!currentStrokeId) return;
  const pts = currentPoints.slice(lastSentIdx);
  if (!pts.length) return;
  lastSentIdx = currentPoints.length;
  ws.send({ type: "stroke:point", strokeId: currentStrokeId, points: pts });
});

function addPoint(point) {
  if (!isDown) return;
  
  if (tool === "rect" || tool === "circle") {
    engine.clearLive();
    const shape = tool === "rect"
      ? {
          x: Math.min(shapeStart.x, point.x),
          y: Math.min(shapeStart.y, point.y),
          width: Math.abs(point.x - shapeStart.x),
          height: Math.abs(point.y - shapeStart.y)
        }
      : {
          x: shapeStart.x,
          y: shapeStart.y,
          radius: Math.sqrt(
            Math.pow(point.x - shapeStart.x, 2) + Math.pow(point.y - shapeStart.y, 2)
          )
        };
    
    engine._drawStroke(engine.liveCtx, {
      id: currentStrokeId,
      userId: me.userId,
      tool,
      color: ui.color.value,
      width: Number(ui.width.value),
      shape
    });
    return;
  }
  
  const points = currentPoints;
  points.push(point);
  engine.clearLive();
  engine._drawStroke(engine.liveCtx, {
    id: currentStrokeId,
    userId: me.userId,
    tool,
    color: ui.color.value,
    width: Number(ui.width.value),
    points: coalesceStraight(points)
  });
  sendPointsThrottled();
}

function endStroke(point) {
  if (!isDown) return;
  isDown = false;
  if (!currentStrokeId) return;

  if (tool === "rect" || tool === "circle") {
    if (!shapeStart || !point) {
      shapeStart = null;
      engine.clearLive();
      return;
    }
    
    const shape = tool === "rect"
      ? {
          x: Math.min(shapeStart.x, point.x),
          y: Math.min(shapeStart.y, point.y),
          width: Math.abs(point.x - shapeStart.x),
          height: Math.abs(point.y - shapeStart.y)
        }
      : {
          x: shapeStart.x,
          y: shapeStart.y,
          radius: Math.sqrt(
            Math.pow(point.x - shapeStart.x, 2) + Math.pow(point.y - shapeStart.y, 2)
          )
        };
    
    engine.clearLive();
    const stroke = {
      id: currentStrokeId,
      userId: me.userId,
      tool,
      color: ui.color.value,
      width: Number(ui.width.value),
      shape
    };
    engine.commitStroke(stroke);
    ws.send({ type: "stroke:end", strokeId: currentStrokeId, ...stroke });
    
    currentStrokeId = null;
    shapeStart = null;
    return;
  }

  const finalPoints = coalesceStraight(currentPoints);

  engine.clearLive();
  engine.commitStroke({
    id: currentStrokeId,
    userId: me.userId,
    tool,
    color: ui.color.value,
    width: Number(ui.width.value),
    points: finalPoints
  });

  ws.send({
    type: "stroke:end",
    strokeId: currentStrokeId,
    tool,
    color: ui.color.value,
    width: Number(ui.width.value),
    points: finalPoints
  });

  currentStrokeId = null;
  currentPoints = [];
}

ui.liveCanvas.addEventListener("touchstart", (ev) => {
  ev.preventDefault();
}, { passive: false });

ui.liveCanvas.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  try {
    ui.liveCanvas.setPointerCapture(ev.pointerId);
  } catch (err) {
  }
  beginStroke(pointFromEvent(ev));
});

ui.liveCanvas.addEventListener("pointermove", (ev) => {
  const p = pointFromEvent(ev);
  if (isDown) {
    ev.preventDefault();
    addPoint(p);
  }
  sendCursor(p);
});

ui.liveCanvas.addEventListener("pointerup", (ev) => {
  ev.preventDefault();
  const p = pointFromEvent(ev);
  endStroke(p);
});

ui.liveCanvas.addEventListener("pointercancel", (ev) => {
  ev.preventDefault();
  endStroke(null);
});

ui.liveCanvas.addEventListener("pointerleave", (ev) => {
  if (isDown) {
    ev.preventDefault();
    endStroke(null);
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Shift") shiftStraight = true;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    ws.send({ type: "history:undo" });
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
    e.preventDefault();
    ws.send({ type: "history:redo" });
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") shiftStraight = false;
});

const sendCursor = rafThrottle((p) => {
  if (!me.userId || !currentRoom) return;
  ws.send({ type: "cursor", x: p.x, y: p.y });
});

ws.on("connectionState", ({ state, attempt, delay }) => {
  switch (state) {
    case "connecting":
      setConnPill("Connecting...", "connecting");
      break;
    case "reconnecting":
      setConnPill("Reconnecting...", "warn", attempt ? `(attempt ${attempt})` : "");
      break;
    case "connected":
      setConnPill("Connected", "ok");
      rejoinRoomIfNeeded();
      break;
    case "disconnected":
      setConnPill("Disconnected", "bad");
      break;
  }
});

ws.on("open", () => {
  setConnPill("Connected", "ok");
  rejoinRoomIfNeeded();
});

ws.on("close", ({ code, reason, wasClean }) => {
  if (wasClean && code === 1000) {
    setConnPill("Disconnected", "warn");
  } else {
    setConnPill("Connection lost", "bad");
  }
});

ws.on("error", () => {
  setConnPill("Error", "bad");
});

ws.on("connectionQuality", ({ quality, pongRatio, latency }) => {
  if (quality === "poor") {
    ui.connState.classList.add("bad");
    ui.connState.title = `Poor connection quality (${Math.round(pongRatio * 100)}% pongs received)`;
  } else if (quality === "degraded") {
    ui.connState.classList.add("warn");
    ui.connState.title = `Degraded connection (${latency || "?"}ms latency)`;
  }
});

ws.on("hello", (msg) => {
  me.userId = msg.userId;
  ui.meLabel.textContent = me.userId;
});

ws.on("room:joined", (msg) => {
  currentRoom = msg.roomId;
  me = msg.me;
  ui.meLabel.textContent = `${me.name} (${me.userId.slice(-4)})`;
  ui.roomLabel.textContent = currentRoom;
  ui.color.value = me.color;
  renderUsers(msg.users);
  engine.applySnapshot(msg.snapshot);
  if (isDown) {
    isDown = false;
    currentStrokeId = null;
    currentPoints = [];
    engine.clearLive();
  }
});

ws.on("presence:list", (msg) => {
  renderUsers(msg.users);
  for (const u of msg.users || []) ensureCursor(u.userId, u);
});

ws.on("presence:join", (msg) => {
  ensureCursor(msg.userId, msg);
});

ws.on("presence:leave", (msg) => {
  const c = cursors.get(msg.userId);
  if (c) {
    c.el.remove();
    c.labelEl.remove();
    cursors.delete(msg.userId);
  }
});

ws.on("cursor", (msg) => {
  const meta = { name: msg.name, color: msg.color };
  updateCursor(msg.userId, msg.x, msg.y, meta);
});

ws.on("stroke:begin", (msg) => {
  if (!msg.userId) return;
  engine.remoteBegin({
    userId: msg.userId,
    strokeId: msg.strokeId,
    tool: msg.tool,
    color: msg.color,
    width: msg.width,
    point: msg.point
  });
});

ws.on("stroke:point", (msg) => {
  if (!msg.userId) return;
  const pts = msg.points || [];
  for (const p of pts) {
    engine.remotePoint({ userId: msg.userId, strokeId: msg.strokeId, point: p });
  }
});

ws.on("stroke:end", (msg) => {
  if (!msg.userId) return;
  engine.remoteEnd({ userId: msg.userId, strokeId: msg.strokeId });
});

ws.on("stroke:commit", (msg) => {
  engine.commitStroke(msg.stroke);
});

ws.on("history:undo", (msg) => {
  engine.applyUndo(msg?.op?.strokeId);
});

ws.on("history:redo", (msg) => {
  engine.applyRedo(msg?.op?.strokeId);
});

ws.on("pong", (msg) => {
  ws.recordPong();
});

ws.on("latency", ({ latency }) => {
  if (Number.isFinite(latency)) {
    ui.latencyLabel.textContent = `${latency} ms`;
    const quality = ws.getConnectionQuality();
    if (!quality.isHealthy && latency > 500) {
      ui.connState.classList.add("warn");
    }
  }
});

ui.imageUpload.addEventListener("change", (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  
  if (!file.type.startsWith("image/")) {
    alert("Please select an image file");
    ev.target.value = "";
    return;
  }
  
  if (file.size > 5 * 1024 * 1024) {
    alert("Image too large. Please use an image smaller than 5MB");
    ev.target.value = "";
    return;
  }
  
  const reader = new FileReader();
  
  reader.onerror = () => {
    alert("Failed to read image file");
    ev.target.value = "";
  };
  
  reader.onload = (e) => {
    try {
      const img = new Image();
      
      img.onerror = () => {
        alert("Failed to load image");
        ev.target.value = "";
      };
      
      img.onload = () => {
        try {
          const maxWidth = 400;
          const maxHeight = 400;
          let { width, height } = img;
          
          if (width <= 0 || height <= 0) {
            throw new Error("Invalid image dimensions");
          }
          
          if (width > maxWidth || height > maxHeight) {
            const scale = Math.min(maxWidth / width, maxHeight / height);
            width = width * scale;
            height = height * scale;
          }
          
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            throw new Error("Canvas context not available");
          }
          
          ctx.drawImage(img, 0, 0, width, height);
          const imageData = canvas.toDataURL("image/png");
          
          if (!imageData || imageData === "data:,") {
            throw new Error("Failed to encode image");
          }
          
          const strokeId = makeStrokeId(me.userId);
          const point = engine.toCanvasPoint(
            engine.width / 2 - width / 2,
            engine.height / 2 - height / 2
          );
          
          const stroke = {
            id: strokeId,
            userId: me.userId,
            tool: "image",
            x: point.x,
            y: point.y,
            width,
            height,
            imageData
          };
          
          engine.commitStroke(stroke);
          ws.send({ type: "stroke:end", strokeId, ...stroke });
        } catch (err) {
          alert(`Failed to process image: ${err.message}`);
        } finally {
          ev.target.value = "";
        }
      };
      
      img.src = e.target.result;
    } catch (err) {
      alert(`Failed to load image: ${err.message}`);
      ev.target.value = "";
    }
  };
  
  reader.readAsDataURL(file);
});

function updateFPS() {
  frameCount++;
  const now = performance.now();
  if (now - lastFpsUpdate >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastFpsUpdate = now;
    ui.fpsLabel.textContent = `${fps} fps`;
  }
  requestAnimationFrame(updateFPS);
}
requestAnimationFrame(updateFPS);

ws.connect();
ui.roomId.value = "lobby";
ui.displayName.value = `Guest-${Math.random().toString(16).slice(2, 6)}`;
setTimeout(() => joinRoom(), 200);

