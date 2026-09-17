# Setting up the Flagmint SDK Tester (beginner-friendly guide)

This guide takes you from a freshly wiped Windows PC to the SDK Tester running in your
browser. Written for Windows; Mac/Linux notes are at the bottom.

You only need to type commands into a terminal. On Windows, the terminal is called
**PowerShell** — press the Windows key, type `powershell`, and press Enter to open it.

There are two ways to run the tester. **Docker is the recommended one** because it installs
the right versions of everything for you. If Docker gives you trouble, use the Node.js way
instead. You don't need both.

---

## Step 1 — Install Git (needed to download the code)

1. Go to https://git-scm.com/download/win and download the installer.
2. Run it and click Next through every screen. The defaults are fine.
3. Close and reopen PowerShell, then check it worked:

   ```powershell
   git --version
   ```

   You should see something like `git version 2.47.0`. If you see "not recognized",
   restart your PC and try again.

## Step 2 — Install Docker Desktop

1. Go to https://www.docker.com/products/docker-desktop and download **Docker Desktop for
   Windows**.
2. Run the installer. Leave the box **"Use WSL 2 instead of Hyper-V"** ticked.
3. It will ask you to restart your PC. Do that.
4. After restarting, open **Docker Desktop** from the Start menu. Accept the terms.
5. Wait until the whale icon in the bottom-left corner of the Docker window turns green and
   says **"Engine running"**. This takes a minute or two the first time.

If Docker Desktop complains that WSL 2 is missing, open PowerShell **as Administrator**
(right-click PowerShell → "Run as administrator") and run:

```powershell
wsl --install
```

Restart the PC, then open Docker Desktop again.

Check it worked:

```powershell
docker --version
```

> **Important:** Docker Desktop must be open and running (green "Engine running") every
> time you want to use the tester. If you close it, the tester won't start.

## Step 3 — Download the code

Pick a folder to keep your work in. These commands make a `code` folder in your user
directory and download the project into it:

```powershell
cd ~
mkdir code
cd code
git clone https://github.com/jtad009/flagmint-sdk-tester.git
cd flagmint-sdk-tester
```

If Git asks you to sign in to GitHub, a browser window will pop up — log in with your
GitHub account and it will continue on its own.

You are now "inside" the project folder. Every command below assumes you're here. If you
close PowerShell and come back later, get back here with:

```powershell
cd ~\code\flagmint-sdk-tester
```

## Step 4 — Start the tester with Docker

Make sure Docker Desktop is open and running, then:

```powershell
docker compose up dev
```

The first time will take a few minutes — Docker is downloading Node.js and installing the
project's packages. You'll see a lot of text scrolling by; that's normal.

Wait until you see something like:

```
VITE v8.0.3  ready in 412 ms
➜  Local:   http://localhost:5173/
```

Now open your browser and go to **http://localhost:5173**

That's it — the tester is running.

**To stop it:** click on the PowerShell window and press `Ctrl` + `C`.

**To start it again tomorrow:** open Docker Desktop, then run these two commands:

```powershell
cd ~\code\flagmint-sdk-tester
docker compose up dev
```

> Note: the README mentions `docker-compose up prod`. That doesn't work right now — the
> `prod` service is commented out in `docker-compose.yml`. Use `docker compose up dev`.

---

## Alternative — Run it without Docker (Node.js)

Only do this if Docker isn't working for you.

1. Go to https://nodejs.org and download the **LTS** version (the big green button).
   You need Node 20.19 or newer — the LTS version is fine. Run the installer and click
   Next through everything.

2. Close and reopen PowerShell, then check:

   ```powershell
   node --version
   ```

   You should see something like `v22.11.0`.

3. Go to the project folder, install the packages, and start it:

   ```powershell
   cd ~\code\flagmint-sdk-tester
   npm install
   npm run dev
   ```

4. Open **http://localhost:5173** in your browser.

