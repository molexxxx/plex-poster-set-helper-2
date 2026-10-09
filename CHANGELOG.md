# Changelog

Release notes for Plex Poster Set Helper 2. The Build & Release workflow reads the
section whose heading matches the pushed tag and uses it as the GitHub release body,
so keep each version under its own `## What's new in vX.Y.Z` heading.

## What's new in v2.6.0

### Creator syncs read the whole catalog
A **Sync all** job for a creator only read the first page of their MediUX catalog, about 12 sets, so most of a prolific creator's shows were never applied even though the job reported success. Creator jobs now read every set, through the same cache the Creators view uses: the first run crawls the full catalog once, and later runs only fetch the pages that carry new or updated sets. A page that fails to load now counts as an error instead of looking like the end of the catalog, which also stops the Creators view from showing a short list on a slow connection.

### Jobs run one at a time
Jobs no longer run at the same time. When several are due together they run in the order shown on the Scheduler page, and the arrows on each card set that order. A job that is waiting shows as **Queued**, and **Run now** puts a job ahead of anything waiting. When two creators cover the same show, the job that runs later applies last.

### Only fill gaps
A new option for a backup creator. A job with **Only fill gaps** leaves any poster, season, or episode that other art already covers, whether from another job or something you applied by hand, and adds only what is missing. Put your main creator first in the list and give the backup this option. Art applied before this release does not record which episodes it filled, so it counts as covering the whole show.

### See what a run is doing and what it did
While a job runs, its card shows where it is: reading a creator's sets with a running count, or the show it is applying and how far through the catalog it is. Each run now records which titles got artwork, which failed, and which are not in your library. Open a job's recent runs and click a run to see the lists.

### Applied badges for creator syncs
Artwork applied by a creator sync is now recorded against its MediUX set, so the Library Browser shows the **Applied** and **Downloaded** badges for it, the same as a manual apply.

## What's new in v2.5.0

### Scheduling works over plain HTTP
Opening the Docker or unRAID web UI by its LAN address (for example `http://192.168.1.50:3939`) made **New Job**, the **Schedule** button on a set, and **Sync all weekly** silently do nothing, because browsers hide an API the scheduler relied on unless the page is served over HTTPS. Scheduling now works from any address.

### Smarter scheduled runs
- **Only new artwork:** each run now skips posters already applied to an item, so repeat syncs stop re-uploading the same images and Plex no longer piles up duplicate copies. Existing jobs switch to this behavior too; turn off **Only apply new artwork** on a job to re-apply the full set every run.
- Runs reconnect to Plex when the connection dropped (for example, when the container started before Plex) and say so clearly when they can't.
- A run that couldn't read any of its URLs is now reported as failed instead of succeeding with nothing applied, and a run with some failures shows as partly failed.
- The same job never runs twice at once, and jobs cut off by a shutdown are marked as interrupted instead of showing as running forever.

### A clearer Scheduler page
- Pick hourly, daily, weekly on any mix of days, monthly, or a custom cron expression, with a live preview of the next three runs. When the server runs in a different time zone than your browser, which is common in Docker, the editor says so.
- Each job shows its status, next and last run, and what the last run did, such as "3 posters applied · 118 already applied". Open **Recent runs** to see the last 10.
- URLs and schedules are checked as you type, duplicate URLs are removed, and errors explain what to fix. **Save & run** saves and starts a job in one step, Ctrl+Enter saves, and deleting asks for confirmation.
- **Run now** returns right away, and progress shows on the job card.

### Quick sync from the Library Browser
- **Schedule** on a set and **Sync all** on a creator share one default schedule, which you can change under **Scheduler → Quick sync**.
- Clicking again never creates duplicate jobs. A creator's selected sets are grouped into one job, and syncing all of a creator replaces their individual sets.
- **Scheduled** tags open the job in the Scheduler, and failures show right on the set.

### Security fix for the web UI
The web and Docker API accepted configuration changes without signing in, so any device that could reach the web UI could change settings, including the Plex server address, which could expose your Plex token. Changing configuration now requires a signed-in session.

