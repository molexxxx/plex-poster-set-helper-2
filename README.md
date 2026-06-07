<h1 align="center">Plex Poster Set Helper</h1>

<p align="center">
  Browse, download, and apply custom poster sets from <b>MediUX</b> and <b>ThePosterDB</b> to your Plex library - in a clean desktop app.
</p>

<p align="center">
  <a href="https://github.com/tonywied17/plex-poster-set-helper"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tonywied17/tonywied17/main/.github/badges/plex-poster-helper-repo-dark.svg"><img src="https://raw.githubusercontent.com/tonywied17/tonywied17/main/.github/badges/plex-poster-helper-repo-light.svg" alt="repo" /></picture></a>&nbsp;
  <a href="docker/README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tonywied17/tonywied17/main/.github/badges/plex-poster-helper-docker-dark.svg"><img src="https://raw.githubusercontent.com/tonywied17/tonywied17/main/.github/badges/plex-poster-helper-docker-light.svg" alt="docker guide" /></picture></a>&nbsp;
  <a href="https://github.com/tonywied17/plex-poster-set-helper/actions/workflows/ci.yml"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tonywied17/tonywied17/main/.github/badges/plex-poster-helper-ci-dark.svg"><img src="https://raw.githubusercontent.com/tonywied17/tonywied17/main/.github/badges/plex-poster-helper-ci-light.svg" alt="CI" /></picture></a>&nbsp;
  <a href="LICENSE"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tonywied17/tonywied17/main/.github/badges/plex-poster-helper-license-dark.svg"><img src="https://raw.githubusercontent.com/tonywied17/tonywied17/main/.github/badges/plex-poster-helper-license-light.svg" alt="license" /></picture></a>&nbsp;
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tonywied17/tonywied17/main/.github/badges/plex-poster-helper-last-commit-dark.svg"><img src="https://raw.githubusercontent.com/tonywied17/tonywied17/main/.github/badges/plex-poster-helper-last-commit-light.svg" alt="last commit" /></picture>
</p>

---

## What it does

Plex Poster Set Helper finds high‑quality poster artwork for the movies and shows already in your Plex library and applies it with a click - posters, season posters, episode title cards, and backdrops, all routed to the right place automatically.

- 🗂️ **Library Browser** - browse your Plex library, pick a title, and see every matching MediUX set. Filter by uploader, preview every image, and apply with one click.
- 👤 **Creators** - follow your favorite MediUX uploaders and browse their newest sets.
- 📥 **Manual Import** - paste ThePosterDB / MediUX links (or a bulk list) and upload posters directly.
- ⏰ **Scheduler** - set posters to re‑apply on a schedule (great for shows that get new episodes), running in the background or on a server.
- ↩️ **Reset Posters** - see everything you've applied, where it came from, and revert any of it back to Plex's original art.
- 🔑 **One‑click Plex sign‑in** - no hunting for tokens.

> Works on **Windows** and **Linux** as a desktop app, and runs in **Docker** (including unraid) for always‑on servers.

---

## Getting started

You have three ways to run it - pick whichever fits you.

### Option 1 - Download the app (easiest)

1. Go to the **[Releases page](https://github.com/tonywied17/plex-poster-set-helper/releases/latest)**.
2. Download the installer for your system:
   - **Windows** → the `.exe` installer
   - **Linux** → the `.AppImage` or `.deb`
3. Install and launch it.
4. On first run, open **Settings → Sign in with Plex**, click the link, approve in your browser - done. Your libraries appear automatically.

> _Packaged installers are published on the Releases page. If there isn't one yet, use Option 2 below._

### Option 2 - Run from source

You'll need **[Node.js 22+](https://nodejs.org/)** installed.

```bash
git clone https://github.com/tonywied17/plex-poster-set-helper.git
cd plex-poster-set-helper
npm install
npm run dev
```

The app window opens. Go to **Settings → Sign in with Plex** to connect.

### Option 3 - Docker (servers / unraid / always‑on scheduling)

Run the full app in your browser via Docker, or run a lightweight headless scheduler that keeps your weekly poster syncs going 24/7.

👉 **[Read the Docker guide →](docker/README.md)**

---

## First‑run setup

1. **Sign in to Plex** - Settings → *Sign in with Plex* → click the link → approve. (No token copy‑paste needed.)
2. **Confirm your libraries** - they're detected automatically after sign‑in.
3. *(Optional)* **Anime / non‑TMDB libraries** - if your library uses an agent without TMDB IDs (e.g. HAMA), add a free **TMDB API key** in Settings so titles can be matched.

That's it - head to the **Library Browser** and start applying posters.

---

## How it works

| Source | What you can use |
|---|---|
| **[MediUX](https://mediux.pro)** | Set links (`/sets/123`), and creator pages (`/user/name`). Full‑quality artwork, including season posters, title cards, and backdrops. |
| **[ThePosterDB](https://theposterdb.com)** | Set links (`/set/123`), single posters (`/poster/123`), and user uploads (`/user/name`). |

Posters are matched to your library by **TMDB ID** (read from each Plex item), so the right art lands on the right title. Everything you apply is tracked locally so the **Reset** page always knows what to revert and where it came from.

---

## Feature tour

**Library Browser** - Two modes: *My Library* (browse your Plex items and see all sets for each) and *Creators* (follow MediUX uploaders). Sets expand to preview every poster grouped by type; click any image to view it full‑screen. Applied sets are clearly marked.

**Manual Import** - Paste links or load a saved list, scrape them, then upload all - or just the **new** posters you haven't applied yet. Previews are grouped by type and show which posters are already in your library.

**Scheduler** - Create cron‑style jobs that re‑apply sets automatically. Pair it with the Docker headless image to keep them running without leaving the app open. See the [Docker guide](docker/README.md).

**Reset Posters** - A searchable list of everything you've applied, with source badges and thumbnails. Reset one item or all of them back to Plex's original artwork.

---

## Building & development

```bash
npm run dev          # run the app in development (hot reload)
npm run build        # build renderer + main process
npm run dist         # package installers for the current OS (electron-builder)
npm run dist:win     # Windows installer
npm run dist:linux   # Linux AppImage + deb
npm run typecheck    # type-check renderer + main process
npm run lint         # eslint
```

**Stack:** Electron · React 18 · TypeScript · Vite · Playwright (scraping) · electron‑store. See **[`.docs/refactor.md`](.docs/refactor.md)** for the full architecture and roadmap.

---

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck` and `npm run lint` before opening a PR.

## License

[MIT](LICENSE) © tonywied17

## Credits

- **[MediUX](https://mediux.pro)** and **[ThePosterDB](https://theposterdb.com)** - the communities behind the artwork.
- Originally inspired by the Python `plex-poster-set-helper`; rebuilt from the ground up as a cross‑platform desktop app.
