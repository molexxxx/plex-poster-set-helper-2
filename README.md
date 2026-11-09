<p align="center">
  <img src="https://raw.githubusercontent.com/molexxxx/plex-poster-set-helper-2/main/.github/assets/logo.svg" width="120" alt="Plex Poster Set Helper 2 logo" />
</p>

<h1 align="center">Plex Poster Set Helper 2</h1>

<p align="center">
  Find community poster art on <b>MediUX</b> and <b>ThePosterDB</b> and apply it to your Plex library in one click.<br />
  A desktop app for Windows and Linux, or a web app in Docker for always-on servers.
</p>

<p align="center">
  <a href="https://github.com/molexxxx/plex-poster-set-helper-2/releases/latest"><img height="28" src="https://raw.githubusercontent.com/molexxxx/molexxxx/main/.github/badges/plex-poster-helper-2-release-plex.svg?v=96e09d62" alt="Latest release" /></a>&nbsp;
  <a href="https://github.com/molexxxx/plex-poster-set-helper-2/releases"><img height="28" src="https://raw.githubusercontent.com/molexxxx/molexxxx/main/.github/badges/plex-poster-helper-2-downloads-plex.svg?v=fd231d5f" alt="Downloads" /></a>&nbsp;
  <a href="https://github.com/molexxxx/plex-poster-set-helper-2/actions/workflows/ci.yml"><img height="28" src="https://raw.githubusercontent.com/molexxxx/molexxxx/main/.github/badges/plex-poster-helper-2-ci-plex.svg?v=efd3be62" alt="CI status" /></a>&nbsp;
  <a href="docker/README.md"><img height="28" src="https://raw.githubusercontent.com/molexxxx/molexxxx/main/.github/badges/plex-poster-helper-2-docker-plex.svg?v=328f8c36" alt="Docker guide" /></a>&nbsp;
  <a href="LICENSE"><img height="28" src="https://raw.githubusercontent.com/molexxxx/molexxxx/main/.github/badges/plex-poster-helper-2-license-plex.svg?v=85b68ada" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="https://molexxxx.github.io/plex-poster-set-helper-2/"><img width="172" src="https://raw.githubusercontent.com/molexxxx/plex-poster-set-helper-2/main/.github/assets/button-website.svg?v=2" alt="Visit the website" /></a>
</p>

<p align="center">
  <a href="https://molexxxx.github.io/plex-poster-set-helper-2/docs/">Docs</a> &nbsp;·&nbsp; <a href="https://molexxxx.github.io/plex-poster-set-helper-2/changelog/">Changelog</a>
</p>

## What it does

Pick a movie, show, or collection from your Plex library, browse every poster set the MediUX and ThePosterDB communities have made for it, and apply one with a click. Posters, season posters, episode title cards, backdrops, and collection art each land on the right item, and a schedule can keep them current as new episodes and uploads arrive.

<p align="center">
  <img width="410" src="https://raw.githubusercontent.com/molexxxx/plex-poster-set-helper-2/main/.github/assets/card-library.svg" alt="Library Browser: pick a title and see every MediUX and ThePosterDB set for it, most downloaded first, then apply in one click." />
  <img width="410" src="https://raw.githubusercontent.com/molexxxx/plex-poster-set-helper-2/main/.github/assets/card-creators.svg" alt="Creators: follow or hide uploaders on both sites, browse their sets, and keep a MediUX creator synced." />
  <img width="410" src="https://raw.githubusercontent.com/molexxxx/plex-poster-set-helper-2/main/.github/assets/card-scheduler.svg" alt="Scheduler: keep sets and creators synced on any schedule, from the tray, at login, or on a Docker server." />
  <img width="410" src="https://raw.githubusercontent.com/molexxxx/plex-poster-set-helper-2/main/.github/assets/card-manual.svg" alt="Manual Import: paste MediUX or ThePosterDB links, or a bulk list, preview by type, and upload all or only what's new." />
  <img width="410" src="https://raw.githubusercontent.com/molexxxx/plex-poster-set-helper-2/main/.github/assets/card-reset.svg" alt="Reset Posters: a searchable log of everything you've applied, with a one-click revert to Plex's original artwork." />
  <img width="410" src="https://raw.githubusercontent.com/molexxxx/plex-poster-set-helper-2/main/.github/assets/card-signin.svg" alt="One-click Plex sign-in: sign in through Plex in your browser, with no token hunting. Your libraries are found for you." />
