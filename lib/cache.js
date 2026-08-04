const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

// Same B2 bucket pattern as Malayalam Subs. Translated subtitles are cached
// PER CONTENT ID, not per user - once anyone's Gemini key translates a movie,
// every future viewer (any user, any Gemini key) gets it instantly from cache.
// This is the single biggest lever for staying inside free-tier quotas.

const client = new S3Client({
  endpoint: process.env.B2_ENDPOINT, // e.g. https://s3.us-west-004.backblazeb2.com
  region: process.env.B2_REGION || "us-west-004",
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
});

const BUCKET = process.env.B2_BUCKET;

// Cached per title (+ season/episode for series) - once translated, every
// future viewer gets it instantly, no Gemini call needed.
function cacheKey({ imdbId, season, episode }) {
  const suffix = season && episode ? `-s${season}e${episode}` : "";
  return `ml-ai-subs/${imdbId}${suffix}.srt`;
}

async function getCached(identity) {
  const key = cacheKey(identity);
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return `${process.env.B2_PUBLIC_URL_BASE}/${key}`; // public URL, same pattern as Malayalam Subs
  } catch (e) {
    return null; // not cached yet
  }
}

async function putCached(identity, srtText) {
  const key = cacheKey(identity);
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: srtText,
      ContentType: "text/plain; charset=utf-8",
    })
  );
  return `${process.env.B2_PUBLIC_URL_BASE}/${key}`;
}

module.exports = { getCached, putCached, cacheKey };
