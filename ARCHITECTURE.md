# ARCHITECTURE

## Data Flow
### DFD LEVEL-0 (Context Diagram):
<img width="814" height="275" alt="Screenshot 2026-01-21 at 23 27 43" src="https://github.com/user-attachments/assets/1352fe1f-74fe-4a9b-9c41-c0da4967906d" />

### DFD LEVEL-1 (Detailed Diagram):
<img width="1097" height="507" alt="Screenshot 2026-01-21 at 23 24 39" src="https://github.com/user-attachments/assets/28be950e-38fa-4432-8618-e562fd72e077" />

1. **User draws locally**
   - Client collects pointer points and **renders immediately** .
2. **Client streams events over WebSocket**
   - `stroke:begin` once
   - `stroke:point` batched (RAF throttled)
   - `stroke:end` with final point list (commit intent)
3. **Server broadcasts streaming events**
   - Other clients render the in-progress stroke on their **live overlay** canvas.
4. **Server appends authoritative history**
   - On `stroke:end`, server stores the stroke and appends a `STROKE_COMMIT` operation.
   - Server broadcasts `stroke:commit` so everyone converges.

## Data Flow (presence + cursors)

- Clients join with `room:join`
- Server responds with:
  - `room:joined` (me + users + snapshot)
  - `presence:list` updates on joins/leaves
- Clients stream `cursor` events (RAF throttled); server broadcasts them to others.

## WebSocket Protocol

### Client → Server

- `room:join`:
  - `{ type, roomId, name }`
- `cursor`:
  - `{ type, x, y }`
- `stroke:begin`:
  - `{ type, strokeId, tool, color, width, point }`
- `stroke:point`:
  - `{ type, strokeId, points: Point[] }`
- `stroke:end`:
  - `{ type, strokeId, tool, color, width, points: Point[] }`
- `history:undo` / `history:redo`:
  - `{ type }`
- `ping`:
  - `{ type, at }`

### Server → Client

- `hello`:
  - `{ type, userId }`
- `room:joined`:
  - `{ type, roomId, me, users, snapshot }`
- `presence:list` / `presence:join` / `presence:leave`
- `cursor`
- Streaming:
  - `stroke:begin`, `stroke:point`, `stroke:end` (passthrough for real-time feel)
- Authoritative:
  - `stroke:commit` (idempotent)
  - `history:undo` / `history:redo` with `{ op: { strokeId, seq, ... } }`
- `pong`

### Point shape
`Point = { x: number, y: number, t: number, p?: number }`

## Undo/Redo Strategy (global)

**Server is authoritative** for history. The room keeps:
- `strokesById`: committed strokes
- `timeline`: operations appended in server order
- `undoneStrokeIds`: a derived set updated incrementally

Operations:
- `STROKE_COMMIT(strokeId)`: adds a new visible stroke
- `UNDO(strokeId)`: marks the most recent visible committed stroke as undone
- `REDO(strokeId)`: re-applies the most recently undone stroke

### “User A undoes User B” behavior
Undo is **global**, so it simply undoes the latest visible stroke regardless of author. That’s intentional and consistent with “global undo/redo” requirements.
Clients apply undo/redo by **redrawing** from the committed set excluding `undoneStrokeIds`.

## Conflict Resolution

Two users drawing in the same area is not a “merge” problem: both strokes exist.
- **Total order**: server append order (a single room timeline).
- **Rendering**: strokes replay in that order; later strokes naturally appear “on top”.
Undo/redo also follows that same order, so every client converges.

## Performance Decisions

- **Dual canvas layers**:
  - `baseCanvas`: committed strokes
  - `liveCanvas`: in-progress local + remote strokes
- **Event throttling**:
  - point streaming is batched with `requestAnimationFrame` to cap message rate
- **Smooth drawing**:
  - strokes are rendered using quadratic smoothing between midpoints
- **Redraw strategy**:
  - commits draw incrementally onto the base
  - undo/redo triggers a full redraw (correct baseline; can be optimized)

