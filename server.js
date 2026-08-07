const express = require("express");
const path = require("path");
const { encodeConfig, decodeConfig } = require("./lib/config");
const { fetchEnglishSrt } = require("./lib/subtitleSource");
const { translateEntries } = require("./lib/translate");
const { parseSrt, buildSrt, startSeconds } = require("./lib/srt");
const { getCached, putCached } = require("./lib/cache");

function formatSrtTime(totalSeconds) {
  const t = Math.max(0, totalSeconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// Builds a subtitle file that is ALWAYS entirely in Malayalam: real
// translated cues for everything finished so far, plus - if the movie isn't
// fully translated yet - a single honest cue in Malayalam covering the rest
// of the runtime. Never falls back to raw English; showing English would
// defeat the point of this addon for viewers who don't read English.
function buildLiveSrt(translatedSoFar, allEntries, progressLabel) {
  if (translatedSoFar.length >= allEntries.length) {
    return buildSrt(translatedSoFar);
  }

  const nextUntranslated = allEntries[translatedSoFar.length];
  const startAt = translatedSoFar.length > 0 ? startSeconds(nextUntranslated) : 0;

  const cue = {
    timing: `${formatSrtTime(startAt)} --> 09:59:59,000`,
    text:
      `ബാക്കി ഭാഗം മലയാളത്തിലേക്ക് പരിഭാഷപ്പെടുത്തിക്കൊണ്ടിരിക്കുന്നു${progressLabel ? ` (${progressLabel})` : ""}. ` +
      "അല്പസമയത്തിനു ശേഷം വീഡിയോ പോസ് ചെയ്ത്, ഈ സബ്‌ടൈറ്റിൽ ട്രാക്ക് വീണ്ടും തിരഞ്ഞെടുക്കുക.",
  };

  return buildSrt(translatedSoFar.concat([cue]));
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-flight translation dedup: if two requests hit the same untranslated movie
// at once, don't run Gemini twice - the second request waits on the first.
const inFlight = new Map();

// Real progress per in-flight translation, so the placeholder subtitle can
// show honest status instead of a made-up "1-2 minutes" that's wildly wrong
// once free-tier rate limiting kicks in (can genuinely take 10-20+ minutes
// for a long movie under a strict per-key rate limit).
const progress = new Map(); // key -> { done, total, startedAt }

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

  const [imdbId, season, episode] = req.params.id.split(":");
  const identity = { imdbId, season, episode };
  const key = subtitleKey(imdbId, season, episode);

  // Kick off translation in the background if it isn't already cached or
  // running - but DO NOT wait on it here. The subtitle option should show
  // up in the player instantly, every time, so nobody assumes Malayalam
  // isn't supported. If it's picked before translation finishes, the file
  // it points to will show a short "translating, check back in a minute"
  // cue instead of silently not existing.
  const alreadyCached = await getCached(identity);
  if (!alreadyCached && !inFlight.has(key)) {
    progress.set(key, { done: 0, total: null, startedAt: Date.now() });
    inFlight.set(
      key,
      translateAndCache(cfg.geminiKey, identity, key)
        .catch((e) => console.error(`Translation failed for ${key}:`, e.message))
        .finally(() => {
          inFlight.delete(key);
          progress.delete(key);
        })
    );
  }

  const host = `${req.protocol}://${req.get("host")}`;
  const url = `${host}/subs/${encodeURIComponent(key)}.srt`;
  res.json({ subtitles: [{ id: `ml-ai-${imdbId}`, lang: "mal", url }] });
});

function placeholderSrt(key) {
  const p = progress.get(key);

  let status;
  if (!p || p.done === 0) {
    status =
      "മലയാളം സബ്‌ടൈറ്റിൽ തയ്യാറാക്കിക്കൊണ്ടിരിക്കുന്നു. ആദ്യഭാഗം തയ്യാറാകാൻ ഒന്നു രണ്ടു മിനിറ്റ് എടുത്തേക്കാം. " +
      "നീണ്ട സിനിമകൾക്ക്, API നിരക്ക് പരിധി അനുസരിച്ച് ഇത് 10-20 മിനിറ്റ് വരെയും എടുക്കാം - ദയവായി കാത്തിരിക്കുക.";
  } else {
    const elapsedMs = Date.now() - p.startedAt;
    const avgPerChunkMs = elapsedMs / p.done;
    const remaining = p.total ? Math.max(p.total - p.done, 0) : null;
    const etaMin = remaining !== null ? Math.max(1, Math.round((avgPerChunkMs * remaining) / 60000)) : null;
    const totalLabel = p.total || "?";
    status =
      `മലയാളം സബ്‌ടൈറ്റിൽ തയ്യാറാക്കിക്കൊണ്ടിരിക്കുന്നു: ഭാഗം ${p.done}/${totalLabel} പൂർത്തിയായി.` +
      (etaMin !== null ? ` ഏകദേശം ${etaMin} മിനിറ്റ് കൂടി എടുത്തേക്കാം.` : "") +
      " അല്പസമയത്തിനു ശേഷം വീഡിയോ പോസ് ചെയ്ത്, ഈ സബ്‌ടൈറ്റിൽ ട്രാക്ക് വീണ്ടും തിരഞ്ഞെടുക്കുക.";
  }

  return `1\n00:00:00,000 --> 09:59:59,000\n${status}\n`;
}

// Serves the actual translated subtitle file - the URL returned above points here
app.get("/subs/:key.srt", async (req, res) => {
  const key = req.params.key; // already includes season/episode suffix if any
  const srt = await getCached({ imdbId: key });

  res.set("Content-Type", "text/plain; charset=utf-8");
  // Ask clients not to cache this response - a few Stremio-based clients do
  // respect this and will silently re-fetch; most won't, hence the
  // reselect-to-refresh instruction, but it doesn't hurt to ask.
  res.set("Cache-Control", "no-cache, no-store");

  if (srt) return res.send(srt);
  if (inFlight.has(key)) return res.send(placeholderSrt(key));
  res.status(404).send("Subtitle not found - open the title again to regenerate it");
});

async function translateAndCache(geminiKey, identity, key) {
  const englishSrt = await fetchEnglishSrt(identity);
  const entries = parseSrt(englishSrt);

  const translated = await translateEntries(geminiKey, entries, {
    onProgress: (done, total, translatedSoFar) => {
      console.log(`${identity.imdbId}: chunk ${done}/${total}`);
      const p = progress.get(key);
      if (p) {
        p.done = done;
        p.total = total;
      }
      // Upgrade the cache in place: everything translated so far is real
      // Malayalam; anything left is represented by an honest Malayalam
      // "still translating" cue - never English filler.
      putCached(identity, buildLiveSrt(translatedSoFar, entries, `${done}/${total}`)).catch(() => {});
    },
  });

  const malayalamSrt = buildSrt(translated);
  return putCached(identity, malayalamSrt);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Malayalam AI Subs running on port ${PORT}`));

module.exports = { encodeConfig }; // exported for reference/testing
