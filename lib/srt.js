// Minimal SRT parser/serializer. No external deps needed.

function parseSrt(srtText) {
  const blocks = srtText
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 2) continue;

    let idx = 0;
    // First line is the numeric index (sometimes missing/malformed — tolerate it)
    if (/^\d+$/.test(lines[0].trim())) {
      idx = parseInt(lines[0].trim(), 10);
      lines.shift();
    }
    const timing = lines.shift();
    if (!timing || !timing.includes("-->")) continue;
    const text = lines.join("\n");

    entries.push({ index: idx || entries.length + 1, timing, text });
  }
  return entries;
}

function buildSrt(entries) {
  return entries
    .map((e, i) => `${i + 1}\n${e.timing}\n${e.text}`)
    .join("\n\n")
    .trim() + "\n";
}

module.exports = { parseSrt, buildSrt };
