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

// Stremio appends an optional extra segment with query-string-style params,
// e.g. /subtitles/movie/tt123/videoHash=abc123&videoSize=456.json - it's how
// the exact playing file's OpenSubtitles hash reaches the addon, when the
// stream source provides one.
app.get("/:config/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const cfg = decodeConfig(req.params.config);
  if (!cfg) return res.status(400).json({ error: "Invalid config" });

  try {
    // id format: tt1234567 or tt1234567:season:episode
    const [imdbId, season, episode] = req.params.id.split(":");

    const extraParams = new URLSearchParams(req.params.extra || "");
    const videoHash = extraParams.get("videoHash") || null;

    const identity = { imdbId, season, episode, videoHash };

    let url = await getCached(identity);

    if (!url) {
      const lockKey = videoHash || `${imdbId}:${season || ""}:${episode || ""}`;
      if (!inFlight.has(lockKey)) {
        inFlight.set(
          lockKey,
          translateAndCache(cfg.geminiKey, identity).finally(() => inFlight.delete(lockKey))
        );
      }
      url = await inFlight.get(lockKey);
    }

    res.json({ subtitles: [{ id: `ml-ai-${imdbId}`, lang: "mal", url }] });
  } catch (e) {
    console.error("Subtitle request failed:", e.message);
    res.json({ subtitles: [] }); // fail soft - Stremio just shows no subtitle
  }
});

async function translateAndCache(geminiKey, identity) {
  const { srt: englishSrt, matchedByHash } = await fetchEnglishSrt(identity);
  console.log(`${identity.imdbId}: source subtitle matched by ${matchedByHash ? "exact hash" : "IMDB search (approximate sync)"}`);

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
