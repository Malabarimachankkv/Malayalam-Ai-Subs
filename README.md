# Malayalam AI Subs

Two ways to get an English subtitle translated to Malayalam with your own free
Gemini key. Completely independent from the Malayalam Subs project (Team
GOAT + Movie Mirror addon) — no shared bucket, no shared infra, no shared
code.

## 1. Upload & Translate (`/configure`, default tab)

Have a subtitle file already — from Movie Mirror, Team GOAT, a rip,
anywhere? Upload it, paste your Gemini key, and get it back translated to
Malayalam. No IMDb id, no OpenSubtitles lookup involved — just a direct
file-in, file-out translation.

- The translated file downloads straight to the uploader.
- It's also saved to an admin-only **review queue** at `/admin/queue`
  (password-protected — see `ADMIN_PASSWORD` below) so someone can check
  quality before it goes anywhere further.
- **This queue doesn't feed into anything automatically.** Whether/how an
  approved translation should ever reach the main Malayalam Subs addon is a
  separate decision, deliberately not wired up yet — this is step one.

## 2. Install in Stremio (`/configure`, second tab)

The original on-demand addon flow, unchanged:

1. Paste a free Gemini API key, get an install link.
2. Install that link in Nuvio/Stremio.
3. Play a movie → the addon fetches an English subtitle from OpenSubtitles,
   translates it to Malayalam with your Gemini key, and shows it.
4. While the server stays running, already-translated movies are served
   instantly from memory — no re-translation on repeat plays. A server
   restart (Render free tier spins down when idle) clears that cache, so
   the next request after a cold start re-translates once.

Three keys/secrets are involved in total, but only one of them is anything
an end user ever touches:
- **Gemini key** — entered per-use on the config page (both tabs). The only
  key anyone using this ever deals with.
- **OpenSubtitles key** — set once by you as a server env var, to fetch the
  source English subtitle for the Stremio flow only. Free, no credit card.
  Nobody using the addon sees this.
- **Admin password** — set once by you as a server env var, to view the
  review queue. Nobody uploading a file needs or sees this.

## Environment variables (Render)

| Variable | Purpose |
|---|---|
| `OPENSUBTITLES_API_KEY` | Free key from https://www.opensubtitles.com/en/consumers — powers the Stremio on-demand flow |
| `ADMIN_PASSWORD` | Any password you pick — protects `/admin/queue` and its API. Without this set, the queue route returns an error rather than being left open. |

No B2, no database — same as before.

## Deploy to Render, step by step

1. **Push this code to GitHub** — new repo (e.g. `malayalam-ai-subs`), upload
   these files via GitHub's "upload an existing file" web option, commit.
2. **Get a free OpenSubtitles API key** from the link above (2 minutes, no card).
3. **New Web Service on Render**: render.com → New + → Web Service → connect
   the repo.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free
4. **Add environment variables**: `OPENSUBTITLES_API_KEY` and `ADMIN_PASSWORD`.
5. **Deploy** — watch Logs for `Malayalam AI Subs running on port ...`.
6. Visit `https://your-service.onrender.com/configure` to upload a file, or
   switch to the "Install in Stremio" tab for the addon install link.
7. Visit `https://your-service.onrender.com/admin/queue` (browser will
   prompt for the admin password) to review uploaded translations.

## Known limitations

- **No persistent storage anywhere** — by original design (no B2). Both the
  on-demand translation cache and the upload review queue are in-memory
  only, and clear if the server restarts. Approve/download anything in the
  queue before it might restart if it matters.
- **OpenSubtitles free tier** caps downloads/day account-wide — this is the
  ceiling on how many *new* titles the Stremio flow can translate per day,
  well before Gemini quota is a concern. Doesn't affect Upload & Translate,
  which never touches OpenSubtitles.
- **Gemini free tier** comfortably covers a handful of full-movie
  translations per user per day (see `lib/translate.js` for the chunking
  approach). If a chunk fails twice, it falls back to English for just that
  chunk rather than breaking subtitle sync (Stremio flow) or failing the
  whole upload (Upload & Translate flow — same fallback applies there).
- **Upload & Translate runs synchronously** — the uploader's browser waits
  for the whole file to finish translating (a full movie under a strict
  free-tier rate limit can take several minutes). The page says so up
  front. The Stremio flow instead streams a placeholder and translates in
  the background, since nobody's watching a webpage for that one.
- **Uploaded files aren't independently validated** beyond "does this parse
  as SRT" — unlike the main Malayalam Subs addon's scraped downloads, there's
  no automated check that the translated output is actually correct. That's
  what the review queue is for.

## Local testing

```
npm install
OPENSUBTITLES_API_KEY=xxx ADMIN_PASSWORD=xxx npm start
```

Then open `http://localhost:3000/configure`, or `http://localhost:3000/admin/queue`.

