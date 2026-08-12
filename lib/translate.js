const fetch = require("node-fetch");

const CHUNK_SIZE = 350; // Gemini's Flash models allow ~65K output tokens/call -
// this keeps a typical movie to ~3-4 calls total instead of ~15-20, so the
// whole movie can realistically finish within one viewing session's wait time.

// Google has renamed/retired the "current" free Flash model multiple times
// during this project's lifetime (2.0 Flash shut down, then 2.5 Flash stopped
// accepting new users). Hardcoding one model name keeps breaking every time
// that happens. Instead: try candidates newest-first, and if one comes back
// 404 ("no longer available"), automatically fall through to the next and
// remember the working one - self-healing instead of a fixed guess.
const MODEL_CANDIDATES = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
let workingModelIndex = 0; // shared starting point - updated once a model is confirmed working

// Real free-tier rate limits vary by account/project tier and by model, and
// Google changes them over time - hardcoding a fixed interval means either
// wasting time (guessed too conservative) or still hitting 429s (guessed too
// optimistic). Instead, start optimistic and adapt per (key, model): any time
// a call gets rate-limited, adopt Google's own suggested retry delay as the
// new pacing interval going forward, so it self-corrects to the real limit.
const DEFAULT_INTERVAL_MS = 4000;
const stateByKeyModel = new Map(); // "apiKey::model" -> { intervalMs, lastCallAt }

function getState(apiKey, model) {
  const id = `${apiKey}::${model}`;
  if (!stateByKeyModel.has(id)) stateByKeyModel.set(id, { intervalMs: DEFAULT_INTERVAL_MS, lastCallAt: 0 });
  return stateByKeyModel.get(id);
}

async function pace(apiKey, model) {
  const state = getState(apiKey, model);
  const wait = state.lastCallAt + state.intervalMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  state.lastCallAt = Date.now();
}

function learnFromRateLimit(apiKey, model, retryDelayMs) {
  const state = getState(apiKey, model);
  if (retryDelayMs && retryDelayMs > state.intervalMs) {
    console.log(`Adjusting pacing for ${model}: ${state.intervalMs}ms -> ${retryDelayMs}ms (Gemini's own guidance)`);
    state.intervalMs = retryDelayMs;
  }
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractJson(text) {
  // Gemini sometimes wraps JSON in ```json ... ``` fences, and reasoning
  // models (Gemini 3.x) sometimes add a short preamble/closing remark even
  // when told not to. Strip fences, then pull out just the outermost
  // [...] array so stray surrounding text doesn't break JSON.parse.
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON array found in Gemini response");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

// If Gemini's 429 response tells us how long to wait, use that (plus buffer)
// instead of guessing.
function extractRetryDelayMs(errText) {
  const match = errText.match(/retry in ([\d.]+)s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 2000;
  return null;
}

function buildPrompt(chunkEntries) {
  const numbered = chunkEntries.map((e, i) => `${i + 1}. ${e.text.replace(/\n/g, " / ")}`).join("\n");
  return `You are translating movie/TV subtitle lines from English to Malayalam.
Rules:
- Translate naturally and idiomatically for Malayalam speakers, not word-for-word.
- Preserve tone (casual stays casual, formal stays formal, swearing stays as intense).
- Keep names of people/places unchanged unless they have a standard Malayalam form.
- Translate mature content faithfully — ordinary strong language, sexual references,
  and violence typical of an R-rated film should be translated normally, not softened
  or skipped.
- The ONLY exception: if a specific word or short phrase is extremely graphic or
  explicit (the most severe slurs, or the most graphic possible descriptions of a
  sexual act or violence), replace just that word/phrase with asterisks matching its
  approximate length (e.g. "***") and translate the rest of the line normally around
  it. This should be rare — most mature dialogue does not need this. Do not censor
  ordinary profanity or moderate sexual/violent references, only the most extreme
  individual terms.
- Keep the SAME NUMBER of lines as input, in the SAME ORDER.
- Return ONLY a JSON array of strings, one per line, nothing else. No explanations.

Lines:
${numbered}`;
}

// Calls Gemini, trying candidate models starting from the last known-working
// one. A 404 (model retired/unavailable) rotates to the next candidate
// in-process, without surfacing as a chunk failure. Any other error (429,
// etc.) is thrown immediately for the caller's existing retry logic to handle
// - model rotation is only for "this model doesn't exist anymore", not for
// rate limits.
async function callGemini(apiKey, chunkEntries) {
  const prompt = buildPrompt(chunkEntries);
  let lastErr = null;

  for (let i = workingModelIndex; i < MODEL_CANDIDATES.length; i++) {
    const model = MODEL_CANDIDATES[i];
    await pace(apiKey, model);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 },
          // Translating dialogue that already exists in a released, officially
          // classified film isn't generating new content — R-rated material
          // routinely has scenes that trip even BLOCK_ONLY_HIGH across a full
          // runtime, and blocking a chunk mid-film costs real translation
          // time even with the bisection fallback below. BLOCK_NONE removes
          // the four categories Google lets a developer key adjust; it does
          // NOT remove Google's own non-adjustable baseline protections
          // (e.g. CSAM), which apply regardless of these settings.
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          ],
        }),
      }
    );

    if (res.status === 404) {
      const errText = await res.text().catch(() => "");
      console.error(`Model ${model} unavailable (404), trying next candidate:`, errText.slice(0, 200));
      lastErr = new Error(`Model ${model} not available: ${errText}`);
      continue; // try the next candidate model
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const err = new Error(`Gemini API error ${res.status}: ${errText}`);
      err.status = res.status;
      err.retryDelayMs = extractRetryDelayMs(errText);
      err.model = model;
      throw err; // not a model-availability issue - let the retry loop handle it
    }

    if (i !== workingModelIndex) {
      console.log(`Switched to working model: ${model}`);
      workingModelIndex = i;
    }
    return res.json();
  }

  throw lastErr || new Error("All candidate Gemini models are unavailable");
}

