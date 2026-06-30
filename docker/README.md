# Plex Poster Helper - Docker Guide

Run Plex Poster Helper on a server (unraid, a NAS, any computer with Docker) so it's
always available and can sync posters on a schedule. No coding required - follow the
steps below in order.

**You only need one container: the web UI.** It serves the full app in your browser
(no VNC) and runs the scheduler 24/7. Sign in with Plex to access the app.

**In this guide:**
[Setup](#step-1---get-the-files) · [unraid](#unraid) · [Updating](#updating-to-a-new-version) · [Everyday commands](#everyday-commands) · [FAQ](#faq--help)

---

## Before you start

You need **Docker** installed and running:

- **Windows / Mac:** install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and open it.
- **unraid / Linux / NAS:** Docker is built in (unraid) or install Docker Engine.

You'll also want your **Plex login** ready (you sign in during setup - no token hunting needed).

---

## Step 1 - Get the files

```bash
git clone https://github.com/molexxxx/plex-poster-set-helper-2.git
cd plex-poster-set-helper-2
```

---

## Step 2 - Start the web UI

**Windows (PowerShell):**
```powershell
./docker/run.ps1
```
**Mac / Linux:**
```bash
./docker/run.sh
```

**Docker Compose:**
```bash
docker compose -f docker/docker-compose.yml up -d --build
```

When it finishes, open in your browser:

### → http://localhost:3939

> **Running this on a server, NAS, or unraid box?** Open `http://YOUR-SERVER-IP:3939`
> from any device on your network. Sign in with Plex when prompted.

---

## Step 3 - Sign in to Plex

1. In the app, go to **Settings → Sign in with Plex**.
2. Click **Copy** on the sign-in link, open it in a browser, sign in, and click **Approve**.
3. The app connects automatically. All libraries are included by default.
   To exclude a library, uncheck it in **Settings → Libraries**.

That's it - open **Library Browser** and start applying posters. Schedules run 24/7
in this container.

---

## unraid

No build needed - runs from the prebuilt image
[`tonywied17/plex-poster-helper-2`](https://hub.docker.com/r/tonywied17/plex-poster-helper-2).

### Easiest: Community Applications

1. Open **Apps** and search **Plex Poster Helper**.
2. Click **Install**. Map a host path (e.g. `/mnt/user/appdata/plex-poster-helper-2`) to
   **/config**, set **TZ**, and leave the port at **3939** unless taken.
3. Apply, click **WebUI**, and do [Step 3](#step-3---sign-in-to-plex).

### Manual template import

1. **Docker → Add Container → Template:** import [`docker/unraid-template.xml`](unraid-template.xml).
2. Map **/config**, set **TZ**, start, and click **WebUI**.

---

## Updating to a new version

Your settings, schedules, and history live in the config volume, so they survive every update.

**Run script:**
```bash
git pull
./docker/run.sh --build          # Windows: ./docker/run.ps1 -Build
```

**Docker Compose:**
```bash
git pull
docker compose -f docker/docker-compose.yml up -d --build
```

**unraid:** **Docker** tab → container → **Force update**.

---

## Everyday commands

Run script:
```bash
./docker/run.sh                           # start (or restart) the web UI
./docker/run.sh --stop                    # stop & remove (data stays)
PORT=8095 ./docker/run.sh               # different host port
docker logs -f plex-poster-helper-2       # live logs
```

Docker Compose:
```bash
docker compose -f docker/docker-compose.yml up -d        # start (or restart)
docker compose -f docker/docker-compose.yml down         # stop & remove (data stays)
docker compose -f docker/docker-compose.yml logs -f      # live logs
```

---

## FAQ & Help

<details>
<summary><b>What is the data folder / volume?</b></summary>

Everything the app remembers - Plex login, schedules, applied-poster history, and
downloaded Chromium - lives under `/config` (mapped to a host folder or the `ppsh-config`
volume). Back it up and you've backed up the app.
</details>

<details>
<summary><b>Port 3939 is taken.</b></summary>

`PORT=8095 ./docker/run.sh` or change the host side of the port mapping to `8095:3939`.
</details>

<details>
<summary><b>The page won't load on first start.</b></summary>

Give it ~20 seconds on first boot (Chromium may be downloading). Refresh the page.
</details>

<details>
<summary><b>Who can access the app?</b></summary>

Anyone on your network who can reach the port must sign in with Plex before using any
features. Your Plex token is stored in the config volume.
</details>
