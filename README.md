# Malayalam AI Subs

Stremio/Nuvio addon that translates English subtitles to Malayalam on demand,
using each user's own free Gemini API key (entered via a config page, baked
into their personal install URL — no login, no database).

## How it works

1. User visits `/configure`, gets a free Gemini key from Google AI Studio, pastes it in.
2. Page generates an install URL like `https://yourapp.onrender.com/<encoded-key>/manifest.json`.
3. When Stremio/Nuvio asks for subtitles on a title:
   - Check Backblaze B2 cache (keyed by IMDB ID, shared across ALL users).
   - If cached → return instantly, no API calls.
   - If not cached → fetch English subtitle from OpenSubtitles, translate in
     ~40-line chunks via that user's Gemini key, cache the result in B2, return it.

Because caching is per-title (not per-user), only the *first* person to request
an untranslated movie pays the Gemini API cost — everyone after gets it free
from cache.

## Environment variables (set these in Render)

| Variable | Purpose |
|---|---|
| `OPENSUBTITLES_API_KEY` | Free key from https://www.opensubtitles.com/en/consumers — used to fetch source English subtitles. Shared server-side, has its own daily download quota — this is the main scaling bottleneck, not Gemini. |
| `B2_ENDPOINT` | e.g. `https://s3.us-west-004.backblazeb2.com` |
| `B2_REGION` | e.g. `us-west-004` |
| `B2_KEY_ID` | B2 application key ID |
| `B2_APP_KEY` | B2 application key |
| `B2_BUCKET` | Bucket name (can reuse your Malayalam Subs bucket — this addon writes under the `ml-ai-subs/` prefix so it won't collide) |
| `B2_PUBLIC_URL_BASE` | Public base URL for reading cached files, e.g. `https://f004.backblazeb2.com/file/your-bucket` |

## Deploy to Render (same pattern as Malayalam Subs)

1. Push this to a new GitHub repo.
2. New Web Service on Render → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add the env vars above.
6. Auto-deploy on push to `main`, same as your existing addon.

## Known limitations / things to watch

- **OpenSubtitles free tier** caps downloads/day account-wide (not per-user) —
  this will likely be the real ceiling for how many *new* titles can be
  translated per day, well before Gemini quota is a concern.
- **Gemini free tier** (Flash) comfortably handles a handful of full-movie
  translations per user per day (see chunking math in `lib/translate.js`) —
  but if a chunk fails twice, that chunk falls back to English rather than
  breaking sync, so a translated subtitle can occasionally have a stray
  English line in it. Worth spot-checking early results.
- **No retry queue yet** — if two different users request the same
  never-before-seen movie in the same few seconds, the in-memory lock in
  `server.js` prevents double-translation *within one server instance*, but
  Render's free tier can spin down/restart, which would reset that lock.
  Not a correctness issue, just occasional duplicate work.
- **Series support** uses `tt1234567:season:episode` ID format, standard for
  Stremio — matching logic mirrors what you already built for exact numeric
  season/episode enforcement in Malayalam Subs; consider porting that
  fuzzy-matching approach if OpenSubtitles' season/episode filtering proves
  loose.

## Local testing

```
npm install
OPENSUBTITLES_API_KEY=xxx B2_ENDPOINT=xxx B2_KEY_ID=xxx B2_APP_KEY=xxx B2_BUCKET=xxx B2_PUBLIC_URL_BASE=xxx npm start
```

Then open `http://localhost:3000/configure` to generate a test install link.
