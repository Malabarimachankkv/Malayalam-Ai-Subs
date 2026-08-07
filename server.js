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
    inFlight.set(
      key,
      translateAndCache(cfg.geminiKey, identity)
        .catch((e) => console.error(`Translation failed for ${key}:`, e.message))
        .finally(() => inFlight.delete(key))
    );
  }

  const host = `${req.protocol}://${req.get("host")}`;
  const url = `${host}/subs/${encodeURIComponent(key)}.srt`;
  res.json({ subtitles: [{ id: `ml-ai-${imdbId}`, lang: "mal", url }] });
});

function placeholderSrt() {
  return (
    "1\n00:00:00,000 --> 09:59:59,000\n" +
    "മലയാളം സബ്‌ടൈറ്റിൽ തയ്യാറാക്കിക്കൊണ്ടിരിക്കുന്നു (സാധാരണയായി 1-2 മിനിറ്റ്). " +
    "അല്പസമയത്തിനു ശേഷം വീഡിയോ പോസ് ചെയ്ത്, ഈ സബ്‌ടൈറ്റിൽ ട്രാക്ക് വീണ്ടും തിരഞ്ഞെടുക്കുക.\n"
  );
}

// Shown when we couldn't even get a source English subtitle to translate -
// nothing Gemini-related, no point retrying without a different source.
function noSourceSrt() {
  return (
    "1\n00:00:00,000 --> 09:59:59,000\n" +
    "ഈ ടൈറ്റിലിന് ഇംഗ്ലീഷ് സബ്‌ടൈറ്റിൽ കണ്ടെത്താനായില്ല, അതിനാൽ മലയാളം പരിഭാഷ സാധ്യമല്ല.\n" +
    "No English subtitle could be found for this title, so Malayalam translation isn't possible.\n"
  );
}

// Shown when a source subtitle was found but translation failed completely
// (every chunk exhausted retries) - distinct from "still working."
function translationFailedSrt() {
  return (
    "1\n00:00:00,000 --> 09:59:59,000\n" +
    "മലയാളം പരിഭാഷ പരാജയപ്പെട്ടു. കുറച്ച് സമയത്തിനു ശേഷം വീണ്ടും ശ്രമിക്കുക.\n" +
    "Malayalam translation failed. Please try again in a few minutes.\n"
  );
}

// Prepended as an extra cue when SOME (not all) chunks failed - the rest of
// the file is a real, working Malayalam translation, just incomplete.
function partialFailureNotice() {
  return (
    "0\n00:00:00,000 --> 00:00:08,000\n" +
    "ഈ സിനിമയുടെ ഒരു ഭാഗം പരിഭാഷപ്പെടുത്താൻ കഴിഞ്ഞില്ല - ആ ഭാഗങ്ങൾ ഇംഗ്ലീഷിൽ കാണും.\n\n"
  );
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
  if (inFlight.has(key)) return res.send(placeholderSrt());
  res.status(404).send("Subtitle not found - open the title again to regenerate it");
});

async function translateAndCache(geminiKey, identity) {
  let englishSrt;
  try {
    englishSrt = await fetchEnglishSrt(identity);
  } catch (e) {
    console.error(`${identity.imdbId}: no English source found:`, e.message);
    // Cache the failure itself, so reselecting the track shows a clear
    // reason instead of the "still translating" message forever.
    return putCached(identity, noSourceSrt());
  }

  const entries = parseSrt(englishSrt);
  const { entries: translated, failedChunks, totalChunks } = await translateEntries(geminiKey, entries, {
    onProgress: (done, total) => console.log(`${identity.imdbId}: chunk ${done}/${total}`),
  });

  if (failedChunks === totalChunks) {
    console.error(`${identity.imdbId}: all ${totalChunks} chunks failed - translation did not succeed`);
    return putCached(identity, translationFailedSrt());
  }

  let malayalamSrt = buildSrt(translated);
  if (failedChunks > 0) {
    console.log(`${identity.imdbId}: ${failedChunks}/${totalChunks} chunks failed - caching partial translation with a notice`);
    malayalamSrt = partialFailureNotice() + malayalamSrt;
  }
  return putCached(identity, malayalamSrt);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Malayalam AI Subs running on port ${PORT}`));

module.exports = { encodeConfig }; // exported for reference/testing
