// Plain in-memory cache - no external service, nothing to configure.
// Lives only as long as the server process does: fast repeat lookups while
// running, but cleared on restart (Render free tier spins down when idle).
// Fine for this addon's usage pattern - occasional re-translation on a cold
// start is a minor cost, not a real problem.

const store = new Map();

function cacheKey({ imdbId, season, episode }) {
  const suffix = season && episode ? `-s${season}e${episode}` : "";
  return `${imdbId}${suffix}`;
}

async function getCached(identity) {
  return store.get(cacheKey(identity)) || null;
}

async function putCached(identity, srtText) {
  const key = cacheKey(identity);
  store.set(key, srtText);
  return srtText;
}

module.exports = { getCached, putCached };
