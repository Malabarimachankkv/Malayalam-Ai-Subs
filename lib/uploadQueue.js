const crypto = require("crypto");
const b2 = require("./b2Storage");

// Was an in-memory Map — moved to B2 so entries survive a Render restart
// (free tier spins down after ~15 min idle, which was silently wiping
// anything still sitting in the queue). Each entry is two objects in the
// bucket under its own prefix: a small JSON metadata file (filename, note,
// status, etc.) and the translated .srt itself, both keyed by the same id.
const PREFIX = "ai-subs-queue/";

function metaKey(id) {
  return `${PREFIX}${id}.json`;
}
function srtKey(id) {
  return `${PREFIX}${id}.srt`;
}

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
  const meta = {
    id,
    originalFilename,
    lineCount,
    note: note || "",
    status: "pending", // pending | approved | rejected
    createdAt: Date.now(),
  };

  await b2.putObject(srtKey(id), Buffer.from(translatedSrt, "utf8"), "text/plain; charset=utf-8");
  await b2.putObject(metaKey(id), Buffer.from(JSON.stringify(meta), "utf8"), "application/json");
  return id;
}

async function list() {
  const files = await b2.listObjects(PREFIX);
  const metaFiles = files.filter((f) => f.fileName.endsWith(".json"));

  const items = await Promise.all(
    metaFiles.map(async (f) => {
      const buf = await b2.getObject(f.fileName);
      return buf ? JSON.parse(buf.toString("utf8")) : null;
    })
  );

  return items.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

async function get(id) {
  const metaBuf = await b2.getObject(metaKey(id));
  if (!metaBuf) return null;
  const meta = JSON.parse(metaBuf.toString("utf8"));

  const srtBuf = await b2.getObject(srtKey(id));
  return { ...meta, translatedSrt: srtBuf ? srtBuf.toString("utf8") : "" };
}

async function setStatus(id, status) {
  const metaBuf = await b2.getObject(metaKey(id));
  if (!metaBuf) return null;
  const meta = JSON.parse(metaBuf.toString("utf8"));
  meta.status = status;
  await b2.putObject(metaKey(id), Buffer.from(JSON.stringify(meta), "utf8"), "application/json");
  return meta;
}

module.exports = { add, list, get, setStatus };
