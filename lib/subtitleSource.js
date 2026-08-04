const fetch = require("node-fetch");

// Podnapisi.net has a free, keyless, no-login JSON search API - confirmed
// directly by their admin (github.com/Diaoul/subliminal/issues/916) and used
// by tools like MPC-HC for years. No account, no key, nothing to configure.
//
// IMPORTANT: Podnapisi's exact response shape isn't publicly documented in
// detail, so parsing here is defensive (tries several likely field names) and
// logs the raw response on failure. Hit GET /debug/podnapisi?imdb=tt1234567
// on your deployed server to see the real response and confirm/adjust field
// names if subtitles aren't coming through.

const BASE = "https://www.podnapisi.net/subtitles/search";
const HEADERS = {
  "Accept": "application/json",
  "User-Agent": "malayalam-ai-subs (contact via GitHub repo)",
};

function pickBestEnglishResult(results) {
  if (!Array.isArray(results)) return null;
  const english = results.filter((r) => {
    const lang = (r.language || r.lang || r.language_iso || "").toLowerCase();
    return lang === "en" || lang === "eng" || lang === "english";
  });
  const pool = english.length ? english : results;
  // Prefer highest download count if present, else first result
  return pool.sort((a, b) => (b.downloads || b.download_count || 0) - (a.downloads || a.download_count || 0))[0] || null;
}

function extractDownloadUrl(result) {
  return (
    result.download ||
    result.download_url ||
    result.url ||
    (result.id ? `https://www.podnapisi.net/subtitles/${result.id}/download` : null)
  );
}

// Raw search - exposed for the /debug route so you can inspect real responses
async function rawSearch(imdbId, season, episode) {
  const numericId = imdbId.replace(/^tt/, "");
  const params = new URLSearchParams({ movieDbId: numericId, language: "eng" });
  if (season) params.set("seasons", season);
  if (episode) params.set("episodes", episode);

  const res = await fetch(`${BASE}/${imdbId}?${params}`, { headers: HEADERS });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Podnapisi returned non-JSON (status ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`Podnapisi search failed: ${res.status} - ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

async function fetchByImdb(imdbId, season, episode) {
  const json = await rawSearch(imdbId, season, episode);
  const results = json.data || json.results || json.subtitles || (Array.isArray(json) ? json : null);

  const best = pickBestEnglishResult(results);
  if (!best) throw new Error(`No English subtitle found on Podnapisi for ${imdbId} - raw response: ${JSON.stringify(json).slice(0, 300)}`);

  const downloadUrl = extractDownloadUrl(best);
  if (!downloadUrl) throw new Error(`Podnapisi result had no download URL - raw result: ${JSON.stringify(best).slice(0, 300)}`);

  const fileRes = await fetch(downloadUrl, { headers: HEADERS });
  if (!fileRes.ok) throw new Error(`Failed to download subtitle file: ${fileRes.status}`);

  // Podnapisi sometimes serves a .zip containing the .srt rather than raw text -
  // detect and bail clearly rather than returning garbage, since sync/quality
  // of the translation depends on getting real subtitle text.
  const contentType = fileRes.headers.get("content-type") || "";
  if (contentType.includes("zip")) {
    throw new Error("Podnapisi returned a zip file - unzip handling not yet implemented, see README");
  }
  return fileRes.text();
}

// Returns { srt, matchedByHash: boolean } - kept for compatibility with the
// rest of the pipeline. Podnapisi does support hash-based matching in theory
// (same hash algorithm as OpenSubtitles) but the exact param name isn't
// confirmed here, so this currently always goes through ID search.
async function fetchEnglishSrt({ imdbId, season, episode }) {
  const srt = await fetchByImdb(imdbId, season, episode);
  return { srt, matchedByHash: false };
}

module.exports = { fetchEnglishSrt, rawSearch };
