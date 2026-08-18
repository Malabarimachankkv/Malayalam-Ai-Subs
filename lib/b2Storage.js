const fetch = require("node-fetch");
const crypto = require("crypto");

// Same bucket the main Malayalam Subs addon already writes to — set these
// to the exact same values as that project's B2_KEY_ID / B2_APPLICATION_KEY
// / B2_BUCKET_ID / B2_BUCKET_NAME env vars on Render, so this writes into
// the same bucket rather than a separate one. Everything this project
// writes lives under its own "ai-subs-queue/" key prefix (see
// lib/uploadQueue.js), so it can't collide with the main addon's own keys
// even though they share a bucket.
const KEY_ID = process.env.B2_KEY_ID;
const APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const BUCKET_ID = process.env.B2_BUCKET_ID;
const BUCKET_NAME = process.env.B2_BUCKET_NAME;

// B2 auth tokens are valid ~24h; cache and refresh a little early rather
// than re-authorizing on every request.
let authCache = null;

function requireConfig() {
  if (!KEY_ID || !APPLICATION_KEY || !BUCKET_ID || !BUCKET_NAME) {
    throw new Error(
      "B2 storage isn't configured — set B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_ID, and B2_BUCKET_NAME " +
        "(same values as the main Malayalam Subs addon uses, so this writes into that same bucket)."
    );
  }
}

async function authorize() {
  requireConfig();
  if (authCache && authCache.expiresAt > Date.now()) return authCache;

  const credentials = Buffer.from(`${KEY_ID}:${APPLICATION_KEY}`).toString("base64");
  const res = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) throw new Error(`B2 authorize failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  authCache = {
    apiUrl: data.apiInfo.storageApi.apiUrl,
    downloadUrl: data.apiInfo.storageApi.downloadUrl,
    authorizationToken: data.authorizationToken,
    expiresAt: Date.now() + 23 * 60 * 60 * 1000,
  };
  return authCache;
}

async function getUploadUrl() {
  const auth = await authorize();
  const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_upload_url`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ bucketId: BUCKET_ID }),
  });
  if (!res.ok) throw new Error(`B2 get_upload_url failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function putObject(key, buffer, contentType) {
  const { uploadUrl, authorizationToken } = await getUploadUrl();
  const sha1 = crypto.createHash("sha1").update(buffer).digest("hex");

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: authorizationToken,
      "X-Bz-File-Name": key.split("/").map(encodeURIComponent).join("/"),
      "Content-Type": contentType || "b2/x-auto",
      "X-Bz-Content-Sha1": sha1,
      "Content-Length": String(buffer.length),
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`B2 upload failed for "${key}": ${res.status} ${await res.text()}`);
  return res.json();
}

async function getObject(key) {
  const auth = await authorize();
  const res = await fetch(`${auth.downloadUrl}/file/${BUCKET_NAME}/${key.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: auth.authorizationToken },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`B2 download failed for "${key}": ${res.status} ${await res.text()}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function listObjects(prefix) {
  const auth = await authorize();
  const results = [];
  let startFileName;

  do {
    const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_list_file_names`, {
      method: "POST",
      headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
      body: JSON.stringify({ bucketId: BUCKET_ID, prefix, maxFileCount: 1000, startFileName }),
    });
    if (!res.ok) throw new Error(`B2 list failed for prefix "${prefix}": ${res.status} ${await res.text()}`);
    const data = await res.json();
    results.push(...data.files);
    startFileName = data.nextFileName || undefined;
  } while (startFileName);

  return results; // [{ fileName, fileId, ... }]
}

async function deleteObject(key) {
  const matches = await listObjects(key);
  const match = matches.find((f) => f.fileName === key);
  if (!match) return; // already gone, nothing to do

  const auth = await authorize();
  const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_delete_file_version`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: key, fileId: match.fileId }),
  });
  if (!res.ok) throw new Error(`B2 delete failed for "${key}": ${res.status} ${await res.text()}`);
}

module.exports = { putObject, getObject, listObjects, deleteObject };