</p>

## Install

You need a Plex Media Server and a Plex account that can manage it.

| You want to | Use |
|---|---|
| Use it on your Windows or Linux PC | [Desktop app](#desktop-app) |
| Keep schedules running 24/7 on a server or NAS, from any browser | [Docker](#docker) |
| Run it on Unraid | [Unraid](#unraid) |
| Use it on a Mac | [Docker](#docker), since there is no macOS desktop build |

### Desktop app

1. Download the installer for your system from the **[latest release](https://github.com/molexxxx/plex-poster-set-helper-2/releases/latest)**. Both are 64-bit (x64) builds.
   - **Windows:** the `.exe` installer
   - **Linux:** the `.AppImage` or the `.deb`
2. Install and launch it, then follow [First run](#first-run).

The app checks GitHub for new versions and updates itself with one click.

### Docker

The Docker build runs the full app as a web page, and its schedules keep firing for as long as the container is up.

```bash
git clone https://github.com/molexxxx/plex-poster-set-helper-2.git
cd plex-poster-set-helper-2
./docker/run.sh
```

On Windows, run `./docker/run.ps1` in PowerShell for the last step. Then open `http://localhost:3939` and sign in with Plex.

The script builds the image from your checkout and keeps your settings in a Docker volume. A prebuilt image, [`tonywied17/plex-poster-helper-2`](https://hub.docker.com/r/tonywied17/plex-poster-helper-2), is also published with every release. The **[Docker guide](docker/README.md)** walks through each step and covers Compose and everyday commands.

### Unraid

Install it from **Community Applications**: search for _Plex Poster Helper_ in the **Apps** tab ([listing](https://ca.unraid.net/apps/plex-poster-helper-2-1qbjs0q1mmwhy6)). It pulls the prebuilt image and adds a **WebUI** button, so no commands are needed.

## First run

1. **Browser check.** The app ships with the Chromium headless shell it uses to read the poster sites, so the first launch only checks that it starts. Nothing is downloaded. If the check fails, see [Troubleshooting](#troubleshooting-and-support).
2. **Sign in to Plex.** Open **Settings → Plex → Account → Sign in with Plex** and approve the request in your browser; the Docker web page asks you to sign in as soon as it opens. Your server is detected automatically and every library is included. To leave one out, switch it off under **Settings → Plex → Libraries**.
3. **Add a TMDB API key** (optional, recommended). A free [TMDB API key](https://www.themoviedb.org/settings/api) fixes most matching problems for titles Plex stores without a TMDB ID. The first launch offers a step to paste one, or add it later under **Settings → Artwork → Title matching**. See [How matching works](#how-matching-works).

That's it: open the **Library Browser** and start applying posters.

## Library Browser

Pick a title and its MediUX and ThePosterDB sets appear in one list, each tagged with its site, with chips to show just one. Sets are listed most downloaded first: MediUX by its download counts, which each card shows, and ThePosterDB in the site's own downloads order, with the two sites alternating rank by rank when both are shown.

- **Follow or hide creators** with the star and eye on any set card. Followed creators come first and hidden ones drop out of every list. The **Creators** view lists who you follow and shows a MediUX creator's whole catalog as a poster wall checked against your library, with each title's sets side by side.
- **Find what still needs attention.** The art filter narrows the grid to titles with or without applied art, art that no job keeps updated, or art from a particular creator. On TV tabs, a status filter separates **Continuing** series from **Ended** ones, using TMDB when a key is set and otherwise whether an episode aired in the last year.
- **Collections** have their own tab, with collection art from both sites.
- **Link a set.** When neither site finds a title, or finds the wrong thing, the link button in the sets panel takes a MediUX or ThePosterDB link and attaches its sets to the title: a set, a poster (its set is used), or the title's own page on either site to take every set listed there. Linked sets list first and are remembered until unlinked.
- **One poster per slot.** A set that carries several posters for the same place in Plex, such as collection art for a franchise and its spin-off, applies one of them: from a collection, the one named after it; otherwise the first. The expanded preview marks the one that will be applied, and a click on another poster's check mark picks it instead.
- **Collection sets from a single movie.** Open a movie that belongs to a collection set and Apply puts that movie's own poster on it, even when you don't have the rest of the collection; when you do, the card can apply to every movie you own. The collection poster goes to the Plex collection it names, and when Plex has no matching collection the card says so and leaves that poster out.
- **Open a set or poster on its site.** The button at the end of each set card opens the set's page, and hovering a poster in the expanded preview shows a button that opens it: its own page on ThePosterDB, or its set on MediUX, which has no page per poster.
- **Fits small screens.** When the window is under 800 pixels tall or 1100 wide, measured after display scaling (a 1366x768 laptop, or a 1080p screen at 150%), the page buttons move into the status bar so they never cover content. Larger windows keep the floating dock, which moves aside for the sets panel. **Settings → App → Navigation dock** switches between **Automatic** (the default), **Floating** everywhere, and **Status bar** everywhere.
- **Ctrl+F** opens the command palette to jump to any page, setting, schedule, or creator, or to paste a link.

## Keeping posters up to date

The **Scheduler** re-applies sets and creators on a repeating schedule, so new episode title cards and new uploads get art without a trip back to the app.

- **Quick sync:** click **Schedule** on any set, or **Set up sync…** on a MediUX creator, which asks whether to start from today's uploads or apply the whole catalog now. Repeat clicks never stack duplicate jobs, a creator's sets share one job, and **Settings → Artwork → Schedule and Sync timing** picks the schedule these buttons start with.
- **Whole MediUX catalogs:** a creator job reads every set the creator has published. The first run crawls the catalog once, which takes a few minutes for a prolific creator; later runs only read pages with new or updated sets, and a first crawl cut short resumes where it stopped. A creator job that starts from today applies only sets added or updated since, and where a title has several sets they apply oldest to newest, so the newest ends up on top.
- **Only apply new artwork** (on by default) skips posters already applied to an item, so Plex doesn't pile up duplicates. **Only fill gaps** makes a job a backup creator that adds only what other art doesn't cover.
- **One at a time, in order:** jobs never overlap. Jobs due together run in the order shown on the Scheduler page, which you set with **Run earlier** and **Run later** in each job's menu, and **Run now** goes ahead of anything waiting. **Stop** ends a running job and keeps what it already applied. When two creators cover the same show, put your preferred one first and give the other **Only fill gaps**.
- **Any schedule:** hourly, daily, weekly on chosen days, monthly, or a custom cron expression, with a preview of the next runs. Each job keeps its 10 most recent runs; open one to see which titles got art, which failed, and which aren't in your library.
- **Where it runs:** the desktop app runs schedules while it's open or minimized to the tray, and **Launch at login** in **Settings → App** starts it with your computer. For schedules that run around the clock without a PC left on, use [Docker](#docker).

## Updating

Your Plex sign-in, schedules, and applied-poster history survive every update. The desktop app keeps them in your user profile, and Docker keeps them in its config volume.

- **Desktop app:** accept the in-app update, or download the latest installer from [Releases](https://github.com/molexxxx/plex-poster-set-helper-2/releases/latest).
- **Docker:** pull the new code and rebuild. On Windows, run `./docker/run.ps1 -Build` for the last step.

  ```bash
  git pull
  ./docker/run.sh --build
  ```

  Compose steps are in the [Docker guide](docker/README.md#updating-to-a-new-version).
- **Unraid:** in the **Docker** tab, open the container and choose **Force update**.

## Troubleshooting and support

- **The first-launch browser check fails.** The setup screen explains why and offers fixes. On Linux it shows the exact command for any missing system libraries, and on any platform you can pick an installed Google Chrome, Edge, Brave, or Chromium instead. **Settings → Advanced → Browser engine** also has a managed download that retries automatically, detects system proxies, and can be canceled.
- **A title gets no match or the wrong art.** Use the link button in the sets panel to attach the right set, or the title's page on either site, to that title. For matching in general, add a TMDB API key (see [How matching works](#how-matching-works)), and use **Title Mappings** to point a site's title at the right Plex title. For a newly added anime under HAMA, **Update now** on the anime ID list in **Settings → Artwork → Title matching** fetches the newest mappings. It is a legacy tool: turn on **Settings → App → Legacy tools** to show it.
- **Anything else.** The log drawer shows what the app is doing, and **Open Log Folder** in the command palette opens the full logs. If you're stuck, [open an issue](https://github.com/molexxxx/plex-poster-set-helper-2/issues) with the relevant log lines.

## Supported links

Scheduled jobs and **Manual Import** accept links from both sites. Manual Import is a legacy tool; **Settings → App → Legacy tools** shows it.

| Site | Links |
|---|---|
| **[MediUX](https://mediux.pro)** | Sets (`/sets/123`), boxsets (`/boxsets/123`, a whole collection at once), show pages (`/shows/123`), and creator pages (`/user/name`). Full-quality posters, season posters, title cards, and backdrops. |
| **[ThePosterDB](https://theposterdb.com)** | Sets (`/set/123`), single posters (`/poster/123`), and user uploads (`/user/name`). |

The link button in the Library Browser's sets panel accepts the same set and poster links, plus a title's own page on either site (`mediux.pro/movies/123`, `mediux.pro/shows/123`, `theposterdb.com/posters/123`), to attach every set listed there to a title.

## How matching works

Posters are matched to your library by **TMDB ID**, read from each Plex item, so the right art lands on the right title. For titles Plex stores without a TMDB ID, or under a TVDB or IMDb agent, a free TMDB API key restores ID-based matching; without one the app falls back to title and year, which can miss renamed or subtitled entries. Anime under the **HAMA** agent, which tags titles with an AniDB ID, is converted to TMDB automatically using the open-source [Fribb/anime-lists](https://github.com/Fribb/anime-lists) dataset, so it matches without a key. The list downloads the first time a HAMA title needs it and updates once a week, the same pace it is published; **Settings → Artwork → Title matching** shows when it was downloaded, updates it on demand, and can turn the weekly update off. ThePosterDB has no public ID search, so its sets are always found by title and year, and every entry the site holds under that title is read, since it often has duplicates.

Everything you apply is recorded locally, so the **Reset Posters** page knows what's current, what was applied before, and where it came from, and can restore Plex's original artwork.

## Screenshots

<details>
<summary>Show screenshots</summary>
<br />
<table>
  <tr>
    <td width="50%"><a href=".github/assets/gallery/library-browser.png"><img src=".github/assets/gallery/thumbs/library-browser.jpg" width="400" alt="Library Browser on the TV Shows tab with the sets panel open for Abbott Elementary, listing MediUX sets with download counts" /></a><br /><sub>Library Browser</sub></td>
    <td width="50%"><a href=".github/assets/gallery/creators.jpg"><img src=".github/assets/gallery/thumbs/creators.jpg" width="400" alt="Creators view showing a followed MediUX creator's catalog as a poster wall, filtered to titles in the library" /></a><br /><sub>Creators</sub></td>
  </tr>
  <tr>
    <td><a href=".github/assets/gallery/creators-shelf.jpg"><img src=".github/assets/gallery/thumbs/creators-shelf.jpg" width="400" alt="A title's shelf open in the Creators view, with the creator's sets for it and the files in the picked set" /></a><br /><sub>A title's sets and files</sub></td>
    <td><a href=".github/assets/gallery/creators-sync.jpg"><img src=".github/assets/gallery/thumbs/creators-sync.jpg" width="400" alt="Sync settings for a creator: when it runs, whether it starts from new uploads, and Only fill gaps" /></a><br /><sub>Creator sync</sub></td>
  </tr>
  <tr>
    <td><a href=".github/assets/gallery/collections.jpg"><img src=".github/assets/gallery/thumbs/collections.jpg" width="400" alt="Collections tab with the sets panel open for a movie collection, offering to apply art to the collection and its movies" /></a><br /><sub>Collections tab</sub></td>
    <td><a href=".github/assets/gallery/command-palette.jpg"><img src=".github/assets/gallery/thumbs/command-palette.jpg" width="400" alt="Command palette listing pages and quick actions" /></a><br /><sub>Command palette</sub></td>
  </tr>
  <tr>
    <td><a href=".github/assets/gallery/library-search.jpg"><img src=".github/assets/gallery/thumbs/library-search.jpg" width="400" alt="Command palette searching the library for titles" /></a><br /><sub>Library search</sub></td>
    <td><a href=".github/assets/gallery/log-drawer.jpg"><img src=".github/assets/gallery/thumbs/log-drawer.jpg" width="400" alt="Log drawer open at the bottom of the Library Browser" /></a><br /><sub>Log drawer</sub></td>
  </tr>
  <tr>
    <td><a href=".github/assets/gallery/scheduler.jpg"><img src=".github/assets/gallery/thumbs/scheduler.jpg" width="400" alt="Scheduler with the job list beside the selected creator sync, its schedule, last run, and recent runs" /></a><br /><sub>Scheduler</sub></td>
    <td><a href=".github/assets/gallery/scheduler-editor.jpg"><img src=".github/assets/gallery/thumbs/scheduler-editor.jpg" width="400" alt="Job editor with the link, a weekly schedule and its next runs, and the job options" /></a><br /><sub>Job editor</sub></td>
  </tr>
  <tr>
    <td><a href=".github/assets/gallery/manual-import.jpg"><img src=".github/assets/gallery/thumbs/manual-import.jpg" width="400" alt="Manual Import with a scraped MediUX set, its already applied poster marked Applied" /></a><br /><sub>Manual Import (legacy tool)</sub></td>
    <td><a href=".github/assets/gallery/title-mappings.jpg"><img src=".github/assets/gallery/thumbs/title-mappings.jpg" width="400" alt="Title Mappings page pointing Plex titles at the names the poster sites use" /></a><br /><sub>Title Mappings (legacy tool)</sub></td>
  </tr>
  <tr>
    <td><a href=".github/assets/gallery/reset-posters.jpg"><img src=".github/assets/gallery/thumbs/reset-posters.jpg" width="400" alt="Reset Posters page listing applied art by title" /></a><br /><sub>Reset Posters</sub></td>
    <td><a href=".github/assets/gallery/settings.jpg"><img src=".github/assets/gallery/thumbs/settings.jpg" width="400" alt="Settings on the Plex section: account, server, and libraries" /></a><br /><sub>Settings</sub></td>
  </tr>
  <tr>
    <td><a href=".github/assets/gallery/settings-artwork.jpg"><img src=".github/assets/gallery/thumbs/settings-artwork.jpg" width="400" alt="Settings on the Artwork section: MediUX art types, Library Browser options, and the TMDB key" /></a><br /><sub>Settings, Artwork</sub></td>
    <td></td>
  </tr>
</table>
</details>

## Development

Running from source needs an LTS release of **Node.js, 22.13 or newer**.

```bash
git clone https://github.com/molexxxx/plex-poster-set-helper-2.git
cd plex-poster-set-helper-2
npm install
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app with hot reload |
| `npm test` | Runs the unit tests (Vitest) |
| `npm run lint` | Lints with ESLint |
| `npm run typecheck` | Type-checks the renderer, main process, and web server |
| `npm run build` | Builds the renderer and main process |
| `npm run dist:win` | Packages the Windows installer |
| `npm run dist:linux` | Packages the Linux AppImage and deb |

To update a source checkout, run `git pull` and `npm install`, then `npm run dev`.

**Stack:** Electron, React 19, TypeScript, Vite, Tailwind, Playwright for scraping, and Fastify for the web and Docker server.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm run lint`, `npm run typecheck`, and `npm test`; CI runs all three and builds the app.

## License and credits

[MIT](LICENSE) © molexxxx

- **[MediUX](https://mediux.pro)** and **[ThePosterDB](https://theposterdb.com)**, the communities behind the artwork.
- Inspired by [bbrown430/plex-poster-set-helper](https://github.com/bbrown430/plex-poster-set-helper), the original Python tool, and rebuilt from the ground up as a cross-platform app.
