function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function setStrokeStyle(ctx, stroke) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.width;

  if (stroke.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
  }
}

function drawSmoothPath(ctx, points) {
  if (!points.length) return;
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i += 1) {
    const m = mid(points[i], points[i + 1]);
    ctx.quadraticCurveTo(points[i].x, points[i].y, m.x, m.y);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

export class CanvasEngine {
  constructor({ baseCanvas, liveCanvas }) {
    this.baseCanvas = baseCanvas;
    this.liveCanvas = liveCanvas;
    this.baseCtx = baseCanvas.getContext("2d", { alpha: true });
    this.liveCtx = liveCanvas.getContext("2d", { alpha: true });

    this.dpr = window.devicePixelRatio || 1;
    this.width = 0;
    this.height = 0;

    this.strokesById = new Map();
    this.undone = new Set();
    this.remoteLive = new Map();
  }

  resizeTo(element) {
    const rect = element.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.width = w;
    this.height = h;
    this.dpr = window.devicePixelRatio || 1;

    for (const c of [this.baseCanvas, this.liveCanvas]) {
      c.width = Math.floor(w * this.dpr);
      c.height = Math.floor(h * this.dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      const ctx = c === this.baseCanvas ? this.baseCtx : this.liveCtx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    this.redrawAll();
  }

  toCanvasPoint(clientX, clientY) {
    const rect = this.baseCanvas.getBoundingClientRect();
    return {
      x: clamp(clientX - rect.left, 0, rect.width),
      y: clamp(clientY - rect.top, 0, rect.height)
    };
  }

  clearLive() {
    this.liveCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.liveCtx.clearRect(0, 0, this.width, this.height);
  }

  redrawAll() {
    this.baseCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.baseCtx.clearRect(0, 0, this.width, this.height);
    for (const stroke of this.strokesById.values()) {
      if (this.undone.has(stroke.id)) continue;
      this._drawStroke(this.baseCtx, stroke);
    }
    this.clearLive();
    for (const live of this.remoteLive.values()) {
      this._drawStroke(this.liveCtx, { ...live.stroke, points: live.points });
    }
  }

  _drawStroke(ctx, stroke) {
    ctx.save();
    
    if (stroke.tool === "rect" && stroke.shape) {
      this._drawRect(ctx, stroke);
    } else if (stroke.tool === "circle" && stroke.shape) {
      this._drawCircle(ctx, stroke);
    } else if (stroke.tool === "text" && stroke.text) {
      this._drawText(ctx, stroke);
    } else if (stroke.tool === "image" && stroke.imageData) {
      this._drawImage(ctx, stroke);
    } else {
      setStrokeStyle(ctx, stroke);
      drawSmoothPath(ctx, stroke.points || []);
    }
    
    ctx.restore();
  }

  _drawRect(ctx, stroke) {
    const { x, y, width, height } = stroke.shape;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeRect(x, y, width, height);
  }

  _drawCircle(ctx, stroke) {
    const { x, y, radius } = stroke.shape;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  _drawText(ctx, stroke) {
    const { x, y, text, fontSize = 24 } = stroke;
    ctx.fillStyle = stroke.color;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillText(text, x, y);
  }

  _drawImage(ctx, stroke) {
    const { x, y, width, height, imageData } = stroke;
    if (!imageData) return;
    const img = new Image();
    img.onload = () => {
      try {
        ctx.drawImage(img, x, y, width, height);
      } catch (err) {
      }
    };
    img.onerror = () => {
    };
    img.src = imageData;
    if (img.complete && img.naturalWidth > 0) {
      try {
        ctx.drawImage(img, x, y, width, height);
      } catch {
      }
    }
  }

  applySnapshot(snapshot) {
    this.strokesById.clear();
    this.undone.clear();
    for (const s of snapshot?.strokes || []) this.strokesById.set(s.id, s);
    this.redrawAll();
  }

  commitStroke(stroke) {
    if (!stroke || !stroke.id) return;
    if (this.strokesById.has(stroke.id)) return;
    this.strokesById.set(stroke.id, stroke);
    this.undone.delete(stroke.id);
    this._drawStroke(this.baseCtx, stroke);
  }

  applyUndo(strokeId) {
    if (!strokeId) return;
    this.undone.add(strokeId);
    this.redrawAll();
  }

  applyRedo(strokeId) {
    if (!strokeId) return;
    this.undone.delete(strokeId);
    this.redrawAll();
  }

  remoteBegin({ userId, strokeId, tool, color, width, point }) {
    if (!userId || !strokeId || !point) return;
    this.remoteLive.set(userId, {
      strokeId,
      stroke: { id: strokeId, userId, tool, color, width, points: [] },
      points: [point]
    });
  }

  remotePoint({ userId, strokeId, point }) {
    const live = this.remoteLive.get(userId);
    if (!live || live.strokeId !== strokeId) return;
    live.points.push(point);
    this.clearLive();
    for (const l of this.remoteLive.values()) {
      this._drawStroke(this.liveCtx, { ...l.stroke, points: l.points });
    }
  }

  remoteEnd({ userId, strokeId }) {
    const live = this.remoteLive.get(userId);
    if (!live || live.strokeId !== strokeId) return;
    this.remoteLive.delete(userId);
    this.clearLive();
    for (const l of this.remoteLive.values()) {
      this._drawStroke(this.liveCtx, { ...l.stroke, points: l.points });
    }
  }
}

