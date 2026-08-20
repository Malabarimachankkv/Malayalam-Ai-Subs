const crypto = require("crypto");

// In-memory only — no B2, no database. Fast and zero-config while the
// server is up; cleared on restart (Render free tier spins down when
// idle). If an entry matters, download/approve it before that happens —
// there's no durable backing store anymore to recover it from otherwise.
const queue = new Map();

/**
 * @param {object} entry
 * @param {string} entry.originalFilename
 * @param {string} entry.translatedSrt
 * @param {number} entry.lineCount
 * @param {string} [entry.note]
 * @returns {Promise<string>} id
 */
async function add({ originalFilename, translatedSrt, lineCount, note }) {
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

async function list() {
  return [...queue.values()].sort((a, b) => b.createdAt - a.createdAt);
}

async function get(id) {
  return queue.get(id) || null;
}

async function setStatus(id, status) {
  const entry = queue.get(id);
  if (!entry) return null;
  entry.status = status;
  return entry;
}

module.exports = { add, list, get, setStatus };
