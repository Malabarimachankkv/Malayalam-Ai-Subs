# Malayalam AI Subs

Stremio/Nuvio addon that translates English subtitles to Malayalam on demand.
Completely independent from your Malayalam Subs project — no shared bucket,
no shared infra.

## How it works

1. Visit `/configure`, paste a free Gemini API key, get an install link.
2. Install that link in Nuvio/Stremio.
3. Play a movie → the addon fetches an English subtitle from OpenSubtitles,
   translates it to Malayalam with your Gemini key, and shows it.
4. While the server stays running, already-translated movies are served
   instantly from memory — no re-translation on repeat plays. A server
   restart (Render free tier spins down when idle) clears that cache, so
   the next request after a cold start re-translates once.

Two keys are involved, but only one of them is anything you or an end user
ever touches:
- **Gemini key** — entered per-install on the config page. This is the only
  key anyone installing the addon deals with.
- **OpenSubtitles key** — set once by you as a server env var, to fetch the
  source English subtitle. Free, no credit card. Nobody installing the addon
  sees this.

## Environment variables (Render)

| Variable | Purpose |
|---|---|
| `OPENSUBTITLES_API_KEY` | Free key from https://www.opensubtitles.com/en/consumers |

That's the only one. No B2, no database.

## Deploy to Render, step by step

1. **Push this code to GitHub** — new repo (e.g. `malayalam-ai-subs`), upload
   these files via GitHub's "upload an existing file" web option, commit.
2. **Get a free OpenSubtitles API key** from the link above (2 minutes, no card).
3. **New Web Service on Render**: render.com → New + → Web Service → connect
   the repo.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free
4. **Add environment variable** `OPENSUBTITLES_API_KEY`.
5. **Deploy** — watch Logs for `Malayalam AI Subs running on port ...`.
6. Visit `https://your-service.onrender.com/configure`, paste your Gemini
   key, copy the install link into Nuvio.

## Known limitations

- **OpenSubtitles free tier** caps downloads/day account-wide — this is the
  ceiling on how many *new* titles can be translated per day, well before
  Gemini quota is a concern.
- **No persistent cache** — by design, per your call to drop B2. Translations
  only survive as long as the server process runs. Fine for personal use;
  worth revisiting if this ever needs to serve many users at scale.
- **Gemini free tier** comfortably covers a handful of full-movie
  translations per user per day (see `lib/translate.js` for the chunking
  approach). If a chunk fails twice, it falls back to English for just that
  chunk rather than breaking subtitle sync.

## Local testing

```
npm install
OPENSUBTITLES_API_KEY=xxx npm start
```

Then open `http://localhost:3000/configure`.
