async function translateEntries(apiKey, entries) {
  // stub: fake "translation" so we can exercise the rest of the pipeline
  return entries.map((e) => ({ ...e, text: "STUB-ML: " + e.text }));
}
module.exports = { translateEntries };