Stop it the same way: `Ctrl` + `C` in PowerShell.

---

## Step 5 — Connect the tester to Flagmint

The tester is just an empty shell until you point it at a Flagmint API. In the left-hand
panel of the page:

1. **Environment** — pick **Local**, **Staging**, **Production**, or **Custom**. Local /
   Staging / Production fill both URLs for you. Staging and Production use the API host
   for handshake/QA and a separate **stream** host for SSE (Cloudflare bypass).
2. **API URL** — handshake, context POST, and QA. For Local this is usually
   `http://localhost:3000`. Ask the team if you're unsure.
3. **Stream URL** — SSE only. On Local it matches the API URL. On Staging/Production the
   Environment picker sets `staging-stream` / `stream.flagmint.com` for you. If you chose
   **Custom**, enter both the API URL and the Stream URL yourself.
4. **SDK key** — a key from the Flagmint environment you want to test. Ask the team, or copy
   it from the Flagmint dashboard. It's hidden as you type, like a password.
5. Leave **Transport** on **SSE** (that's the default and the most common one). Prefer SSE
   for config-sync (`fullConfig / deltas`).
6. Click **Connect**. The status dot turns green when it works.
7. Click **Send Context** to see which flags come back.

Your Environment, API URL, Stream URL, and SDK key are saved in the browser, so you only
enter them once.

For what to actually test once you're connected, see the **QA Testing Checklist** section of
`README.md`.

---

## If something goes wrong

**"docker: command not found" or "docker is not recognized"**
PowerShell cannot find the Docker CLI. That is not the same as Docker Desktop being
stopped.

1. Confirm Docker Desktop is installed (Step 2). If it isn't, install it and restart the PC.
2. Close and reopen PowerShell so PATH updates take effect, then run `docker --version`.
3. If it still fails, open Docker Desktop → Settings → General and confirm the CLI is
   enabled, or reinstall Docker Desktop so `docker` is on your PATH.

**"Cannot connect to the Docker daemon" / "engine is not running" / "The system cannot find the file specified"**
The `docker` command is found, but the Docker engine isn't up. Open **Docker Desktop**
from the Start menu and wait for the green **"Engine running"** indicator, then try again.

**"port is already allocated" or "address already in use"**
Something else is already using port 5173 — probably a copy of the tester you started
earlier and forgot about. Close the other PowerShell window, or run:

```powershell
docker compose down
```

Then start it again.

**The page at localhost:5173 doesn't load**
Check the PowerShell window. If you don't see the `VITE ready` message, it hasn't finished
starting yet — give it another minute. If you see red error text, copy the whole thing and
send it to the team.

**Connect button turns red / connection fails**
Usually the API URL, Stream URL, or SDK key is wrong. Double-check Environment + both URLs
and the key with the team. Also make sure the Flagmint API itself is actually running.
For Staging/Production, handshake uses the API host and SSE uses the Stream host — both
must be reachable.

**Nothing appears in the Flags tab**
Open the **Log** tab in the tester — it shows exactly what the server sent back, which
usually explains why. Try an empty context first to check you get default values.

**You changed something and now it's broken**
Undo all your local changes and go back to a clean copy:

```powershell
git checkout .
git pull
```

When you're stuck, send the team: the command you ran, and a screenshot of the full
PowerShell window. That's almost always enough to work out what happened.

---

## Mac or Linux

Same steps, with small differences:

- **Git** is usually already installed. Check with `git --version`. On Mac, if it's missing,
  running that command will offer to install it for you.
- **Docker Desktop** — download the Mac version from the same link and drag it to
  Applications. There's no WSL 2 step.
- Use the **Terminal** app instead of PowerShell.
- Folder paths use forward slashes: `cd ~/code/flagmint-sdk-tester`.
- Everything else — `git clone`, `docker compose up dev`, `npm install`, `npm run dev` — is
  exactly the same.
