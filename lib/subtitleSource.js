const fetch = require("node-fetch");

// Free OpenSubtitles.com API key - get one at https://www.opensubtitles.com/en/consumers
// This is set ONCE by you as a server env var. End users never see or need
// this key - the only key they ever enter is their own Gemini key.
const OS_API_KEY = process.env.OPENSUBTITLES_API_KEY;
const OS_BASE = "https://api.opensubtitles.com/api/v1";
const HEADERS = {
  "Api-Key": OS_API_KEY,
  "User-Agent": "malayalam-ai-subs v1.0.0",
  "Content-Type": "application/json",
};

async function fetchEnglishSrt({ imdbId, season, episode }) {
  if (!OS_API_KEY) throw new Error("OPENSUBTITLES_API_KEY is not configured on the server");

  const numericId = imdbId.replace(/^tt/, "");
  const params = new URLSearchParams({
    imdb_id: numericId,
    languages: "en",
    order_by: "download_count",
    order_direction: "desc",
  });
  if (season) params.set("season_number", season);
  if (episode) params.set("episode_number", episode);

  const searchRes = await fetch(`${OS_BASE}/subtitles?${params}`, { headers: HEADERS });
  if (!searchRes.ok) throw new Error(`OpenSubtitles search failed: ${searchRes.status}`);
  const searchData = await searchRes.json();

  const best = searchData?.data?.[0];
  if (!best) throw new Error(`No English subtitle found on OpenSubtitles for ${imdbId}`);

  const fileId = best.attributes?.files?.[0]?.file_id;
  if (!fileId) throw new Error("OpenSubtitles result had no downloadable file");

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

module.exports = { fetchEnglishSrt };
