# Malayalam AI Subs

Stremio/Nuvio addon that translates English subtitles to Malayalam on demand.
Only one key needed, ever: the user's own free Gemini API key.

## How it works (simple version)

1. Visit `/configure`, paste a free Gemini key, get an install link.
2. Install that link in Nuvio/Stremio.
3. Play a movie → the addon fetches an English subtitle (Podnapisi.net, free,
   no account needed), translates it to Malayalam with your Gemini key, and
   shows it.
4. Already-translated movies are cached (Backblaze B2), so the second person
   ever to watch that movie gets it instantly, no translation needed.

No login, no database, no OpenSubtitles account, nothing to manage besides
your own Gemini key.

## Environment variables (set these in Render)

| Variable | Purpose |
|---|---|
| `B2_ENDPOINT` | e.g. `https://s3.us-west-004.backblazeb2.com` |
| `B2_REGION` | e.g. `us-west-004` |
| `B2_KEY_ID` | B2 application key ID |
| `B2_APP_KEY` | B2 application key |
| `B2_BUCKET` | Bucket name (can reuse your Malayalam Subs bucket — writes under `ml-ai-subs/` so nothing collides) |
| `B2_PUBLIC_URL_BASE` | Public base URL for reading cached files, e.g. `https://f004.backblazeb2.com/file/your-bucket` |

That's it — no OpenSubtitles key, no other setup.

## Deploy to Render, step by step

1. **Push this code to GitHub**: create a new repo (e.g. `malayalam-ai-subs`),
   upload these files via GitHub's web "upload an existing file" option, commit.
2. **Get your B2 credentials ready** — same ones you already use for Malayalam Subs.
3. **New Web Service on Render**: render.com → New + → Web Service → connect
   the repo.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free
4. **Add the environment variables** listed above, one by one.
5. **Deploy** — watch the Logs tab for `Malayalam AI Subs running on port ...`.
6. Visit `https://your-service.onrender.com/configure`, paste a Gemini key,
   copy the install link into Nuvio.

## If subtitles aren't showing up

Podnapisi's exact response format isn't fully documented publicly, so the
parsing in `lib/subtitleSource.js` is defensive but may need a small tweak
for some titles. To check what's actually coming back:

```
https://your-service.onrender.com/debug/podnapisi?imdb=tt1234567
```

That returns the raw Podnapisi response for that movie. If it looks
different from what `lib/subtitleSource.js` expects, that's the file to
adjust — the field names it's trying (`download`, `url`, `language`, etc.)
are best guesses based on how similar subtitle APIs are usually shaped.

## Known limitations

- **Podnapisi is unofficial/undocumented** — unlike OpenSubtitles' versioned
  REST API, there's no guarantee its response format stays stable long-term.
  If it silently changes, subtitles will just stop showing (fails soft, no
  crash) until the parsing is adjusted.
- **Zip files aren't unpacked yet** — if Podnapisi returns a `.zip` instead of
  a raw `.srt` for a given subtitle, that one throws a clear error rather
  than silently failing. Worth adding a zip-extraction step if you hit this
  often (say so and I'll add it).
- **Gemini free tier** comfortably covers a handful of full-movie translations
  per day per user — see `lib/translate.js` for the chunking approach. If a
  translation chunk fails twice, it falls back to English for just that
  chunk rather than breaking subtitle sync entirely.

## Local testing

```
npm install
B2_ENDPOINT=xxx B2_REGION=xxx B2_KEY_ID=xxx B2_APP_KEY=xxx B2_BUCKET=xxx B2_PUBLIC_URL_BASE=xxx npm start
```

Then open `http://localhost:3000/configure`.
