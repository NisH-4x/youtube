# YouTube Downloader

A small, self-hosted web app for downloading YouTube **video** (merged MP4, up
to 4K when available) or **audio** (MP3 / M4A at a chosen bitrate). Built with
Next.js (App Router) + TypeScript + Tailwind. All heavy lifting is done by
`yt-dlp` and `ffmpeg`, which the app spawns as child processes.

> **Personal / offline use only.** Downloading content from YouTube may violate
> [YouTube's Terms of Service](https://www.youtube.com/t/terms). You are
> responsible for how you use this tool. Only download content you have the
> right to.

---

## How it works

1. **Fetch info** — `POST /api/info` runs `yt-dlp --dump-single-json` and returns
   the title, thumbnail, duration, uploader, and the list of available video
   resolutions.
2. **Start download** — `POST /api/download` validates the request, spawns
   `yt-dlp` into a private per-request temp directory, and returns a `jobId`.
3. **Progress** — `GET /api/progress?jobId=...` is a Server-Sent Events stream
   that pushes `{ percent, speed, eta, phase }` parsed from yt-dlp's
   `--progress-template` output.
4. **File** — `GET /api/file?jobId=...` streams the finished file to the browser
   with a sanitized `Content-Disposition` filename, then deletes the temp files.

All route handlers run on the **Node.js runtime** (`export const runtime =
"nodejs"`) because they spawn binaries and stream large files — this app must be
run as a long-lived Node server, **not** on an edge/serverless platform.

### Security & robustness notes

- **No shell interpolation.** Every process is spawned with `spawn(bin, argv,
  { shell: false })` — the URL and all options are passed as separate argv
  entries, so user input can never be interpreted as shell syntax.
- **Strict URL validation.** Only real YouTube hosts are accepted, the 11-char
  video id is extracted, and a brand-new canonical URL is rebuilt before it ever
  reaches yt-dlp. Nothing the user typed is forwarded verbatim.
- **Allow-listed options.** Resolution, audio format, and bitrate are all checked
  against fixed allow-lists.
- **Isolated temp dirs.** Each job writes to `os.tmpdir()/ytdl-<uuid>` and the
  directory is deleted after the file is streamed, on error, or after a TTL.
- **Concurrency cap.** At most 3 downloads run at once (see
  `MAX_CONCURRENT_DOWNLOADS` in `lib/ytdlp.ts`); further requests get a 429.
- **Clear errors.** Age-restricted / private / unavailable videos and a missing
  `yt-dlp`/`ffmpeg` binary are surfaced as readable messages in the UI.

---

## System dependencies

You must have **yt-dlp** and **ffmpeg** installed and on your `PATH`. They are
_not_ bundled — install them with your OS package manager.

**Arch / Linux (yay):**

```bash
yay -S yt-dlp ffmpeg
# or, on plain Arch:
sudo pacman -S yt-dlp ffmpeg
```

**macOS (Homebrew):**

```bash
brew install yt-dlp ffmpeg
```

**Windows:**

```powershell
winget install yt-dlp.yt-dlp ffmpeg
# or with Chocolatey / Scoop:
choco install yt-dlp ffmpeg
scoop install yt-dlp ffmpeg
```

> **Keep yt-dlp updated.** YouTube changes frequently and an out-of-date yt-dlp
> is the most common cause of failed downloads. Update it often:
>
> ```bash
> yt-dlp -U            # if installed as a standalone binary
> # or reinstall via your package manager, e.g.
> yay -S yt-dlp        # Arch
> brew upgrade yt-dlp  # macOS
> ```

If the binaries aren't on `PATH` (common on Windows, where a freshly-installed
tool isn't visible to already-open shells), point the app at them explicitly.
Create a `.env.local` file in the project root — Next.js loads it into the
server process, bypassing `PATH` entirely:

```dotenv
# .env.local
YTDLP_PATH=C:\Users\you\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_...\yt-dlp.exe
FFMPEG_PATH=C:\Users\you\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_...\bin\ffmpeg.exe
```

- `YTDLP_PATH` — full path to the yt-dlp binary (defaults to `yt-dlp` on PATH).
- `FFMPEG_PATH` — full path to ffmpeg; passed to yt-dlp as `--ffmpeg-location`
  so merging/extraction works even when ffmpeg isn't on PATH.

Find the exact paths with:

```powershell
(Get-Command yt-dlp).Source
(Get-Command ffmpeg).Source
```

> Changes to `.env.local` require a **server restart** to take effect.

---

## Setup & run

Requires **Node.js 18.17+** (Node 20+ recommended).

```bash
npm install

# development
npm run dev
# → open http://localhost:3000

# production
npm run build
npm run start
```

Other scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
```

---

## Deploying

> ⚠️ **This app does NOT work on Vercel / Netlify / other serverless hosts.**
> It spawns `yt-dlp`/`ffmpeg`, streams large files, and keeps an in-memory job
> registry across requests — none of which survive a stateless, time-limited
> serverless function. You need a host that runs a **long-lived container/VM**
> where you can install the binaries.

The repo ships a **Dockerfile** that bundles Node + `ffmpeg` + `yt-dlp`, so the
image "just works" anywhere Docker runs (Render, Railway, Fly.io, a VPS…).

Build & run locally:

```bash
docker build -t yt-downloader .
docker run -p 3000:3000 yt-downloader
# → http://localhost:3000
```

**Render** (easiest free option):
1. Push this repo to GitHub.
2. Render → New → **Web Service** → connect the repo.
3. Runtime: **Docker** (it auto-detects the Dockerfile). Leave build/start blank.
4. Add env var `NEXT_PUBLIC_SITE_URL=https://<your-service>.onrender.com`.
5. Deploy.

**Railway:** New Project → Deploy from repo → it detects the Dockerfile → add
the same `NEXT_PUBLIC_SITE_URL` env var → deploy.

**Fly.io:** `fly launch` (uses the Dockerfile) → `fly deploy`.

> **Do NOT set `YTDLP_PATH` or `FFMPEG_PATH` on these hosts.** Those are only for
> pointing at binaries on your local Windows machine. In the Docker image both
> tools are already on `PATH`, so leaving the vars unset is correct. (Setting
> `YTDLP_PATH` to a Windows path is exactly what breaks a cloud deploy.)

---

## Project structure

```
app/
  layout.tsx            Root layout
  page.tsx              Single-page UI shell
  globals.css           Tailwind + base styles
  api/
    info/route.ts       POST  – fetch & normalize video metadata
    download/route.ts   POST  – start a yt-dlp job, return jobId
    progress/route.ts   GET   – SSE progress stream for a job
    file/route.ts       GET   – stream the finished file, then clean up
components/
  Downloader.tsx        Client component: input, info card, controls, progress
lib/
  types.ts              Shared interfaces (VideoInfo, ProgressEvent, …)
  validate.ts           URL/option validation + filename sanitization
  ytdlp.ts              yt-dlp/ffmpeg wrapper + in-memory job registry
```

The wrapper logic (`lib/ytdlp.ts`) is deliberately separated from the route
handlers so the process-spawning and progress-parsing can be tested in
isolation and the handlers stay thin.

---

## Format selection details

- **Video (≥1080p works):** uses a merging selector so it is never capped at the
  ~720p progressive stream:

  ```
  -f "bestvideo[height<=?H]+bestaudio/best[height<=?H]/best" --merge-output-format mp4
  ```

- **Audio:**

  ```
  -f bestaudio/best -x --audio-format mp3|m4a --audio-quality <bitrate>K
  ```

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| "Required binary … was not found on PATH" | Install yt-dlp / ffmpeg, or set `YTDLP_PATH`. |
| Downloads suddenly failing for many videos | Update yt-dlp (`yt-dlp -U`). |
| "age-restricted", "private", "unavailable" | The video genuinely can't be fetched anonymously. |
| Stuck at 100% then "Merging…" | Normal — ffmpeg is muxing video + audio. |
| "server is busy" (429) | Concurrency cap hit; retry shortly or raise `MAX_CONCURRENT_DOWNLOADS`. |
