// The user's Gemini API key travels inside the install URL itself,
// base64-encoded as JSON. No database, no login, no server-side session.
// Example manifest URL: https://yourapp.onrender.com/eyJnZW1pbmlLZXkiOiJBSXph...==/manifest.json

function encodeConfig(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function decodeConfig(str) {
  try {
    const json = Buffer.from(str, "base64url").toString("utf8");
    const obj = JSON.parse(json);
    if (!obj.geminiKey || typeof obj.geminiKey !== "string") return null;
    return obj;
  } catch (e) {
    return null;
  }
}

module.exports = { encodeConfig, decodeConfig };
