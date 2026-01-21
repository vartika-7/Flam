const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data", "rooms");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function roomFile(roomId) {
  return path.join(DATA_DIR, `${roomId}.json`);
}

function saveRoom(roomId, state) {
  try {
    ensureDir();
    const file = roomFile(roomId);
    const payload = JSON.stringify(state.toJSON());
    fs.writeFileSync(file, payload, "utf8");
  } catch (err) {
    console.error(`Failed to save room ${roomId}:`, err.message);
  }
}

function loadRoom(roomId) {
  try {
    const file = roomFile(roomId);
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.error(`Failed to load room ${roomId}:`, err);
    }
    return null;
  }
}

module.exports = { saveRoom, loadRoom };

