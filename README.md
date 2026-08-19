# Malayalam AI Subs

Upload an English subtitle file, get it back translated to Malayalam, using
your own free Gemini key. That's the whole project.

The review queue now shares the **same B2 bucket** the main Malayalam Subs
project (Team GOAT + Movie Mirror addon) already uses — see the env vars
below. It writes under its own key prefix (`ai-subs-queue/`) so it can't
collide with anything the main addon stores, but the durable storage itself
is shared. Everything else (code, deploy, server) is still separate.

## How it works

1. Visit `/configure`.
2. Get a free Gemini API key (linked on the page, ~30 seconds, no card).
3. Upload an English `.srt` file — however you found it.
4. Get the translated Malayalam file back as a download. It's also saved to
   an admin-only **review queue** at `/admin/queue` (password-protected —
   see `ADMIN_PASSWORD` below), so someone can check quality — the optional
   note field is the only way to flag which title it is, if the filename
   doesn't already make that obvious.

Longer files (a full movie) can take several minutes under Gemini's
free-tier rate limit — the page says so up front, and the request just runs
until it's done rather than timing out early.

**The review queue doesn't feed into the main addon's live results
automatically.** Whether/how an approved translation should ever reach
Malayalam Subs is a separate decision, not wired up here — this just makes
sure a translation isn't lost the moment someone finishes uploading it.

Three secrets are involved, but only one is anything an end user ever touches:
- **Gemini key** — entered per-use on the page. The only key anyone using
  this ever deals with.
- **Admin password** — set once by you as a server env var, to view the
  review queue. Nobody uploading a file needs or sees this.
- **B2 credentials** — set once by you as server env vars, so translated
  files land in the shared bucket. Nobody uploading a file needs or sees
  these either.

## Environment variables (Render)

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Any password you pick — protects `/admin/queue` and its API. |
| `B2_KEY_ID` | **Same value as the main Malayalam Subs addon's B2 key ID.** Copy it from that service's Render env vars. |
| `B2_APPLICATION_KEY` | Same as above, but the application key. |
| `B2_BUCKET_ID` | Same as above, the bucket's ID. |
| `B2_BUCKET_NAME` | Same as above, the bucket's name. |

All four B2 values need to point at the exact same bucket the main addon
already uses — that's what makes this "our bucket" rather than a new one.
No database beyond that.

## Deploy to Render, step by step

1. **Push this code to GitHub** — new repo (e.g. `malayalam-ai-subs`), upload
   these files via GitHub's "upload an existing file" web option, commit.
   (If updating an existing service instead, just re-upload the changed
   files to the existing repo and Render redeploys automatically.)
2. **New Web Service on Render**: render.com → New + → Web Service → connect
   the repo.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free
3. **Add environment variables**: `ADMIN_PASSWORD`, and the four `B2_*`
   values copied from the main addon's Render service (Environment tab →
   Edit, on that service).
4. **Deploy** — watch Logs for `Malayalam AI Subs running on port ...`.
5. Visit `https://your-service.onrender.com/configure` to upload a file.
6. Visit `https://your-service.onrender.com/admin/queue` (browser will
   prompt for the admin password) to review uploaded translations.

## Known limitations

- **Queue survives restarts now** (it didn't before) — B2 storage means an
  in-progress or finished translation isn't lost if Render's free tier
  spins the service down between someone uploading and someone reviewing.
- **Gemini free tier** comfortably covers a handful of full-movie
  translations per day (see `lib/translate.js` for the chunking, retry, and
  safety-block-bisection approach).
- **Runs synchronously** — the uploader's browser waits for the whole file
  to finish translating. Fine for one person translating their own file;
  not built for many concurrent uploads.
- **Uploaded files aren't independently validated** beyond "does this parse
  as SRT" — there's no automated check that the translated output is
  actually correct. That's what the review queue is for.
- **The queue listing does one B2 read per entry** to fetch its metadata —
  fine at the scale this is meant for (a handful to a few dozen pending
  items), but would need a proper index file if it ever grew into the
  hundreds.

## Local testing

```
npm install
ADMIN_PASSWORD=xxx B2_KEY_ID=xxx B2_APPLICATION_KEY=xxx B2_BUCKET_ID=xxx B2_BUCKET_NAME=xxx npm start
```

Then open `http://localhost:3000/configure`, or `http://localhost:3000/admin/queue`.
