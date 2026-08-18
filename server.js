const express = require("express");
const path = require("path");
const multer = require("multer");
const { translateEntries } = require("./lib/translate");
const { parseSrt, buildSrt } = require("./lib/srt");
const uploadQueue = require("./lib/uploadQueue");
const { requireAdminAuth } = require("./lib/adminAuth");

// Subtitle files are small text — 2MB is generous headroom over even a very
// long movie's .srt, and keeps someone from accidentally uploading a video
// file into a memory-only store.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/configure", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "configure.html"));
});

app.get("/", (req, res) => res.redirect("/configure"));

// --- Upload & translate ---------------------------------------------------
// Someone uploads an English .srt they already have — wherever it came
// from — pastes their own Gemini key, and gets it back translated to
// Malayalam. Runs synchronously (the visitor is on the page waiting); a
// very long movie under a strict free-tier rate limit could take several
// minutes — the page says so up front.
app.post("/api/translate-upload", upload.single("file"), async (req, res) => {
  try {
    const geminiKey = (req.body.geminiKey || "").trim();
    const imdbId = (req.body.imdbId || "").trim();
    if (!geminiKey) return res.status(400).json({ error: "Missing Gemini API key." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    if (!/^tt\d{5,9}$/i.test(imdbId)) {
      return res.status(400).json({ error: 'IMDb ID looks wrong — expected a format like "tt1234567".' });
    }

    const text = req.file.buffer.toString("utf8");
    const entries = parseSrt(text);
    if (!entries.length) {
      return res.status(400).json({ error: "Couldn't find any subtitle lines in that file — is it a valid .srt?" });
    }

    const translated = await translateEntries(geminiKey, entries);
    const translatedSrt = buildSrt(translated);

    const id = await uploadQueue.add({
      imdbId: imdbId.toLowerCase(),
      originalFilename: req.file.originalname,
      translatedSrt,
      lineCount: entries.length,
      note: (req.body.note || "").trim(),
    });

    res.json({ id, filename: req.file.originalname.replace(/\.[^.]+$/, "") + ".ml.srt", srt: translatedSrt });
  } catch (err) {
    console.error("Upload translate failed:", err.message);
    res.status(500).json({ error: err.message || "Translation failed." });
  }
});

// Public, unauthenticated, scoped only to the id just returned above (a
// random 12-char token, not guessable/listable) — this is what the page
// actually downloads from. Deliberately a real server URL rather than a
// client-side blob: URL: some in-app browsers (Facebook/Instagram's
// WebView is the one that's actually been reported) block or mishandle
// blob: downloads and show a generic "Page can't be loaded" error, but
// they handle a normal https download with Content-Disposition fine.
app.get("/api/translate-upload/:id/download", async (req, res) => {
  try {
    const item = await uploadQueue.get(req.params.id);
    if (!item) return res.status(404).send("Not found.");
    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${item.originalFilename.replace(/\.[^.]+$/, "")}.ml.srt"`);
    res.send(item.translatedSrt);
  } catch (err) {
    console.error("Download failed:", err.message);
    res.status(500).send(err.message || "Download failed.");
  }
});

// --- Review queue (admin-only) --------------------------------------------

app.get("/admin/queue", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-queue.html"));
});

app.get("/api/queue", requireAdminAuth, async (req, res) => {
  try {
    const items = await uploadQueue.list();
    res.json(items.map(({ translatedSrt, ...meta }) => meta)); // list view skips the full text
  } catch (err) {
    console.error("Queue list failed:", err.message);
    res.status(500).json({ error: err.message || "Couldn't load the queue." });
  }
});

app.get("/api/queue/:id/download", requireAdminAuth, async (req, res) => {
  try {
    const item = await uploadQueue.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found." });
    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${item.originalFilename.replace(/\.[^.]+$/, "")}.ml.srt"`);
    res.send(item.translatedSrt);
  } catch (err) {
    console.error("Queue download failed:", err.message);
    res.status(500).json({ error: err.message || "Download failed." });
  }
});

app.post("/api/queue/:id/status", requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "status must be approved, rejected, or pending" });
    }
    const item = await uploadQueue.setStatus(req.params.id, status);
    if (!item) return res.status(404).json({ error: "Not found." });
    res.json({ id: item.id, status: item.status });
  } catch (err) {
    console.error("Status update failed:", err.message);
    res.status(500).json({ error: err.message || "Status update failed." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Malayalam AI Subs running on port ${PORT}`));