### Under the hood
Electron 44.7, Vite 8.3.4, Vitest 5, typescript-eslint 8.71, and the rest of the development toolchain are updated. axios moves to 1.20.0, and shell-quote and http-cache-semantics are patched for the advisories published against them.

## What's new in v2.4.1

### Linux AppImage starts in sandboxed launchers again
The v2.4.0 AppImage stored its folders with owner-only permissions. Launching it normally was unaffected, but launchers that mount the image with the kernel's own driver, such as firejail, could not reach the app and stopped with "Permission denied". The release build now unpacks and repacks the image with its permissions intact and refuses to publish an AppImage that any user could not open.

### AppImage catalog listing
The AppStream file now uses the name the AppImage catalog reads, so the catalog page shows the app's summary, description, and a screenshot of the Library Browser.

### Under the hood
The browser executable check now handles Windows-style paths on every platform, and CI runs the unit tests on every push. undici is updated to 7.30.0 and brace-expansion to 1.1.21, 2.1.7, and 5.0.12, clearing the denial-of-service advisories published against both.

## What's new in v2.4.0

### Chromium ships with the app
First-run setup no longer downloads a browser. The Chromium headless shell that powers scraping is now bundled inside the Windows installer, the Linux AppImage and deb, and the Docker image, so a fresh install only runs a quick launch check and opens straight away. Existing installs pick up the bundled copy automatically.

### Setup that recovers instead of hanging
For the cases where a download is still needed, such as reinstalling from Settings, the installer was rebuilt from the ground up. It retries with backoff, watches for stalled downloads and stops them instead of waiting forever, detects system proxies, checks free disk space and folder permissions up front, and never treats a half-extracted browser as installed. When something does go wrong, the setup screen says what happened and how to fix it: no internet, a blocked download, a full disk, antivirus interference, or, on Linux, the exact package command for any missing system libraries. You can also switch to Google Chrome, Microsoft Edge, Brave, or Chromium if one is already installed, or point the app at any Chromium-based executable, from either the setup screen or **Settings → Browser Engine**.

### Linux AppImage improvements
The AppImage now uses the current static AppImage runtime, so it starts on stock Ubuntu 22.04 and 24.04 without installing libfuse2. It carries update information and ships with a companion .zsync file, so AppImageUpdate and compatible tools can update it in place, and it includes AppStream metadata for software centers and the AppImage catalog. The file is now named Plex-Poster-Set-Helper-2-<version>-x86_64.AppImage.

### Web mode hardening
The web and Docker API now rate limits requests per client, with a much smaller budget on the browser install and verification endpoints, and it only lets a client switch the scraping browser to one the server itself detected. Browsing for any other executable is a desktop-only action through the native file picker, and every stored browser path is re-validated before use.

### Dependency updates
Electron 44, Playwright 1.63, Fastify 5.12.5, React 19.3, Vite 8.3, and the rest of the toolchain are current, which clears every open security advisory.
## What's new in v2.3.0

### Collection posters apply correctly from the Collections tab
Browsing a Plex collection and applying a set that only carried a single collection-level poster used to do nothing - the poster was silently dropped and Apply no-oped. Those posters now apply to the collection, the **Apply collection poster** checkbox shows up for them, and its default scope enables it. The MediUX scraper also no longer mistakes a lone collection poster whose title includes a year (like "TRON (1982)") for a per-movie poster when the set has no other movies to route to.

### Smoother Library Browser side panel
Switching between titles in the Library Browser no longer jerks the panel around. Instead of sliding the old panel out while the new one slides in over it, the panel now stays put and its title and contents crossfade to the newly selected item. Clicking a poster card also keeps that card in view after the panel opens, rather than letting the grid reflow shift it off screen.

Thanks to @SanchoBlaze for the collection-poster fixes.

## What's new in v2.2.9

