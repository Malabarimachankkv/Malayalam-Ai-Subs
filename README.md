# Malayalam AI Subs

Upload an English subtitle file, get it back translated to Malayalam, using
your own free Gemini key. That's the whole project.

## How it works

1. Visit `/configure`.
2. Get a free Gemini API key (linked on the page, ~30 seconds, no card).
3. Upload an English `.srt` file.
4. Get the translated Malayalam file back as a download. It's also saved to
   an admin-only **review queue** at `/admin/queue` (password-protected —
   see `ADMIN_PASSWORD` below), so someone can check quality.

Longer files (a full movie) can take several minutes under Gemini's
free-tier rate limit — the page says so up front, and the request just runs
until it's done rather than timing out early.

**The review queue doesn't feed into anything automatically.** It's just a
place to see what's been uploaded and download/approve/reject it.

Two secrets are involved, but only one is anything an end user ever touches:
- **Gemini key** — entered per-use on the page. The only key anyone using
  this ever deals with.
- **Admin password** — set once by you as a server env var, to view the
  review queue. Nobody uploading a file needs or sees this.

## Environment variables (Render)

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Any password you pick — protects `/admin/queue` and its API. Without this set, the queue route returns an error rather than being left open. |

No B2, no database — the queue is in-memory only (see Known limitations).

## Deploy to Render, step by step

1. **Push this code to GitHub** — new repo (e.g. `malayalam-ai-subs`), upload
   these files via GitHub's "upload an existing file" web option, commit.
   (If updating an existing service, re-upload every file here — not just
   the ones that changed — so the deployed page and server can't drift out
   of sync with each other.)
2. **New Web Service on Render**: render.com → New + → Web Service → connect
   the repo.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free
3. **Add environment variable** `ADMIN_PASSWORD`.
4. **Deploy** — watch Logs for `Malayalam AI Subs running on port ...`.
5. Visit `https://your-service.onrender.com/configure` to upload a file.
6. Visit `https://your-service.onrender.com/admin/queue` (browser will
   prompt for the admin password) to review uploaded translations.

## Known limitations

- **No persistent storage.** The review queue is in-memory only, and clears
  if the server restarts (Render free tier spins down after ~15 min idle).
  Approve/download anything in the queue before it might restart if it
  matters — there's no bucket or database backing it up.
- **Gemini free tier** comfortably covers a handful of full-movie
  translations per day (see `lib/translate.js` for the chunking, retry, and
  safety-block-bisection approach).
- **Runs synchronously** — the uploader's browser waits for the whole file
  to finish translating. Fine for one person translating their own file;
  not built for many concurrent uploads.
- **Uploaded files aren't independently validated** beyond "does this parse
  as SRT" — there's no automated check that the translated output is
  actually correct. That's what the review queue is for.

## Local testing

```
npm install
ADMIN_PASSWORD=xxx npm start
```

Then open `http://localhost:3000/configure`, or `http://localhost:3000/admin/queue`.
