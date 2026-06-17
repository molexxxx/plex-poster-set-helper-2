# Changelog

Release notes for Plex Poster Set Helper 2. The Build & Release workflow reads the
section whose heading matches the pushed tag and uses it as the GitHub release body,
so keep each version under its own `## What's new in vX.Y.Z` heading.

## What's new in v2.1.2

### Anime (HAMA) now matches MediUX automatically
Anime libraries using the **HAMA** agent tag titles with an AniDB ID, which TMDB can't look up directly. The Library Browser would show "No TMDB match" and tell you to add a TMDB key, even when one was already set, and a key wouldn't have helped anyway. The app now converts AniDB IDs to TMDB automatically using a cached community AniDB→TMDB dataset (downloaded once and refreshed weekly), so HAMA anime resolves and finds its MediUX sets, no TMDB key required. HAMA's IMDb-style IDs are recognized too.

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