### Settings layout polish
The **General** and **Application** settings use a tighter, more modern layout: each option's control now sits compact and aligned on the right instead of stretching into an oversized full-width button, and the helper text gets the full row width so it no longer crams into a few narrow lines. The helper text was also tuned to be easier to read.

### Pagination polish
The pinned page controls on the **Reset Posters** and **Creators** views now blend flush with the background. The bottom fade behind them spans edge to edge instead of showing a boxed-in strip with a gap around it.

## What's new in v2.2.8

### Smoother pagination
The paginated lists in the **Reset Posters** page and the **Creators** browser are cleaner to navigate. Changing pages now snaps the list back to the top and the rows just appear, instead of the old row-by-row slide-in animation. The page controls now sit pinned at the bottom, flanking the floating dock, while the list scrolls cleanly underneath both, so the pager is always in reach without hiding your content.

### Readable Settings hints
The small helper text under each Settings field (like the TMDB API key note) was too dark and too small to read comfortably. It's now a lighter, slightly larger style.

## What's new in v2.2.7

### Cleaner Current Plex Art
The **Current Plex Art** strip no longer floods with unrelated posters. If a movie belonged to a large or smart collection - the kind Kometa builds, like "Trending Movies", "Top Pirated Movies", or "Metacritic Must See" - the strip used to pull in every member of those collections, burying the movie's own art under dozens of unrelated titles. It now shows only genuine franchise collections (Toy Story, Harry Potter) with their sibling movies and skips those organizational buckets entirely.

### Smoother Library Browser
Resizing, opening, and closing the Sets panel no longer shuffles and squishes the library thumbnails. The grid now snaps cleanly to its new width in one step instead of reflowing every frame, dragging the panel edge tracks the cursor without stutter, and the last poster column keeps a proper gap from the panel instead of tucking underneath it.

### Paginated Reset Posters
The **Reset Posters** list is now paginated (20 rows at a time) instead of rendering your entire applied-poster history at once, so large histories stay fast and smooth. This also fixes a bug where a long list would squish every row down to an unreadable sliver instead of scrolling.

## What's new in v2.2.6

### Fixed applying MediUX sets to movies and shows in the Library Browser
Applying a MediUX set to a movie or show from the Library Browser failed silently. The Apply button now correctly uploads the set's posters, backdrops, and title cards to the selected title. Collections were unaffected.

### Faster creator browsing with real pagination
Opening a MediUX creator no longer blocks on a full catalog crawl before showing anything. Sets now stream in as they are found, and the browser is **paginated** - only one page renders at a time, so even creators with thousands of sets stay fast and responsive instead of choking on one endless list. The crawl runs in the background, so you can switch creators or leave the Library Browser and come back to find it further along.

Creators are now **cached on disk** between launches: reopening one you've viewed before shows instantly with no loading spinner, and instead of re-scraping the whole catalog the app does a quick incremental check that only fetches genuinely new sets and stops as soon as it reaches ones you already have. Loading also no longer floods the log.

Thanks to @elliswalker for the crawl all creators and pagination work.

### Sort your library
The Library Browser grid has a new sort control: order any library (or your collections) by **Recently Added**, **Title**, **Release Year**, or **Last Played**, with a button to flip between ascending and descending. Your choice is remembered.

## What's new in v2.2.5

### Show or hide collections
A new **Collections** toggle under Settings → Libraries lets you hide Plex collections from the Library Browser (the Collections tab and collection results in search), the same way you include or exclude a library. It's on by default.

### Clearer in-app Docker update guide
The "Update your container" dialog is now organized into tabs by method (unraid, Docker Compose, run script) and opens to the one that best matches your system, showing the run-script command for your OS. The Docker guide documents the Compose update path too.

### Security hardening
An internal CodeQL pass: least-privilege permissions on the CI and release workflows, linear (non-backtracking) parsing of collection titles, and hostname-based URL matching in the scraper.

## What's new in v2.2.4

### Faster collection art in the Library Browser
Finding MediUX sets for a Plex collection is noticeably quicker. The member TMDB lookups and the per-set metadata fetches now run in parallel instead of one after another, and sets that were already scanned aren't re-fetched on the fallback passes.

