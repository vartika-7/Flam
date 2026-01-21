# Real-Time Collaborative Drawing Canvas

Multi-user drawing app built with Node.js + native WebSockets + Canvas API.

## Setup
```bash
npm install
npm start
```
Then open `http://localhost:3000` in your browser.

## Demo link: 
[Deployed Link](https://flam-hgg9.onrender.com)
[Video](https://drive.google.com/file/d/1tXoLW9fPyrANzrbaExrQ9QWdF_kJFVQJ/view?usp=sharing)


## Test with multiple users
- Open the same URL in 2+ browser windows or an incognito window.
- Keep the same Roomvalue to collaborate.
- Draw simultaneously: you should see live in-progress strokes and cursor indicators.

## Features
- Tools: brush + eraser + some shapes
- Style controls: color + width
- Real-time sync: streams points while drawing
- Presence: online user list + user colors
- User indicators: remote cursor dots + labels
- Global undo/redo: affects the entire room history (not just “my” strokes)

## Known limitations / tradeoffs
- **Authorization**: No login authorization as of now.
- **Undo/redo redraw cost**: undo/redo triggers a full canvas redraw.
- **No persistence**: room state is in-memory; refreshes work (snapshot), but server restart resets.
- **Eraser model**: eraser is implemented via `destination-out` compositing.
- **Bandwidth**: points are throttled to animation frames; still can be heavy with many users.

## Time spent
- 2 days

