# Plex Poster Helper - Docker Guide

Run Plex Poster Helper on a server (unraid, a NAS, any computer with Docker) so it's
always available and can sync posters on a schedule. No coding required - follow the
steps below in order.

**You only need one container: the GUI.** It's the full app in your browser, and it keeps
running your schedules 24/7 for as long as it's up - so for most people it's the whole
solution. You manage it from any device's browser over your network; the server itself
never needs a monitor or a desktop.

There's an **optional** second container - a headless (window-less) scheduler - for people
who'd rather not keep the full desktop running just to fire jobs. It shares the GUI's
sign-in and schedules automatically. Most users can ignore it.

| | What it is | Do you need it? |
| --- | --- | --- |
| **GUI** | The full app in your browser: sign in, browse, follow creators, build schedules. Also runs those schedules 24/7. | **Yes** - this is the app. |
| **Headless** | A lighter, window-less copy of *just* the scheduler, sharing the GUI's sign-in and schedules. | **Optional** - only if you'd rather run the scheduler without keeping the full desktop alive. |

**In this guide:**
[Setup](#step-1---get-the-files) ·
[Headless scheduler](#optional---run-the-scheduler-without-the-desktop-headless) ·
[unraid](#unraid) ·
[Updating](#updating-to-a-new-version) ·
[Everyday commands](#everyday-commands) ·
[FAQ](#faq--help)

---

## Before you start

You need **Docker** installed and running:

- **Windows / Mac:** install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and open it.
- **unraid / Linux / NAS:** Docker is built in (unraid) or install Docker Engine.

You'll also want your **Plex login** ready (you sign in during setup - no token hunting needed).

---

## Step 1 - Get the files

Open a terminal (PowerShell on Windows) and run:

```bash
git clone https://github.com/tonywied17/plex-poster-set-helper.git
cd plex-poster-set-helper
```

> No git? Download the project ZIP from GitHub (green **Code** button → **Download ZIP**),
> unzip it, and open a terminal in that folder.

---

## Step 2 - Start the GUI

Pick your OS - this builds the app the first time (a few minutes) and starts it:

**Windows (PowerShell):**
```powershell
./docker/run.ps1
```
**Mac / Linux:**
```bash
./docker/run.sh
```

> **On unraid?** The run script works, but the native [template setup](#unraid) is nicer -
> you get a proper Docker-tab entry with a **WebUI** button.
>
> **Prefer Docker Compose?** `docker compose -f docker/docker-compose.yml up -d --build gui`
> - just stick with one method, since the script and Compose keep their data in
> [different places](#faq--help).

When it finishes it prints a link. Open it in your browser:

### → http://localhost:3939

> **Running this on a server, NAS, or unraid box?** You don't sit at that machine. The GUI
> is a web app, so open it from any device on your network - your laptop, phone, whatever -
> at `http://YOUR-SERVER-IP:3939`. That browser tab *is* the app: sign in, browse, and build
> schedules from there. The server itself never needs a screen or a desktop.

---

## Step 3 - Sign in to Plex

1. In the app, go to **Settings → Sign in with Plex**.
2. It shows a **sign-in link**. Click **Copy**, paste it into a browser on your own
   computer or phone, sign in, and click **Approve**.
3. Back in the app it connects automatically. All your libraries are included by default.
   To exclude a specific library from matching, scraping, and the browser, uncheck it in
   **Settings → Libraries**.

That's it - open **Library Browser** and start applying posters. Your schedules already
run 24/7 from this GUI container. If you'd rather offload them to a lighter, desktop-free
container, there's an optional [headless scheduler](#optional---run-the-scheduler-without-the-desktop-headless) below.

---

## Optional - run the scheduler without the desktop (headless)

**You can skip this whole section.** The GUI container already runs your schedules 24/7
while it's up - it's a complete solution on its own. The **headless** image is just a
lighter, window-less alternative that runs *only* the scheduler, so you're not keeping a
full KasmVNC desktop alive around the clock to fire a couple of cron jobs.

It's a one-command add-on: the run scripts give the GUI and the scheduler the **same
config volume** (`ppsh-config`), so the scheduler automatically reuses the Plex sign-in
and the schedules you built in the GUI. Nothing to copy, no tokens to hunt down.

1. **First, sign in and build your schedules in the GUI** (Scheduler tab).
2. Then add the scheduler:

**Windows (PowerShell):**
```powershell
./docker/run.ps1 headless
```
**Mac / Linux:**
```bash
./docker/run.sh headless
```
**unraid:** import the dedicated
[scheduler template](unraid-template-headless.xml) instead - see the
[unraid section](#unraid).

Want everything up in one go (fresh server, after a reboot)? Use `both`:

```bash
./docker/run.sh both          # PowerShell: ./docker/run.ps1 both
```

**They won't trip over each other.** When the headless scheduler is up it claims the
"engine" role (a small heartbeat file in the shared config), and the GUI defers all
automatic runs to it - so a job never fires twice. The GUI becomes your **editor and
dashboard**: schedule changes you make there are picked up by the engine within ~30s, with
no restart. The Scheduler tab shows a banner when an engine is running. Manual **Run now**
in the GUI always runs locally, on demand.

**Going back to GUI-only is just stopping the headless container** (`--stop headless`, see
[Everyday commands](#everyday-commands)) - no need to delete the image. Within ~90s its
heartbeat goes stale, the banner clears, and the GUI quietly takes the schedules back over.
Nothing is lost; the jobs live in the shared config and keep firing, just from the GUI again.

<details>
<summary><b>Docker Compose instead</b></summary>

Both services in [`docker-compose.yml`](docker-compose.yml) share `./config`, so the
same auto-sharing applies:

```bash
docker compose -f docker/docker-compose.yml --profile headless up -d --build headless   # scheduler only
docker compose -f docker/docker-compose.yml --profile headless up -d --build            # GUI + scheduler
```
</details>

<details>
<summary><b>Plain <code>docker run</code> instead</b></summary>

Mount the **same volume the GUI uses** (`ppsh-config` if you used the run scripts):

```bash
docker run -d --name plex-poster-helper-scheduler \
  -e TZ=America/New_York \
  -v ppsh-config:/config \
  --shm-size=1g --restart unless-stopped \
  plex-poster-helper:headless
```
</details>

> **Running headless without the GUI?** Set `PLEX_BASEURL` and `PLEX_TOKEN` env vars so
> it knows where to connect. They're optional overrides - never needed when the GUI
> shares the config volume.

**Settings explained:**

| Setting | Needed? | What it does |
| --- | --- | --- |
| `TZ` | Recommended | Your timezone, so jobs run at the right *local* time (see below). |
| `PLEX_BASEURL` | Optional | Override the Plex server address (e.g. `http://192.168.1.10:32400`). Not needed when sharing a config volume with the GUI. |
| `PLEX_TOKEN` | Optional | Override the Plex token. Not needed when sharing a config volume with the GUI. [How to find it](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/). |

### How scheduling & timezone work

- **What** runs and **when** (the day/time) comes from the jobs you built in the GUI -
  they're saved in the shared `/config` folder. You don't re-enter them here.
- Those times are clock times like "every Monday at 9:00." The container decides **which
  timezone that 9:00 is in** using `TZ`.
- If you don't set `TZ`, the container uses **UTC** - so "9:00" would fire at 9:00 UTC,
  which may be the middle of your night. Set `TZ` to your zone so 9:00 means *your* 9:00.
- The **run scripts detect `TZ` from your host automatically** (on Windows the timezone
  is converted to the IANA name containers expect). You only set it by hand for Compose,
  plain `docker run`, or the unraid templates.

**`TZ` examples:** `America/New_York`, `America/Los_Angeles`, `Europe/London`,
`Australia/Sydney` ([full list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones#List)).

> You don't need both containers - the GUI already runs your schedules 24/7. Add the
> headless one only if you want a lighter, always-on runner; they share the same `/config`.

---

## unraid

1. **Build the image** on your unraid box (Terminal, from the cloned repo - see Step 1):
   ```bash
   docker build -f docker/Dockerfile -t plex-poster-helper:gui .
   ```
2. **Docker → Add Container → Template:** import
   [`docker/unraid-template.xml`](unraid-template.xml).
3. Map a host path (e.g. `/mnt/user/appdata/plex-poster-helper`) to **/config**.
4. Leave the web port at **3939** (change it only if that port is taken).
5. Set **TZ** to your timezone.
6. Start it and click **WebUI**, then do [Step 3](#step-3---sign-in-to-plex) above.

**Optional - add the headless scheduler.** A second template runs the headless scheduler as
its own unraid container. Keep its **Config path identical to the GUI's** - that's the
whole trick: same folder, so it reuses your Plex sign-in and schedules automatically.

```bash
docker build -f docker/Dockerfile.headless -t plex-poster-helper:headless .
```

Then import [`docker/unraid-template-headless.xml`](unraid-template-headless.xml), leave
the Config path at the same `/mnt/user/appdata/plex-poster-helper`, set **TZ**, and start
it. No ports, no WebUI - check it with the container's log button. (`PLEX_BASEURL` /
`PLEX_TOKEN` in Advanced are only for running it *without* the GUI - leave them empty.)

---

## Updating to a new version

Your settings, schedules, and history are safe - they live in the config volume, which
updates never touch. Updating is always the same three beats: **pull, rebuild, restart**
(the commands below do all three).

**Windows (PowerShell):**
```powershell
git pull
./docker/run.ps1 -Build              # GUI only
./docker/run.ps1 both -Build         # GUI + headless scheduler
```

**Mac / Linux:**
```bash
git pull
./docker/run.sh --build              # GUI only
./docker/run.sh both --build         # GUI + headless scheduler
```

**Docker Compose:**
```bash
git pull
docker compose -f docker/docker-compose.yml up -d --build gui                   # GUI only
docker compose -f docker/docker-compose.yml --profile headless up -d --build    # GUI + headless
```

**unraid (template install):**
```bash
cd /path/to/plex-poster-set-helper
git pull
docker build -f docker/Dockerfile -t plex-poster-helper:gui .
docker build -f docker/Dockerfile.headless -t plex-poster-helper:headless .   # only if you use the scheduler
```
Then restart the container(s) from the **Docker** tab - they pick up the rebuilt images.

---

## Everyday commands

One reference for the run scripts (Windows: same commands with `./docker/run.ps1` and
`-Build` / `-Stop` / `-Port 8095` instead of the `--flags`):

```bash
./docker/run.sh                  # start (or restart) the GUI
./docker/run.sh headless         # add the optional headless scheduler
./docker/run.sh both             # start GUI + scheduler together
./docker/run.sh both --build     # rebuild after an update
./docker/run.sh --stop           # stop & remove both (your data stays)
./docker/run.sh --stop headless  # …or stop just one
PORT=8095 ./docker/run.sh        # use a different web port
```

And the underlying containers, if you prefer plain Docker:

```bash
docker logs -f plex-poster-helper             # live GUI logs
docker logs -f plex-poster-helper-scheduler   # live scheduler logs
docker stop plex-poster-helper                # stop (docker start … to resume)
```

---

## FAQ & Help

<details>
<summary><b>I've never used Docker - what am I doing?</b></summary>

You're running the app in a self-contained "box" so it doesn't touch the rest of your
system. You don't install anything except Docker - the box already has everything. You
give it one folder for its data and one web port, and that's it.
</details>

<details>
<summary><b>What is the data folder / volume?</b></summary>

Everything the app remembers - your Plex login, followed creators, schedules,
applied-poster history, and downloaded Chromium - lives in one place (a Docker volume
named `ppsh-config`, or the host folder you mapped to `/config`). Back it up and you've
backed up the app. It survives updates and restarts.
</details>

<details>
<summary><b>I switched between the run script and Compose and my settings vanished.</b></summary>

They keep data in two different places: the run scripts use a named Docker volume
(`ppsh-config`), while Compose uses the `docker/config` folder in the repo. Nothing is
lost - it's just in the other store. Switch back to the method you started with, and
stick with one going forward.
</details>

<details>
<summary><b>Port 3939 is taken / I want a different port.</b></summary>

Windows: `./docker/run.ps1 -Port 8095` → open `http://localhost:8095`.
Mac/Linux: `PORT=8095 ./docker/run.sh`. Compose/unraid: change the host side of the port
mapping (`8095:3000`).
</details>

<details>
<summary><b>The page is black or won't load on first start.</b></summary>

Give it ~20 seconds on the first boot (it's starting the desktop and downloading
Chromium). Refresh the page. Make sure the port is mapped and not already in use.
</details>

<details>
<summary><b>Sign-in says "we were unable to complete this request."</b></summary>

Use the **Copy** button on the link in the app and open that exact link - don't retype
it. Then sign in and Approve. If it expired, click Sign in again for a fresh link.
</details>

<details>
<summary><b>Scrapes fail / Chromium crashes.</b></summary>

Make sure the container has `--shm-size=1g` (or `shm_size: "1gb"` in compose). Chromium
crashes with Docker's tiny default shared memory.
</details>

<details>
<summary><b>Headless can't connect to Plex.</b></summary>

If the headless container shares the same `/config` volume as the GUI it will
automatically pick up the saved credentials - no env vars needed. Make sure you've
signed in via the GUI at least once. If you're running headless standalone (separate
volume or no GUI), set `PLEX_BASEURL` and `PLEX_TOKEN` environment variables so it
knows where to connect.
</details>

<details>
<summary><b>Schedules fire at the wrong time.</b></summary>

That's almost always timezone: the container thinks "9:00" means 9:00 in *its* zone.
Set `TZ` to yours (see [How scheduling & timezone work](#how-scheduling--timezone-work))
and restart the container.
</details>

<details>
<summary><b>Posters apply to the wrong title (anime / HAMA libraries).</b></summary>

MediUX matches by TMDB id. For libraries using a TVDB/IMDb agent (e.g. anime via HAMA),
add a free TMDB API key in **Settings → Library Browser**.
</details>

<details>
<summary><b>How do I see logs or stop it?</b></summary>

See [Everyday commands](#everyday-commands) - short version:
`docker logs -f plex-poster-helper` for logs, `./docker/run.sh --stop` (or
`./docker/run.ps1 -Stop`) to stop and remove the containers. Your data stays.
</details>