### Browse current Plex art in a lightbox
The **Current Plex Art** strip is now clickable. Open any poster, season, or collection image full-screen and arrow through them with the same lightbox used elsewhere in the Library Browser.

### Docker: web UI only
The legacy headless scheduler container has been removed. The web UI already includes a built-in scheduler and is now the single supported container, so the Compose file, `run.sh` / `run.ps1` launchers, and unraid template are trimmed to match. The image no longer requests a 1 GB shared-memory bump (Chromium runs with `--disable-dev-shm-usage`, so the default is enough). Existing `/config` volumes carry over unchanged.

## What's new in v2.2.3

### Docker now ships the native web UI
The Docker image now builds and serves the native web UI on port `3939` instead of the old KasmVNC desktop. Open `http://<host>:3939` in your browser and sign in with Plex - no VNC client and no separate HTTPS port for clipboard support. The Compose file, `run.sh` / `run.ps1` launchers, and unraid template are all updated to the single 3939 port, and existing `/config` volumes carry over unchanged.

Thanks to @SanchoBlaze for the web UI Docker work.

## What's new in v2.2.2

### Windows desktop startup fixes
Packaged Windows builds no longer crash on launch (`electron-store` was ESM-only and incompatible with the packaged main process). Config now lives in `config.json` under your app data folder, with automatic migration from the old store file.

First-run Chromium setup, window visibility, and tray behaviour are more reliable on Windows. Startup diagnostics are written to `boot.log` in app data (or `%TEMP%\plex-poster-helper-boot.log`).

If the app seems to flash and quit, check Task Manager for leftover **Plex Poster Set Helper 2** processes from a previous run and end them before launching again.

## What's new in v2.2.0

### Plex collection posters
The Library Browser now has a **Collections** tab. Browse your Plex collections, discover matching MediUX sets, and apply a collection poster plus member movie posters in one go. Choose whether to update just the collection art, the child movies, or both.

### Current Plex Art strip
When you select a movie, show, or collection, a **Current Plex Art** row shows what's on Plex right now (poster, background, season art) so you can compare before applying a set.

### Library Browser layout
- Wider, resizable Sets panel (drag the left edge; width is remembered)
- Fluid layout that scales set previews and thumbnails with panel size
- MediUX set lists are cached for 30 minutes with a manual refresh button

### Docker / web mode
The Docker image now serves the app as a native web UI (no VNC desktop). Sign in with Plex to access the app in your browser.

## What's new in v2.1.2

