# Plex Poster Helper - Docker Guide

Run Plex Poster Helper on a server (unraid, a NAS, any computer with Docker) so it's
always available and can sync posters on a schedule. No coding required - follow the
steps below in order.

**You only need one container: the GUI.** It runs the full app in your browser and keeps
your schedules firing 24/7 for as long as it's up. Manage it from any device on your
network - your laptop, phone, whatever - without a monitor or desktop on the server.

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

Open a terminal (PowerShell on Windows) and run:

```bash
git clone https://github.com/tonywied17/plex-poster-set-helper-2.git
cd plex-poster-set-helper-2
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

When it finishes it prints two links. Open either in your browser:

### → http://localhost:3939 &nbsp;·&nbsp; https://localhost:3940

> **Running this on a server, NAS, or unraid box?** You don't sit at that machine. The GUI
> is a web app, so open it from any device on your network at `http://YOUR-SERVER-IP:3939`
> (or `https://YOUR-SERVER-IP:3940`). That browser tab *is* the app: sign in, browse, and
> build schedules from there.
>
> **Want copy & paste between your computer and the app?** Use the **https** link (port
> 3940). Browsers only allow clipboard access on secure pages, so the http link can't
> offer it. Two things to know:
> - Type the `https://` prefix explicitly - a bare `localhost:3940` defaults to http and
>   shows a "400 Bad Request - plain HTTP request sent to HTTPS port" error.
> - The certificate is self-signed, so your browser shows a warning the first time. Click
>   **Advanced → Proceed** once and you're set. No extra setup needed.

---

## Step 3 - Sign in to Plex

1. In the app, go to **Settings → Sign in with Plex**.
2. It shows a **sign-in link**. Click **Copy**, paste it into a browser on your own
   computer or phone, sign in, and click **Approve**.
3. Back in the app it connects automatically. All your libraries are included by default.
   To exclude a specific library from matching, scraping, and the browser, uncheck it in
   **Settings → Libraries**.

That's it - open **Library Browser** and start applying posters. Your schedules run 24/7
right from this GUI container, so there's nothing else to set up.

---

## unraid

1. **Build the image** on your unraid box (Terminal, from the cloned repo - see Step 1):
   ```bash
   docker build -f docker/Dockerfile -t plex-poster-helper .
   ```
2. **Docker → Add Container → Template:** import
   [`docker/unraid-template.xml`](unraid-template.xml).
3. Map a host path (e.g. `/mnt/user/appdata/plex-poster-helper`) to **/config**.
4. Leave the ports at **3939** (http) and **3940** (https) unless they're taken. The
   **WebUI** button uses the https port so clipboard copy & paste works - accept the
   self-signed certificate warning the first time.
5. Set **TZ** to your timezone.
6. Start it and click **WebUI**, then do [Step 3](#step-3---sign-in-to-plex) above.

---

## Updating to a new version

Your settings, schedules, and history are safe - they live in the config volume, which
updates never touch. Updating is always the same three beats: **pull, rebuild, restart**.

**Windows (PowerShell):**
```powershell
git pull
./docker/run.ps1 -Build
```

**Mac / Linux:**
```bash
git pull
./docker/run.sh --build
```

**Docker Compose:**
```bash
git pull
docker compose -f docker/docker-compose.yml up -d --build gui
```

**unraid (template install):**
```bash
cd /path/to/plex-poster-set-helper-2
git pull
docker build -f docker/Dockerfile -t plex-poster-helper .
```
Then restart the container from the **Docker** tab - it picks up the rebuilt image.

---

## Everyday commands

One reference for the run scripts (Windows: same commands with `./docker/run.ps1` and
`-Build` / `-Stop` / `-Port 8095` instead of the `--flags`):

```bash
./docker/run.sh                           # start (or restart) the GUI
./docker/run.sh --stop                    # stop & remove the container (your data stays)
PORT=8095 HTTPS_PORT=8096 ./docker/run.sh # use different web ports (http / https)
```

And the underlying container, if you prefer plain Docker:

```bash
docker logs -f plex-poster-helper   # live logs
docker stop plex-poster-helper      # stop (docker start … to resume)
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
<summary><b>Port 3939 or 3940 is taken / I want different ports.</b></summary>

Windows: `./docker/run.ps1 -Port 8095 -HttpsPort 8096` → open `http://localhost:8095`
(or `https://localhost:8096` for clipboard support).
Mac/Linux: `PORT=8095 HTTPS_PORT=8096 ./docker/run.sh`. Compose/unraid: change the host
side of the port mappings (`8095:3000` for http, `8096:3001` for https).
</details>

<details>
<summary><b>Copy & paste doesn't work / clipboard is blocked.</b></summary>

Open the app over **https** - `https://YOUR-SERVER-IP:3940` (note the `https://` prefix).
Browsers only allow clipboard access on secure pages, so on the plain http port the
clipboard is blocked and the permission prompt never appears. Accept the self-signed
certificate warning once (**Advanced → Proceed**), then click anywhere in the app -
your browser asks for clipboard permission. Click **Allow** and copy & paste works
both ways from then on.

Per-browser notes:
- **Chrome / Edge / Brave** - the permission prompt appears on your first click.
- **Vivaldi** - a Vivaldi bug suppresses the prompt. Allow it manually: padlock icon
  in the address bar → **Site settings → Clipboard → Allow**, then reload.
- **Firefox / Safari** - no seamless clipboard support (a KasmVNC limitation). Use the
  clipboard panel in the side bar (arrow on the left edge) to transfer text manually.
</details>

<details>
<summary><b>"400 Bad Request - The plain HTTP request was sent to HTTPS port".</b></summary>

You opened the https port (3940) without the `https://` prefix, so the browser sent
plain http to it. Type the full URL: `https://YOUR-SERVER-IP:3940`.
</details>

<details>
<summary><b>The page is black or won't load on first start.</b></summary>

Give it ~20 seconds on the first boot (it's starting the desktop and downloading
Chromium). Refresh the page. Make sure the port is mapped and not already in use.
</details>

<details>
<summary><b>The first-run Chromium download finished but the setup screen is stuck.</b></summary>

Restart the container (`docker restart plex-poster-helper`) - the browser is already
downloaded to the config volume and gets picked up immediately on the next start. The
download is one-time; it never runs again once installed.
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
<summary><b>Schedules fire at the wrong time.</b></summary>

Set `TZ` to your timezone (e.g. `America/New_York`) - the run scripts detect it from your
host automatically; for Compose or plain `docker run` set it manually. Without it the
container uses UTC and "9:00" fires at 9:00 UTC.
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
`./docker/run.ps1 -Stop`) to stop and remove the container. Your data stays.
</details>

---

> **Headless scheduler (optional)**
> A lighter, window-less image that runs only the scheduler if you prefer not to keep the full GUI container running.
> Start it with `./docker/run.sh headless` (or `./docker/run.ps1 headless`) after signing in via the GUI at least once -
> it shares the same config volume so no extra setup is needed. Stop it with `--stop headless`; the GUI takes over within ~90s.
