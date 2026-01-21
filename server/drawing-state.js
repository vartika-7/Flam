function nowMs() {
  return Date.now();
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizePoint(p) {
  return {
    x: clamp(Number(p?.x ?? 0), -1e6, 1e6),
    y: clamp(Number(p?.y ?? 0), -1e6, 1e6),
    t: Number(p?.t ?? nowMs()),
    p: clamp(Number(p?.p ?? 0.5), 0, 1)
  };
}

class DrawingState {
  constructor(seed) {
    this.strokesById = new Map();
    this.timeline = [];
    this.undoneStrokeIds = new Set();
    this._seq = 0;

    if (seed) {
      this._hydrate(seed);
    }
  }

  nextSeq() {
    this._seq += 1;
    return this._seq;
  }

  addStroke(stroke) {
    if (!stroke || typeof stroke.id !== "string") throw new Error("Invalid stroke");
    if (this.strokesById.has(stroke.id)) return;

    const normalized = {
      id: stroke.id,
      userId: String(stroke.userId || "unknown"),
      tool: String(stroke.tool || "brush"),
      color: String(stroke.color || "#111111"),
      width: clamp(Number(stroke.width || 4), 1, 80),
      points: Array.isArray(stroke.points) ? stroke.points.map(normalizePoint) : [],
      createdAt: nowMs()
    };
    
    if (stroke.shape && (stroke.tool === "rect" || stroke.tool === "circle")) {
      normalized.shape = stroke.shape;
    }
    
    if (stroke.tool === "text" && stroke.text) {
      normalized.text = String(stroke.text);
      normalized.x = Number(stroke.x) || 0;
      normalized.y = Number(stroke.y) || 0;
      normalized.fontSize = Number(stroke.fontSize) || 24;
    }
    
    if (stroke.tool === "image" && stroke.imageData) {
      normalized.imageData = String(stroke.imageData);
      normalized.x = Number(stroke.x) || 0;
      normalized.y = Number(stroke.y) || 0;
      normalized.width = Number(stroke.width) || 100;
      normalized.height = Number(stroke.height) || 100;
    }

    this.strokesById.set(normalized.id, normalized);
    this.undoneStrokeIds.delete(normalized.id);

    const op = {
      type: "STROKE_COMMIT",
      seq: this.nextSeq(),
      at: nowMs(),
      strokeId: normalized.id,
      userId: normalized.userId
    };
    this.timeline.push(op);
    return { op, stroke: normalized };
  }

  undo(userId) {
    for (let i = this.timeline.length - 1; i >= 0; i -= 1) {
      const op = this.timeline[i];
      if (op.type !== "STROKE_COMMIT") continue;
      const sid = op.strokeId;
      if (!this.strokesById.has(sid)) continue;
      if (this.undoneStrokeIds.has(sid)) continue;

      this.undoneStrokeIds.add(sid);
      const undoOp = {
        type: "UNDO",
        seq: this.nextSeq(),
        at: nowMs(),
        by: String(userId || "unknown"),
        strokeId: sid
      };
      this.timeline.push(undoOp);
      return undoOp;
    }
    return null;
  }

  redo(userId) {
    for (let i = this.timeline.length - 1; i >= 0; i -= 1) {
      const op = this.timeline[i];
      if (op.type !== "UNDO") continue;
      const sid = op.strokeId;
      if (!this.strokesById.has(sid)) continue;
      if (!this.undoneStrokeIds.has(sid)) continue;

      this.undoneStrokeIds.delete(sid);
      const redoOp = {
        type: "REDO",
        seq: this.nextSeq(),
        at: nowMs(),
        by: String(userId || "unknown"),
        strokeId: sid
      };
      this.timeline.push(redoOp);
      return redoOp;
    }
    return null;
  }

  snapshot() {
    const strokes = [];
    for (const stroke of this.strokesById.values()) {
      if (this.undoneStrokeIds.has(stroke.id)) continue;
      strokes.push(stroke);
    }
    return {
      seq: this._seq,
      strokes
    };
  }

  toJSON() {
    return {
      seq: this._seq,
      timeline: this.timeline,
      strokes: Array.from(this.strokesById.values()),
      undone: Array.from(this.undoneStrokeIds)
    };
  }

  _hydrate(data) {
    this._seq = Number(data.seq || 0);
    if (Array.isArray(data.timeline)) this.timeline = data.timeline;
    if (Array.isArray(data.undone)) this.undoneStrokeIds = new Set(data.undone);
    if (Array.isArray(data.strokes)) {
      for (const s of data.strokes) {
        if (s && s.id) this.strokesById.set(s.id, s);
      }
    }
  }
}

module.exports = { DrawingState };