async function translateChunk(apiKey, chunkEntries) {
  const data = await callGemini(apiKey, chunkEntries);

  // A safety block comes back as HTTP 200 with either no candidates at all,
  // or a candidate whose finishReason is SAFETY instead of STOP — nothing
  // about that looks like a network/rate-limit error, so it has to be
  // checked for explicitly or it just looks like "no translation text".
  const candidate = data?.candidates?.[0];
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason || (candidate && candidate.finishReason === "SAFETY")) {
    const err = new Error(`Gemini safety filter blocked this chunk (${blockReason || "SAFETY"})`);
    err.blocked = true;
    throw err;
  }

  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no translation text");

  const arr = extractJson(text);
  if (!Array.isArray(arr) || arr.length !== chunkEntries.length) {
    throw new Error(
      `Gemini line count mismatch: expected ${chunkEntries.length}, got ${Array.isArray(arr) ? arr.length : "non-array"}`
    );
  }
  return arr;
}

// Translates one chunk with a real retry budget for transient errors
// (rate limits, server overload). A SAFETY block is different in kind: the
// exact same request will get classified the same way every time, so
// burning through 6 retries on it only wastes minutes for a result that
// was never going to change. For that case, split the chunk in half and
// recurse instead — most of the time only a line or two is actually
// responsible, so bisecting narrows down to just those instead of losing
// the whole chunk. Bottoms out at single lines so a block can never take
// down more than the specific line(s) actually triggering it.
async function translateChunkWithFallback(apiKey, chunkEntries, label) {
  let lastErr = null;
  const maxAttempts = chunkEntries.length <= 1 ? 3 : 6; // still worth a few tries even for a single line — could be transient

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await translateChunk(apiKey, chunkEntries);
    } catch (e) {
      lastErr = e;

      if (e.blocked) {
        if (chunkEntries.length === 1) break; // nothing smaller to try - genuinely this one line
        console.log(`${label}: Gemini safety filter blocked ${chunkEntries.length} lines, splitting to isolate which ones...`);
        const mid = Math.ceil(chunkEntries.length / 2);
        const [firstHalf, secondHalf] = await Promise.all([
          translateChunkWithFallback(apiKey, chunkEntries.slice(0, mid), `${label}a`),
          translateChunkWithFallback(apiKey, chunkEntries.slice(mid), `${label}b`),
        ]);
        return firstHalf.concat(secondHalf);
      } else if (e.status === 429 && e.retryDelayMs) {
        learnFromRateLimit(apiKey, e.model || MODEL_CANDIDATES[workingModelIndex], e.retryDelayMs);
        await new Promise((r) => setTimeout(r, e.retryDelayMs));
      } else if (e.status === 503 || e.status === 500 || e.status === 502 || e.status === 504) {
        const wait = 5000 * Math.pow(2, attempt);
        console.log(`${label}: Gemini overloaded (${e.status}), retrying in ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  }

  // Out of attempts (and, for a blocked chunk, already down to one line) -
  // keep English for just this much rather than breaking subtitle sync.
  console.error(`${label}: giving up on ${chunkEntries.length} line(s), keeping English:`, lastErr?.message);
  return chunkEntries.map((e) => e.text);
}

// Translates all subtitle entries to Malayalam using the caller's Gemini key.
// Chunked, retried, and bisected on safety blocks (see
// translateChunkWithFallback) so a single problematic line costs at most a
// few lines of English fallback rather than an entire 350-line chunk.
async function translateEntries(apiKey, entries, { onProgress } = {}) {
  const chunks = chunkArray(entries, CHUNK_SIZE);
  const translated = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const result = await translateChunkWithFallback(apiKey, chunk, `Chunk ${i + 1}/${chunks.length}`);

    chunk.forEach((e, idx) => {
      translated.push({ ...e, text: result[idx] });
    });

    if (onProgress) {
      // Only the entries actually translated so far - caller decides how to
      // represent the rest (never hand back raw English as a stand-in for
      // Malayalam; that defeats the point for users who don't read English).
      onProgress(i + 1, chunks.length, translated.slice());
    }
  }

  return translated;
}

module.exports = { translateEntries };