### Anime (HAMA) now matches MediUX automatically
Anime libraries using the **HAMA** agent tag titles with an AniDB ID, which TMDB can't look up directly. The Library Browser would show "No TMDB match" and tell you to add a TMDB key, even when one was already set, and a key wouldn't have helped anyway. The app now converts AniDB IDs to TMDB automatically using the open-source [Fribb/anime-lists](https://github.com/Fribb/anime-lists) dataset (cached locally, downloaded once and refreshed weekly), so HAMA anime resolves and finds its MediUX sets, no TMDB key required. HAMA's IMDb-style IDs are recognized too.

### Clearer "no match" message
When an item genuinely can't be matched, the notice no longer tells you to add a TMDB key you already have. It now only suggests a key when one would actually help, and otherwise explains that the title's ID has no known TMDB mapping.

## What's new in v2.1.1

### Scheduled jobs now show poster previews in Reset Posters
Posters applied by a scheduled job were landing in the Reset Posters list with a blank placeholder instead of a thumbnail. Scheduled runs now record the poster preview (and the exact applied image URLs) just like a manual apply, so those items show their artwork and light up the "in library" markers. Items applied by earlier scheduled runs stay blank until the job runs again.

### Reset All keeps its progress when you leave the page
Starting a **Reset All** and navigating away no longer loses track of what's resetting. The reset now runs above the page, so leaving and coming back shows the live "Resetting… N/M" progress and each item's status, matching what the log already reported. Single resets survive navigation too.

## What's new in v2.1.0

### Reset Posters: free up space on your Plex server
The Reset Posters page can now delete the custom poster and background images this tool uploaded, not just switch the artwork back. Turn on **Delete uploaded images** and a reset also removes those uploaded files from your Plex server, then hit the new **Clean Bundles** button to reclaim the disk space right away instead of waiting on Plex's weekly maintenance.
- Clean Bundles tracks the real task and finishes exactly when Plex does, with no fixed wait.
- It stays available even after you've cleared every tracked poster.

### Reset Posters redesign
- Items now drop off the list on their own once reset, so there's no more hitting Refresh to see what's left.
- Source-colored rows (MediUX / ThePosterDB), larger poster thumbnails, and loading skeletons.
- With delete armed, the page and each row's button clearly warn before anything is removed.

### Sharper collection-set matching (MediUX)
Backdrops and title cards inside a MediUX collection set now route to the exact movie they belong to and match your library by **TMDB id**, recovering that id from the set's poster for the same movie. Fewer collection backdrops landing on the wrong item or going missing.

### Redesigned Browser Engine settings
The Chromium engine card got a fresh look: a little browser-window emblem with a live status light, the detected Chromium **build number**, and one-click **copy** for the executable path.

### Clearer Title Mappings guidance
When a TMDB API key is set, the Title Mappings page now confirms in green that the section is usually unnecessary (your library matches by id) while still letting you add a mapping as a fallback for the rare title that won't match on its own.

### Polish
- Reordered the dock so **Manual Import** sits before **Title Mappings**.
- Small layout fixes on the Library and Scheduler pages.

## What's new in v2.0.24

### Smarter matching for manual scrapes and bulk lists
Pasted MediUX links and saved bulk lists now match your library by **TMDB id** - the same exact matching the Library Browser uses - instead of guessing by title and year. That means fewer "not in library" misses and wrong-title applies, especially for TVDB/IMDb-agent libraries (such as anime via HAMA).

### Collection sets apply to the whole collection by default
Applying a MediUX collection set now spreads across every movie in the collection that's in your library, plus the collection poster, right out of the box. The per-set toggle still lets you narrow it back to just the title you're viewing.

### Redesigned manual import
- A cleaner tabbed header (**Scrape URLs** / **Bulk Files**) with a sliding indicator.
- A themed paste box - the stray white resize grip and chunky native scrollbar are gone.
- Quick **Browse** buttons open ThePosterDB and MediUX in your browser, right where you paste links.

### In-app Docker update guide
Docker and unraid builds can't self-update, and the container has no desktop to open a link on. The update notice now opens an in-app guide with copy-ready **pull, rebuild, restart** commands for unraid, Windows, Mac/Linux, and Compose.

### Now on unraid Community Applications
Install it straight from the unraid **Apps** tab - search _Plex Poster Helper_. It pulls the prebuilt Docker Hub image and gives you a WebUI button, no commands needed.

## What's new in v2.0.23

### Redesigned navigation: bottom dock
The left sidebar is gone, replaced by a floating dock at the bottom of the window. Navigation stays out of the way, pages get the full width, and the whole layout feels cleaner and more focused.

### Instant search (Ctrl/Cmd+F)
A new command palette puts everything a keystroke away. Press **Ctrl+F** (**Cmd+F** on macOS) from anywhere to:
- Jump straight to any page or Settings section
- Find a movie or show across all your libraries and open its MediUX sets
- Open a MediUX creator
No more hunting through menus.

### Smarter TMDB ID matching (optional API key)
Library matching now prefers exact TMDB IDs instead of guessing by title and year. Add a free TMDB v3 API key in **Settings** and the tool will:
- Match titles by ID, fixing most matching and title-mapping issues automatically
- Resolve TVDB/IMDb-agent libraries (such as anime via HAMA) to the correct TMDB entries

The key is optional. Without it, matching falls back to title and year as before.
