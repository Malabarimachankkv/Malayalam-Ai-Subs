const express = require("express");
const path = require("path");
const { encodeConfig, decodeConfig } = require("./lib/config");
const { fetchEnglishSrt } = require("./lib/subtitleSource");
const { translateEntries } = require("./lib/translate");
const { parseSrt, buildSrt } = require("./lib/srt");
const { getCached, putCached } = require("./lib/cache");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-flight translation dedup: if two requests hit the same untranslated movie
// at once, don't run Gemini twice - the second request waits on the first.
const inFlight = new Map();

app.get("/configure", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "configure.html"));
});

// Root redirects to configure page - this is what Stremio shows as "Configure" link
app.get("/", (req, res) => res.redirect("/configure"));

app.get("/:config/manifest.json", (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg) return res.status(400).json({ error: "Invalid or missing config - reinstall via /configure" });

  res.json({
    id: "community.malayalamaisubs",
    version: "1.0.0",
    name: "Malayalam AI Subs",
    description: "Auto-translates English subtitles to Malayalam using your own free Gemini API key",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false },
  });
});

function subtitleKey(imdbId, season, episode) {
  const suffix = season && episode ? `-s${season}e${episode}` : "";
  return `${imdbId}${suffix}`;
}

app.get("/:config/subtitles/:type/:id.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg) return res.status(400).json({ error: "Invalid config" });

  try {
    // id format: tt1234567 or tt1234567:season:episode
    const [imdbId, season, episode] = req.params.id.split(":");
    const identity = { imdbId, season, episode };

    let srt = await getCached(identity);

    if (!srt) {
      const lockKey = subtitleKey(imdbId, season, episode);
      if (!inFlight.has(lockKey)) {
        inFlight.set(
          lockKey,
          translateAndCache(cfg.geminiKey, identity).finally(() => inFlight.delete(lockKey))
        );
      }
      srt = await inFlight.get(lockKey);
    }

    const host = `${req.protocol}://${req.get("host")}`;
    const key = subtitleKey(imdbId, season, episode);
    const url = `${host}/subs/${encodeURIComponent(key)}.srt`;

    res.json({ subtitles: [{ id: `ml-ai-${imdbId}`, lang: "mal", url }] });
  } catch (e) {
    console.error("Subtitle request failed:", e.message);
    res.json({ subtitles: [] }); // fail soft - Stremio just shows no subtitle
  }
});

// Serves the actual translated subtitle file - the URL returned above points here
app.get("/subs/:key.srt", async (req, res) => {
  const srt = await getCached({ imdbId: req.params.key }); // key already includes season/episode suffix if any
  if (!srt) return res.status(404).send("Subtitle not found or expired from cache - replay the title to regenerate it");
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.send(srt);
});

async function translateAndCache(geminiKey, identity) {
  const englishSrt = await fetchEnglishSrt(identity);
  const entries = parseSrt(englishSrt);
  const translated = await translateEntries(geminiKey, entries, {
    onProgress: (done, total) => console.log(`${identity.imdbId}: translated chunk ${done}/${total}`),
  });
  const malayalamSrt = buildSrt(translated);
  return putCached(identity, malayalamSrt);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Malayalam AI Subs running on port ${PORT}`));

module.exports = { encodeConfig }; // exported for reference/testing
