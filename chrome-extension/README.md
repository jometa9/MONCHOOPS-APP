# MonchoOps — Chrome extension

Companion extension to the MonchoOps desktop app. Schedules cold DMs on the
Instagram account already logged into the user's browser. Single-account
by design — no IG password handling, no proxy rotation, no Chromium
bundling. Same UX as the desktop app for the Cold DM flow.

## What it does

- License-key login (`123` works as offline test license)
- Import leads via CSV, paste/type usernames manually, **or pull straight from the desktop app's categories / scrape results** (see "Desktop bridge" below)
- Reusable message-variant groups (`{{username}}` placeholder)
- Optional pre-DM interactions: follow, watch stories, like N posts
- Schedule by days of week + time window with configurable interval
- Background scheduler runs even with the dashboard tab closed
- Per-lead status, full DM history, total counters

## Desktop bridge

If the MonchoOps desktop app is running on the same machine, the extension
talks to it over `127.0.0.1` and can read your saved lead categories
and past scrape results — no CSV export step.

How it works:

1. The desktop app starts an HTTP server on the first free port in
   17775–17780 (bound to localhost only).
2. The extension scans that port range and finds the app via `/ping`.
3. First time you click **Import from desktop** in *New cold DM*, the
   extension shows a 4-digit code; the desktop app simultaneously pops a
   "Allow this extension?" modal with the same code. Clicking *Allow*
   in the desktop completes pairing.
4. The token returned by pairing is stored in `chrome.storage.local`
   and used as `Authorization: Bearer <token>` for every subsequent
   call. Tokens are SHA-256 hashed on the desktop side; the raw token
   never touches disk.
5. You can revoke a paired extension at any time from the desktop's
   Settings, or unpair from the extension's Settings.

Security notes:

- The bridge binds to `127.0.0.1`, never `0.0.0.0` — invisible to other
  machines.
- Without a valid token, every endpoint returns 401 with no payload.
- CORS is restricted to `chrome-extension://*` and `localhost:*`.
- The 4-digit code is the anti-phishing check: if a malicious page
  triggers a pairing in the background, the user will see a modal with
  a code that does not match anything they're looking at.

## Install for development

```bash
cd chrome-extension
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and pick `chrome-extension/dist/`
4. Pin the MonchoOps icon for quick access
5. Make sure you're logged into <https://www.instagram.com/> in this same Chrome profile
6. Click the icon → enter license key (or click **Use test license** for `123`)
7. Click **Open dashboard** to land in the full UI

For iterative work: `npm run dev` rebuilds on save. Reload the extension
from `chrome://extensions` after each change (the SW doesn't hot-reload).

## How the scheduling works

The service worker registers a `chrome.alarms` periodic alarm at 1-minute
granularity. On every fire it walks the campaigns table and, for each
campaign that's `running` or `scheduled`:

1. Skips it if `nextRunAt` is still in the future
2. Skips it if a schedule window is configured and we're outside it
   (parks `nextRunAt` until the next opening of the window)
3. Picks the next `pending` lead
4. Verifies the user has an active IG session (`sessionid` cookie) — if
   not, pauses the campaign for an hour and notifies
5. Opens or reuses a pinned background IG tab
6. Posts the DM via the content script, which runs the same DOM flow the
   desktop massDm worker uses (ig.me shortlink → fallback `/direct/new/`)
7. Persists status + history, schedules the next attempt with jitter

State lives entirely in IndexedDB (Dexie). The SW can be evicted between
ticks without losing progress.

## Limits

- Works only with the IG account currently logged into Chrome. If the
  user wants to operate a different account, they have to log out of IG
  and log into the other one in this same Chrome profile.
- Chrome must be running for alarms to fire. If Chrome is closed, the
  campaign pauses until Chrome restarts.
- The dashboard tab itself can be closed — the SW handles everything.
- The IG tab can be backgrounded; we set `active:false` and `pinned:true`
  to minimize disruption to the user's other browsing.

## Files

- `manifest.config.ts` — MV3 manifest definition
- `src/popup/` — license gate + status / open-dashboard panel
- `src/dashboard/` — full UI (Campaigns, New, Detail, History, Variants, Settings)
- `src/background/service-worker.ts` — scheduler + IG-tab orchestration
- `src/content/` — DOM automation injected into instagram.com
- `src/shared/` — types, Dexie DB, license, CSV, schedule math
