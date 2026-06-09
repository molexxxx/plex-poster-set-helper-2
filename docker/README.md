# Plex Poster Helper - Docker Guide

Run Plex Poster Helper on a server (unraid, a NAS, any computer with Docker) so it's
always available and can sync posters on a schedule. No coding required - follow the
steps below in order.

There are two ways to run it. **Start with the GUI.**

| | What it is | When to use |
| --- | --- | --- |
| **GUI** | The full app, in your web browser | Start here - set up Plex, browse, follow creators, build schedules |
| **Headless** | Just the scheduler, no window | Optional add-on - keeps your schedules running 24/7 in the background |

---

## Before you start

You need **Docker** installed and running:

- **Windows / Mac:** install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and open it.
- **unraid / Linux / NAS:** Docker is built in (unraid) or install Docker Engine.

You'll also want your **Plex login** ready (you sign in during setup - no token hunting needed for the GUI).

---

## Step 1 - Get the files

Open a terminal (PowerShell on Windows) and run:

```bash
git clone https://github.com/tonywied17/plex-poster-set-helper.git
cd plex-poster-set-helper
```

> No git? Download the project ZIP from GitHub (green **Code** button -> **Download ZIP**),
> unzip it, and open a terminal in that folder.

---

## Step 2 - Start the GUI

Pick your OS - this builds the app the first time (a few minutes) and starts it:

**Windows (PowerShell):**
```powershell
./docker/run.ps1
```
**Mac / Linux / unraid:**
```bash
./docker/run.sh
```

Prefer Docker Compose? `docker compose -f docker/docker-compose.yml up -d --build gui`

When it finishes it prints a link. Open it in your browser:

### -> http://localhost:3939

(From another device, use your server's IP: `http://YOUR-SERVER-IP:3939`.)

---

## Step 3 - Sign in to Plex

1. In the app, go to **Settings -> Sign in with Plex**.
2. It shows a **sign-in link**. Click **Copy**, paste it into a browser on your own
   computer or phone, sign in, and click **Approve**.
3. Back in the app it connects automatically. All your libraries are included by default.
   To exclude a specific library from matching, scraping, and the browser, uncheck it in
   **Settings → Libraries**.

That's it - open **Library Browser** and start applying posters.

---

## Updating to a new version

Your settings, schedules, and history are safe (they live in a separate data volume).

```bash
git pull
./docker/run.ps1            # Windows  (or ./docker/run.sh)
```
Compose: `docker compose -f docker/docker-compose.yml up -d --build gui`

---

## unraid

1. **Docker -> Add Container -> Template:** import
   [`docker/unraid-template.xml`](unraid-template.xml).
2. Map a host path (e.g. `/mnt/user/appdata/plex-poster-helper`) to **/config**.
3. Leave the web port at **3939** (change it only if that port is taken).
4. Set **TZ** to your timezone.
5. Start it and click **WebUI**, then do Step 3 above.

---

## Optional - keep schedules running 24/7 (headless)

The GUI container already runs your schedules while it's up. The **headless** image is a
lighter, window-less version for people who want the scheduler running on its own.

**Workflow:**

1. **First, build your schedules in the GUI** (Scheduler tab) and sign in to Plex there.
2. Then start the headless container pointing at the **same data folder** - it picks up
   your saved Plex credentials and jobs automatically:

```bash
docker compose -f docker/docker-compose.yml --profile headless up -d --build headless
```

Or with plain Docker:
```bash
docker run -d --name ppsh-scheduler \
  -e TZ=America/New_York \
  -v /path/to/your/config:/config \
  --shm-size=1g --restart unless-stopped \
  plex-poster-helper:headless
```

> **Tip:** If the headless container shares the same `/config` volume as the GUI, it
> automatically reuses the Plex credentials you signed in with — no env vars needed.
> `PLEX_BASEURL` and `PLEX_TOKEN` are optional overrides useful for first-run or
> environments where you can't share a volume.

**Settings explained:**

| Setting | Needed? | What it does |
| --- | --- | --- |
| `PLEX_BASEURL` | Optional | Override the Plex server address (e.g. `http://192.168.1.10:32400`). Not needed when sharing a config volume with the GUI. |
| `PLEX_TOKEN` | Optional | Override the Plex token. Not needed when sharing a config volume with the GUI. [How to find it](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/). |
| `TZ` | Recommended | Your timezone, so jobs run at the right *local* time (see below). |

### How scheduling & timezone work

- **What** runs and **when** (the day/time) comes from the jobs you built in the GUI -
  they're saved in the shared `/config` folder. You don't re-enter them here.
- Those times are clock times like "every Monday at 9:00." The container decides **which
  timezone that 9:00 is in** using `TZ`.
- If you don't set `TZ`, the container uses **UTC** - so "9:00" would fire at 9:00 UTC,
  which may be the middle of your night. Set `TZ` to your zone so 9:00 means *your* 9:00.

**`TZ` examples:** `America/New_York`, `America/Los_Angeles`, `Europe/London`,
`Australia/Sydney` ([full list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones#List)).

> You can run the GUI and headless containers at the same time against the same
> `/config` - use the GUI to manage, the headless one to run.

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
<summary><b>Port 3939 is taken / I want a different port.</b></summary>

Windows: `./docker/run.ps1 -Port 8095` -> open `http://localhost:8095`.
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
automatically pick up the saved credentials — no env vars needed. If you're running
headless standalone (separate volume or no GUI), set `PLEX_BASEURL` and `PLEX_TOKEN`
environment variables so it knows where to connect.
</details>

<details>
<summary><b>Posters apply to the wrong title (anime / HAMA libraries).</b></summary>

MediUX matches by TMDB id. For libraries using a TVDB/IMDb agent (e.g. anime via HAMA),
add a free TMDB API key in **Settings -> Library Browser**.
</details>

<details>
<summary><b>How do I see logs or stop it?</b></summary>

```bash
docker logs -f plex-poster-helper   # live logs
docker stop plex-poster-helper      # stop
docker start plex-poster-helper     # start again
./docker/run.ps1 -Stop              # stop & remove (your data stays)
```
</details>
