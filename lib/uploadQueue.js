const crypto = require("crypto");

// In-memory only, same tradeoff as lib/cache.js: fast and zero-config while
// the server is up, cleared on restart (Render free tier spins down when
// idle). That's fine for now — this is a *review* queue, not long-term
// storage. Once you've decided how approved translations should reach the
// main addon, that's the point to add somewhere durable if items need to
// survive a restart before someone gets to them.
const queue = new Map();

/**
 * @param {object} entry
 * @param {string} entry.originalFilename
 * @param {string} entry.translatedSrt
 * @param {number} entry.lineCount
 * @param {string} [entry.note] - optional context from the uploader (e.g. movie title)
 * @returns {string} id
 */
function add({ originalFilename, translatedSrt, lineCount, note }) {
  const id = crypto.randomBytes(6).toString("hex");
  queue.set(id, {
    id,
    originalFilename,
    translatedSrt,
    lineCount,
    note: note || "",
    status: "pending", // pending | approved | rejected
    createdAt: Date.now(),
  });
  return id;
}

function list() {
  return [...queue.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function get(id) {
  return queue.get(id) || null;
}

function setStatus(id, status) {
  const entry = queue.get(id);
  if (!entry) return null;
  entry.status = status;
  return entry;
}

module.exports = { add, list, get, setStatus };
