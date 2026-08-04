const fetch = require("node-fetch");

const CHUNK_SIZE = 40; // lines per Gemini call - keeps context tight, avoids dropped lines
const MODEL = "gemini-2.0-flash";

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractJson(text) {
  // Gemini sometimes wraps JSON in ```json ... ``` fences - strip them
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

async function translateChunk(apiKey, chunkEntries) {
  const numbered = chunkEntries.map((e, i) => `${i + 1}. ${e.text.replace(/\n/g, " / ")}`).join("\n");

  const prompt = `You are translating movie/TV subtitle lines from English to Malayalam.
Rules:
- Translate naturally and idiomatically for Malayalam speakers, not word-for-word.
- Preserve tone (casual stays casual, formal stays formal, swearing stays as intense).
- Keep names of people/places unchanged unless they have a standard Malayalam form.
- Keep the SAME NUMBER of lines as input, in the SAME ORDER.
- Return ONLY a JSON array of strings, one per line, nothing else. No explanations.

Lines:
${numbered}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no translation text");

  const arr = extractJson(text);
  if (!Array.isArray(arr) || arr.length !== chunkEntries.length) {
    throw new Error(
      `Gemini line count mismatch: expected ${chunkEntries.length}, got ${Array.isArray(arr) ? arr.length : "non-array"}`
    );
  }
  return arr;
}

// Translates all subtitle entries to Malayalam using the caller's Gemini key.
// Chunked + retried; falls back to leaving a chunk untranslated (marked) rather
// than failing the whole subtitle if Gemini errors persist on one chunk.
async function translateEntries(apiKey, entries, { onProgress } = {}) {
  const chunks = chunkArray(entries, CHUNK_SIZE);
  const translated = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let result = null;
    let lastErr = null;

    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await translateChunk(apiKey, chunk);
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // backoff
      }
    }

    if (!result) {
      // Give up on this chunk only - keep English so subtitle sync isn't broken
      console.error(`Chunk ${i + 1}/${chunks.length} failed, keeping English:`, lastErr?.message);
      result = chunk.map((e) => e.text);
    }

    chunk.forEach((e, idx) => {
      translated.push({ ...e, text: result[idx] });
    });

    if (onProgress) onProgress(i + 1, chunks.length);
  }

  return translated;
}

module.exports = { translateEntries };
