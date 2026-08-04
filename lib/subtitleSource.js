const fetch = require("node-fetch");

// You need a free OpenSubtitles.com account + API key: https://www.opensubtitles.com/en/consumers
// Set OPENSUBTITLES_API_KEY as an env var. Free tier allows a limited number of
// downloads per day (shared across ALL users of this addon) - this is the main
// scaling constraint, separate from each user's own Gemini quota.
const OS_API_KEY = process.env.OPENSUBTITLES_API_KEY;
const OS_BASE = "https://api.opensubtitles.com/api/v1";
const HEADERS = {
  "Api-Key": OS_API_KEY,
  "User-Agent": "malayalam-ai-subs v1.0.0",
  "Content-Type": "application/json",
};

async function downloadFile(fileId) {
  const downloadRes = await fetch(`${OS_BASE}/download`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!downloadRes.ok) {
    const errText = await downloadRes.text().catch(() => "");
    throw new Error(`OpenSubtitles download failed: ${downloadRes.status} ${errText}`);
  }
  const downloadData = await downloadRes.json();

  const fileRes = await fetch(downloadData.link);
  if (!fileRes.ok) throw new Error("Failed to fetch subtitle file content");
  return fileRes.text();
}

// Best case: Stremio gave us the exact video's OpenSubtitles moviehash + byte
// size. A hash match means the subtitle was uploaded against this literal
// release, so timing lines up perfectly - no sync drift.
async function fetchByHash(videoHash) {
  const params = new URLSearchParams({
    moviehash: videoHash,
    languages: "en",
  });

  const res = await fetch(`${OS_BASE}/subtitles?${params}`, { headers: HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  const best = data?.data?.[0];
  const fileId = best?.attributes?.files?.[0]?.file_id;
  return fileId ? downloadFile(fileId) : null;
}

// Fallback: no hash available (some stream sources don't provide one), or no
// hash match found on OpenSubtitles. Falls back to "most downloaded English
// subtitle for this title" - usually close, occasionally off by a few seconds
// on releases with different cuts/intros.
async function fetchByImdb(imdbId, season, episode) {
  const numericId = imdbId.replace(/^tt/, "");
  const params = new URLSearchParams({
    imdb_id: numericId,
    languages: "en",
    order_by: "download_count",
    order_direction: "desc",
  });
  if (season) params.set("season_number", season);
  if (episode) params.set("episode_number", episode);

  const res = await fetch(`${OS_BASE}/subtitles?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`OpenSubtitles search failed: ${res.status}`);
  const data = await res.json();
  const best = data?.data?.[0];
  if (!best) throw new Error("No English subtitle found on OpenSubtitles for this title");

  const fileId = best.attributes?.files?.[0]?.file_id;
  if (!fileId) throw new Error("OpenSubtitles result had no downloadable file");
  return downloadFile(fileId);
}

// Returns { srt, matchedByHash: boolean }
async function fetchEnglishSrt({ imdbId, season, episode, videoHash }) {
  if (!OS_API_KEY) throw new Error("OPENSUBTITLES_API_KEY is not configured on the server");

  if (videoHash) {
    const hashResult = await fetchByHash(videoHash).catch((e) => {
      console.error("Hash search failed, falling back to IMDB search:", e.message);
      return null;
    });
    if (hashResult) return { srt: hashResult, matchedByHash: true };
  }

  const srt = await fetchByImdb(imdbId, season, episode);
  return { srt, matchedByHash: false };
}

module.exports = { fetchEnglishSrt };
