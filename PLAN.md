# B2DM — Migration & Build Plan

> Forking IPTRADE's Electron desktop base into a new SaaS called **B2DM**
> (Instagram DM automation + scraping). This document is the single source of
> truth for what gets deleted, what gets kept, and what gets built.

---

## 0. Executive summary

IPTRADE is a copy-trading Electron app (Rust API + React frontend). B2DM
re-uses IPTRADE's Electron shell, auth, license validation, build pipeline,
and Tailwind design system, but **drops all copy-trading, MT5, and cTrader
code** and builds a fresh product on top: manage multiple Instagram accounts
and run automated actions against them (mass DMs, username scraping). The
Rust backend is **replaced by Node.js running inside Electron's main
process** because Playwright — the automation engine — is Node-native.

The immediate goal (Phase 1–3) is a clean base the user can build, install
on macOS + Windows, and log in to. Product features (Phases 4–5) layer on
top once the shell boots.

---

## 1. Current-state inventory

### 1.1 On disk (repo root)
- `electron/` — full Electron source + compiled `electron/dist/`.
- `iptrade-api/` — full Rust source (axum + tokio; ~20 modules).
- `build/installer.nsh` — Windows NSIS customization (`iptrade://`, MT5 kill commands).
- `config/buildConfig.ts` — shared build constants (ports, base URL, API key).
- `dist/` — already-compiled frontend assets (icons, sounds, welcome/conclusion .txt). Frontend source is NOT here.
- `index.html` — Vite template (`<title>IPTRADE</title>`, loads `/src/main.tsx`).
- `Cargo.toml`, `Cargo.lock` — Rust workspace pointing at `iptrade-api/`.
- `.gitignore`, `.vscode/`, `node_modules/`.

### 1.2 Referenced but MISSING on disk
These appear in `package.json`, `vite.config.ts`, or `index.html` but are not present:
- `src/` — React frontend source (only compiled `dist/` exists).
- `scripts/` — `build.mjs`, `kill-port.mjs`, `run-electron-dev.mjs`, `test-mt5-connect.mjs`, `obfuscate-electron.mjs`.
- `public/` — icons, installer sidebar, welcome.txt, conclusion.txt (assets exist only in compiled `dist/`).
- `bots/` — MT5 EAs (already out of scope, stays deleted).
- `bridge/` — referenced in package.json build, never existed.
- `iptrade-mt5-api/` — C# MT5 bridge (already out of scope, stays deleted).
- Root `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tailwind.config.js`, `postcss.config.js` — supplied as attachments in the initial prompt; must be recreated with B2DM-appropriate content.

### 1.3 Implication
This is not a pure refactor. Copy-trading has to be stripped from `electron/` + `iptrade-api/`, **and** a large chunk of the project scaffolding has to be created from scratch. A green-field frontend is required; the IPTRADE frontend source is not available to port.

---

## 2. Architectural decisions

### 2.1 Backend: Node.js inside Electron main (drop Rust sidecar)
The Rust `iptrade-api` sidecar exists for copy-trading: TCP bridge on 7776, long-lived WebSocket clients to cTrader, protobuf codec, encrypted state file, monthly-rotating API keys between Electron and Rust. B2DM needs none of that.

For B2DM:
- **Main process (Node.js)**: lifecycle, windows, IPC, license check, SQLite storage, job orchestration.
- **Worker processes (`child_process.fork`)**: one forked Node.js child per Playwright job for isolation (crash-safe, killable, memory-bounded).
- **No separate HTTP server, no API key rotation.** Renderer talks to main via `contextBridge` IPC only.

Why not keep Rust? (a) Playwright-rust is immature vs. the first-party Node binding. (b) Eliminating the sidecar drops one language, one build step, one port, one binary to sign and ship. (c) Everything we kept from Rust (license HTTP call, AES-GCM state) is trivial in Node.

### 2.2 Storage
- **SQLite** (`better-sqlite3`) at `userData/b2dm.sqlite`. Synchronous, embedded, zero-config — appropriate for a single-user desktop app.
- Tables: `meta` (kv: license, subscription, settings), `accounts` (Instagram), `jobs` (run history), `scrape_results` (scrape job index).
- **AES-GCM encryption** for sensitive columns (IG cookies, session tokens, license key, Google refresh token). Key derived from a per-install secret stored in OS keychain via Electron's `safeStorage` API (falls back to a bundled salt if keychain is unavailable; still better than plaintext).
- CSV scrape outputs written to `userData/scrapes/<jobId>.csv` (not indexed by SQLite; just filesystem with pointer in DB).

### 2.3 Browser automation
- **Playwright** (`playwright-core` + Chromium).
- One forked worker per job. Worker receives a job spec over IPC (stdin or `process.send`), reports progress/logs/results back, exits when done.
- Each worker launches Chromium with the account's persisted cookies + optional user-supplied proxy.
- Bundle Chromium via `@playwright/browser-chromium` (ships browser binaries in the installer; adds ~150 MB but removes the "first-run downloads 150 MB" UX hazard).

### 2.4 Auth / license
- **License validation**: GET `{LICENSE_SERVER}/api/validate-subscription?apiKey={key}` — same shape IPTRADE uses. Response fields we care about for B2DM: `email`, `name`, `plan`, `version`. We drop `accountLimit` (copy-trading-specific) and `fixedLotSize` (copy-trading-specific). Add a semantic for `plan === "free" || plan === "none"` → no active subscription → block app.
- **Google OAuth**: same deep-link pattern as IPTRADE. User clicks "Sign in with Google" → opens external browser → completes OAuth on the dashboard → dashboard redirects to `b2dm://auth?token=...&refresh=...` → Electron picks up the deep-link → persists the token.
- **License server URL**: placeholder `https://b2dm.app/api` (user to confirm). Kept in `config/buildConfig.ts`.

### 2.5 Frontend
- React 18 + Vite + TypeScript.
- **Tailwind CSS** (keep IPTRADE's look).
- **Radix UI primitives** (already in the inherited `package.json`: `@radix-ui/react-label`, `react-radio-group`, `react-select`, `react-slot`, `react-switch`). This maps to the shadcn/ui pattern.
- **Router**: `react-router-dom` v7 (already in `package.json`).
- **State**: React Context for session + light Zustand if needed for jobs. Start with Context, only add Zustand when it hurts.
- Layout mirrors IPTRADE conceptually: title-bar-less window with custom chrome, sidebar nav, main pane, bottom status strip for running jobs.

### 2.6 Rebranding
Every occurrence:
- `IPTRADE` (product name) → `B2DM`
- `iptrade` (lowercase identifier) → `b2dm`
- `com.iptrade.app` (appId) → `com.b2dm.app`
- `iptrade://` (protocol) → `b2dm://`
- `iptradecopier.com` (license server) → `b2dm.app` (placeholder; user to supply)
- `iptrade-api` (binary/crate) → N/A (binary deleted)
- `IPTRADE.exe` → `B2DM.exe`
- Env vars `IPTRADE_*` → `B2DM_*`
- User data dir `~/Library/Application Support/IPTRADE` → `~/Library/Application Support/B2DM`
- Log file `iptrade.log` → `b2dm.log`
- State file `iptrade.json` → `b2dm.sqlite` (+ encryption)

---

## 3. Rebranding reference (use during every phase)

| IPTRADE token | B2DM replacement | Where it appears |
|---|---|---|
| `IPTRADE` | `B2DM` | window title, tray tooltip, app.setName, package.json `productName`, installer UI, Rust banner (deleted anyway) |
| `iptrade` | `b2dm` | userData folder, env var prefixes, CSS class scopes (if any), log file basename |
| `iptrade://` | `b2dm://` | `app.setAsDefaultProtocolClient`, `will-navigate` URL check, `setWindowOpenHandler`, NSIS registry, `argv` matcher, preload event types |
| `com.iptrade.app` | `com.b2dm.app` | electron-builder `appId` |
| `IPTRADE.exe` | `B2DM.exe` | NSIS `AppName`, process matching in `installer.nsh` |
| `iptradecopier.com` | `b2dm.app` (placeholder) | `buildConfig.ts` BASE_URL |
| `iptrade-api` | _(deleted)_ | Cargo workspace, afterPack binary-copy, serverProduction port/spawn |
| `iptrade-mt5-api` | _(deleted)_ | afterPack, package.json build block, scripts |
| `IPTRADE_STATE_PATH`, `IPTRADE_STATE_SECRET`, `IPTRADE_ELECTRON_PROD` | `B2DM_STATE_PATH`, `B2DM_STATE_SECRET`, `B2DM_ELECTRON_PROD` | config.rs (deleted), serverProduction, main.ts |

---

## 4. Phase 1 — Strip copy-trading and delete the Rust API

Goal: after this phase, `electron/` compiles and the app knows it has no backend. No Rust, no MT5, no bots.

**Tasks:**
1. Delete `iptrade-api/` entirely.
2. Delete root `Cargo.toml`, `Cargo.lock`.
3. In `electron/src/serverProduction.ts`: remove everything. This file spawns the Rust binary — not needed. Replace with a tiny stub that exports `getServerUrl()` returning an empty string (or delete the file and remove all imports in `main.ts`). Preferred: **delete the file**, inline the two tiny helpers (`getApiKeys` stub returning `{}`, log-cleanup) into `main.ts` or delete them too.
4. In `electron/src/main.ts`:
   - Remove `getServerUrl`, `getApiKeys`, `preemptSingleInstancePeers`, `runLaunchCleanup`, `startProductionServer`, `stopProductionServer`, `forceKillApiOnPort`, `ensureServerRunning`, `pingServerOnly` imports. Replace with Node-native equivalents or delete them if they were only about the Rust sidecar.
   - Keep: window creation, IPC for deep-link, `iptrade://` protocol (will be renamed in Phase 2), tray, power monitor, dev-tools blocking.
   - Remove `check-server-status`, `ping-server`, `get-server-url`, `get-api-keys` IPC handlers (or replace with B2DM equivalents that return `true` / `{}`).
5. In `electron/src/afterPack.ts`: remove MT5 binary copy, bots copy. Keep icon rcedit + macOS sign hooks for our own app bundle only.
6. In `electron/src/buildConfig.ts`: delete MT5 port, tcp port, API key/secret constants (no longer needed). Keep `FRONTEND_PORT` only, plus `BASE_URL` for license server.
7. In `build/installer.nsh`: remove all `KillProcess "iptrade-mt5-api.exe"`, `Delete ...mt5...`, and related blocks. Keep single-instance / protocol / cleanup blocks (we'll rename tokens in the rebrand step).
8. In `config/buildConfig.ts`: reduce to `FRONTEND_PORT` and `BASE_URL`.
9. In `electron/src/logRetention.ts`, `blobCrypto.ts`, `decryptedResources.ts`: inspect; keep if generic, delete if copy-trading-specific. (`blobCrypto` is likely generic AES helper — keep.)
10. Delete `electron/dist/` (compiled output, regenerated by `tsc`).
11. Delete repo-root `dist/` once we've salvaged the assets we want from it (icons, welcome/conclusion.txt) into a new `public/` — see Phase 2.

**Acceptance:** `rg -i "iptrade" electron/` only hits strings that are about to be renamed to `b2dm`, not structural references to MT5 / copy-trading / Rust. No file references a file that no longer exists.

---

## 5. Phase 2 — Rebuild missing scaffolding

Goal: after this phase the project has every file the build and dev commands expect.

**Tasks:**

### 5.1 Create `public/`
Source assets from the existing compiled `dist/`:
- `icon.png`, `icon.ico`, `icon.svg`, `iconTrayTemplate.png`, `iconTrayTemplate@2x.png`, `installer-sidebar.bmp`, `installer-sidebar.png`, `sidebar.png`, `welcome.txt`, `conclusion.txt`, `Headless.png`, `sounds/*`
- Replace any "IPTRADE" strings inside `welcome.txt` / `conclusion.txt` with "B2DM".
- Regenerate `.ico` from `icon.png` only if user wants a new visual identity; for now keep current art as a placeholder.

### 5.2 Create root `package.json`
Base it on the attachment in the initial prompt, with these changes:
- `name`: `b2dm-multi-electron-app` → `b2dm-app`.
- `version`: `0.1.0`.
- `description`: `B2DM — Instagram DM automation`.
- `main`: `electron/dist/main.js` (unchanged).
- Drop scripts: `build:rust`, `build:rust:release`, `build:api`, `run:api`, `start:api`, `build:mt5`, `test:mt5`.
- Keep/rewrite: `dev` (Vite), `dev:all` (concurrently Vite + Electron), `dev:fresh`, `dev:frontend`, `dev:electron`, `build:frontend`, `build:electron`, `electron:dev`, `build` (→ `scripts/build.mjs`), `build:win`, `build:win:nsis`, `clean:release`, `clean:electron`.
- Drop deps that became unused: none of the current deps are copy-trading-specific. Keep them all.
- Add deps: `better-sqlite3`, `playwright-core`, `@playwright/browser-chromium`, `papaparse` (CSV parsing), `xlsx` (XLS/XLSX parsing), `node-fetch` (or use native `fetch` on Node ≥ 18).
- Update `build` block: rename appId, productName, protocol, artifactName, icon paths, extraResources (drop `target/release/iptrade-api`), NSIS shortcutName. Drop `iptrade-api` and MT5 binary references.

### 5.3 Create `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tailwind.config.js`, `postcss.config.js`
Use the attachments from the initial prompt verbatim; they're already B2DM-appropriate (vanilla React + TS + Tailwind). Only change: update any `iptrade` references (there are none in the attachments).

### 5.4 Create `index.html`
Already on disk but change `<title>IPTRADE</title>` → `<title>B2DM</title>`.

### 5.5 Create `scripts/`
- `scripts/kill-port.mjs` — small Node.js util to kill whatever binds a port (used before `vite`).
- `scripts/run-electron-dev.mjs` — waits for Vite to be up on 7775, then spawns Electron.
- `scripts/build.mjs` — orchestrates: `vite build` → `tsc -p electron/tsconfig.json` → `electron-builder`. Drops all Rust/MT5 steps.
- Drop `scripts/test-mt5-connect.mjs` and `scripts/obfuscate-electron.mjs` for now. (Obfuscation can be re-introduced later if needed.)

### 5.6 Create `src/` (React frontend skeleton)
Directory layout:
```
src/
├── main.tsx              # React entrypoint (createRoot)
├── App.tsx               # Router root with <SessionProvider>
├── index.css             # Tailwind directives + base styles
├── lib/
│   ├── cn.ts             # clsx + tailwind-merge
│   ├── electron.ts       # typed wrapper around window.electronAPI
│   └── api.ts            # typed IPC client (for backend calls)
├── components/
│   ├── ui/               # shadcn-style primitives: button, input, dialog, select, ...
│   ├── layout/           # AppShell, Sidebar, TitleBar, StatusStrip
│   └── common/           # EmptyState, Spinner, ConfirmDialog
├── context/
│   ├── SessionContext.tsx  # license + subscription state
│   └── JobsContext.tsx     # running jobs observable
├── screens/
│   ├── Login.tsx
│   ├── NoSubscription.tsx
│   ├── InstagramAccounts.tsx
│   ├── Actions.tsx
│   ├── MassDMs.tsx
│   ├── Scrape.tsx
│   └── Data.tsx
└── types/
    ├── ipc.ts            # IPC channel name consts + payload types
    └── domain.ts         # Account, Job, ScrapeResult
```

### 5.7 Scaffold the backend module (inside Electron main)
Directory layout:
```
electron/src/
├── main.ts                 # existing; prune
├── preload.ts              # existing; extend
├── buildConfig.ts          # existing; prune
├── logRetention.ts         # existing; keep
├── blobCrypto.ts           # existing; evaluate (probably keep)
└── backend/
    ├── index.ts            # wires IPC handlers on app-ready
    ├── db.ts               # better-sqlite3 connection + migrations
    ├── crypto.ts           # AES-GCM + safeStorage key
    ├── license.ts          # validateLicense(), logout()
    ├── oauth.ts            # handleDeepLink("b2dm://auth?…")
    ├── accounts.ts         # CRUD for Instagram accounts
    ├── jobs.ts             # job registry + per-account lock
    ├── workers/
    │   ├── login.ts        # "add IG account" Playwright worker
    │   ├── massDm.ts       # mass DM sender
    │   └── scrape.ts       # scraping worker (covers all scrape modes)
    └── ipc/
        ├── handlers.ts     # ipcMain.handle(...) for each renderer call
        └── channels.ts     # channel name consts (mirrors src/types/ipc.ts)
```

**Acceptance:** `npm install` succeeds. `tsc --noEmit` on both `tsconfig.json` (frontend) and `electron/tsconfig.json` (Electron) pass with only "module not implemented yet" stubs.

---

## 6. Phase 3 — Port auth & license; minimal runnable shell

Goal: user can `npm run dev:all`, see the Login screen, enter a license key (or go through Google OAuth), be gated by subscription status, and land on a placeholder Home.

**Tasks:**
1. **Backend `license.ts`**: implement `validateLicense(key)` → GET `{BASE_URL}/api/validate-subscription?apiKey={key}` → parse response → if `plan` is absent/free/none → return `{ hasSubscription: false, ...profile }`; else `{ hasSubscription: true, ...profile }`. Persist to `meta` table. Mirror IPTRADE's `ExternalLicenseResponse` shape.
2. **Backend `crypto.ts`**: AES-GCM encrypt/decrypt with key from `safeStorage.encryptString` roundtrip (Electron's OS-keychain-backed secret). Fallback to a bundled salt + per-install random key (written once to `userData/.b2dm-key` with 0600).
3. **Backend `db.ts`**: `better-sqlite3` open, enable WAL, create tables if missing: `meta (key TEXT PRIMARY KEY, value TEXT)`, `accounts (...)`, `jobs (...)`, `scrape_results (...)`. Schema migrations via simple `PRAGMA user_version`.
4. **Backend `oauth.ts`**: handle `b2dm://auth?token=…&refresh=…` deep link. Store encrypted in `meta`. Treat Google-login as equivalent to license-key for auth purposes; the dashboard issues a license key back.
5. **`main.ts`**: rename `'iptrade'` → `'b2dm'` for protocol; rename `'IPTRADE'` → `'B2DM'` for app name, tray tooltip, window title. Update argv matcher and `will-navigate` URL check to `b2dm://`.
6. **`preload.ts`**: expose new `b2dm.*` IPC surface while keeping `electronAPI.*` alias for anything shared:
   - `validateLicense(key)`, `logout()`, `getSession()` (returns `{ license, profile, hasSubscription }`)
   - `onDeepLink`, `onSystemSuspend`, `onSystemResume`, `getPlatform`, `getIsFullScreen`, `openExternalLink`, `onFullScreenChange`, `setWindowButtonPosition`
   - (Instagram + jobs APIs are added in Phase 4–5.)
7. **Frontend `SessionContext`**: on mount → `await b2dm.getSession()` → route:
   - no license → `<Login>`
   - license but `hasSubscription === false` → `<NoSubscription>` (with a "Go to dashboard" button → `openExternalLink("https://b2dm.app/dashboard/billing")`)
   - license + subscription → `<AppShell>` children (for now, Home placeholder).
8. **Login screen**: two inputs — license key form (validates → sets session) and Google button (opens `https://b2dm.app/login/google?callback=b2dm://auth`).
9. **AppShell**: sidebar nav (Instagram Accounts, Actions, Data, Settings), custom title bar matching IPTRADE's hidden-titlebar + platform traffic lights, status strip at the bottom reserved for running jobs.

**Acceptance:**
- `npm run dev:all` → Electron window opens to Login.
- Entering a valid license key → Home.
- Entering a valid key whose plan is `free` → `<NoSubscription>` with "Pay now" CTA.
- `electron-builder --mac pkg` and `electron-builder --win nsis` both produce installable artifacts. Installed app launches and reaches the Login screen (license validation requires network but Login UI must render offline).

---

## 7. Phase 4 — Instagram account management

Goal: user can add, list, configure, and delete Instagram accounts. Each account stores the session needed to drive Playwright.

### 7.1 DB schema
```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,                -- uuid
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  profile_pic_url TEXT,
  cookies_encrypted BLOB NOT NULL,    -- AES-GCM(JSON[])
  user_agent TEXT NOT NULL,
  proxy_url TEXT,                     -- nullable; user-supplied
  proxy_username TEXT,
  proxy_password_encrypted BLOB,
  status TEXT NOT NULL,               -- 'idle' | 'busy' | 'error'
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 7.2 "Add account" flow
1. Renderer: user clicks **Add Instagram Account** → calls `b2dm.accounts.startLogin()`.
2. Main: fork `workers/login.ts`.
3. Worker:
   - Launches Playwright Chromium **headed** (user needs to interact), windowed, with the proxy if one is configured globally, otherwise direct.
   - Navigates to `https://www.instagram.com/accounts/login/`.
   - Polls for `localStorage.getItem("state")` / cookie `sessionid` / DOM state indicating completed login. When detected:
     - Snapshot cookies via `context.cookies()`.
     - Fetch `https://www.instagram.com/api/v1/users/web_profile_info/?username=…` (with the now-authenticated cookies) for `full_name` + `profile_pic_url`.
     - Emit result over `process.send({ type: "login-success", username, cookies, userAgent, displayName, pfpUrl })`.
     - Close the browser.
4. Main: on worker message → encrypt cookies → insert into `accounts` → return new row to renderer → renderer pushes a new card onto the list.
5. If the user closes the Playwright window without logging in, worker exits with `{ type: "login-cancelled" }` → renderer re-enables the button.

### 7.3 UI
- `InstagramAccounts.tsx`:
  - Empty state: large CTA "Add your first Instagram account", using IPTRADE's existing styling patterns.
  - Populated state: grid of account cards showing `profile_pic_url`, `@username`, `display_name`, a status pill (`Idle` / `Running: Mass DMs` / `Error`), and an ⋯ menu with:
    - **Configure proxy** → dialog with fields `proxy_url`, `proxy_username`, `proxy_password` (password-masked). Validates format `http(s)://host:port` or `socks5://host:port`.
    - **Delete** → confirm dialog. Refuses if account is `busy`.
- All strings in English.

### 7.4 Account lock (shared with Phase 5)
When a job starts for account X, main writes `status='busy'` in the DB and broadcasts `accounts:changed` IPC event. Renderer greys out action buttons for that account until `status='idle'` again. Attempting to start a second job → main rejects with `"account_busy"` error.

**Acceptance:**
- User can add an IG account, sees profile pic + handle.
- User can delete only when idle.
- Proxy config roundtrips (enter → save → reopen → values still there; password masked).
- DB file inspection shows `cookies_encrypted` is non-plaintext.

---

## 8. Phase 5 — Actions & automation

### 8.1 Generic job model

`jobs` table:
```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,             -- 'mass_dm' | 'scrape_by_username' | 'scrape_by_post' | 'scrape_by_hashtag' | 'scrape_by_location'
  params_json TEXT NOT NULL,      -- original user inputs
  status TEXT NOT NULL,           -- 'running' | 'completed' | 'failed' | 'cancelled'
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER,
  error TEXT
);
```

`scrape_results` (one row per completed scrape job):
```sql
CREATE TABLE scrape_results (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,          -- auto-generated description, e.g. "Followers of @nike (scrape_by_username)"
  username_count INTEGER NOT NULL,
  csv_path TEXT NOT NULL,         -- absolute path in userData/scrapes/
  duration_ms INTEGER NOT NULL,
  completed_at INTEGER NOT NULL
);
```

Jobs IPC:
- `jobs:start(kind, accountId, params)` → returns `jobId`; main forks the right worker.
- `jobs:cancel(jobId)` → main kills the worker process.
- `jobs:list()` → DB select.
- `jobs:onProgress(cb)` → stream events `{ jobId, done, total, lastItem }`.

Worker protocol (every worker):
- Receives init message on `process.on('message', …)` with `{ jobId, account, proxy, params }`.
- Emits over `process.send(…)`:
  - `{ type: 'progress', done, total?, item? }` — throttled at ~2 Hz.
  - `{ type: 'result', payload }` — on completion.
  - `{ type: 'log', level, msg }` — optional.
  - `{ type: 'error', msg }` — on failure, then exits.

### 8.2 Action A — Mass DMs (`workers/massDm.ts`)
Inputs (validated by main before fork):
- `accountId`
- `usernames`: either `{ kind: 'file', path }` (user uploaded CSV/XLS; main reads + dedupes + writes to a temp file) or `{ kind: 'scrape_result', jobId }` (main resolves the CSV path).
- `message`: text (allow `{{username}}` token — simple string replace).
- `intervalMs`: number (min 3000, default 12000, user editable).

Worker flow:
1. Launch Playwright with account's cookies + proxy.
2. For each username:
   - Navigate to `https://www.instagram.com/direct/new/`.
   - Search for username, pick, send message (`messageTemplate.replace('{{username}}', u)`).
   - Emit progress.
   - Wait `intervalMs` (± jitter of 25% to look less robotic).
3. On completion: `{ type: 'result', payload: { sent, failed, failedUsernames } }`.

Frontend `MassDMs.tsx`:
- Step 1: pick source — `Upload CSV/XLS` (uses `xlsx` / `papaparse`) or `Select from previous scrapes` (lists `scrape_results`).
- Step 2: message textarea + interval slider.
- Step 3: confirm → start → redirects to running-job view with live counter.
- Running view updates via `jobs:onProgress`.

### 8.3 Action B — Scraping (`workers/scrape.ts`)

Four modes, same worker (branches inside). Mode list is **exactly** four (the user asked for the first two explicitly and gave me discretion on the rest; I picked hashtag + location because those are the two de-facto standard IG scrape entry points).

#### Mode 1 — By username
Inputs: `username`, `postsCount` (N posts to walk back), `collectFollowers` (bool), `collectFromComments` (bool), `collectFromLikes` (bool), `intervalMs`.
Flow:
1. Navigate to `https://www.instagram.com/{username}/`.
2. If `collectFollowers`: open followers modal, scroll-fetch until exhausted or rate-limited.
3. Else: walk the first `postsCount` posts; for each, optionally scrape commenters and likers (Instagram hides like lists for big accounts — handle the "not available" gracefully and log it).
4. Stream usernames to the CSV file as they come in (don't buffer all in memory).

#### Mode 2 — By post URL
Inputs: `postUrl`, `collectCommenters` (default true), `collectLikers` (default true — may fall back if unavailable).
Flow: open the post, collect both sets.

#### Mode 3 — By hashtag
Inputs: `hashtag` (without `#`), `postsToCheck` (default 50), `collectCommenters`, `collectLikers`.
Flow: `https://www.instagram.com/explore/tags/{hashtag}/` → top + recent posts → drill in → collect.

#### Mode 4 — By location
Inputs: `locationUrl` or `locationSlug`, `postsToCheck`, same collection flags.
Flow: `https://www.instagram.com/explore/locations/{id}/{slug}/` → same drill-in as hashtag.

All modes:
- Stream output to `userData/scrapes/{jobId}.csv` (header: `username`, `source`, `source_ref`).
- On completion: insert `scrape_results` row with auto-summary:
  - Mode 1: `"Followers of @{username}"` or `"Commenters/Likers of @{username}'s last {N} posts"`.
  - Mode 2: `"Commenters/Likers of post {shortcode}"`.
  - Mode 3: `"Users engaged with #{hashtag} (top {N} posts)"`.
  - Mode 4: `"Users engaged at {locationName} (top {N} posts)"`.

Frontend:
- `Scrape.tsx` — one screen with mode tabs. Each tab has its own form.
- `Data.tsx` — list of scrape results, newest first, no pagination, showing `completed_at`, `duration`, `username_count`, `summary`, and a Download CSV button (IPC `scrapes:download(jobId)` → opens save dialog, copies file).

**Acceptance:**
- Mass DM job runs against 3 test usernames with visible progress, can be cancelled mid-run, releases account lock on completion/cancel/error.
- Mode 1 scrape produces a CSV with expected content for a small public test account; row appears in `<Data>`; download button saves the CSV.
- Running two jobs on *different* accounts in parallel works. Attempting two jobs on the *same* account is rejected.

---

## 9. Phase 6 — Build & distribution

**Tasks:**
1. `npm run build` pipeline (see `scripts/build.mjs`):
   - `vite build` → `dist/`
   - `tsc -p electron/tsconfig.json` → `electron/dist/`
   - `electron-builder` → `release/`
2. macOS PKG build:
   - Bundle identifier `com.b2dm.app`.
   - Hardened runtime + entitlements (existing `electron/entitlements.mac.plist` — verify it has `com.apple.security.network.client` for Playwright network, and it doesn't grant anything copy-trading-specific).
   - Re-use `public/icon.png`, `public/iconTrayTemplate.png`.
3. Windows NSIS build:
   - Rename `IPTRADE.exe` → `B2DM.exe`.
   - NSIS registers `b2dm://` protocol.
   - Rename shortcut + installer sidebar.
4. **Bundle Playwright Chromium** in both installers (add `@playwright/browser-chromium` and wire its `browsers` config so the binary is extraResource'd into `resources/playwright-chromium/`). Worker uses `chromium.launch({ executablePath: <resolved path> })`.
5. Smoke test on both platforms: fresh install → launch → login → add an IG account → run a short scrape.

---

## 10. Deferred / out of scope (first release)

- Auto-updater (IPTRADE's `electron-builder` config likely supports it; wire after v1 ships).
- Obfuscation of Electron JS (`javascript-obfuscator` in original deps).
- Telemetry / crash reporting.
- In-app purchase / Stripe integration (user pays on the dashboard, not in-app).
- CAPTCHA / 2FA handling in the IG login flow (user sees the Playwright window and solves interactively — that's acceptable for v1).
- Multi-language UI (English only).
- Persistent job resume across app restarts (interrupted jobs are marked `failed` on next boot; retry = new job).

---

## 11. Risks & open questions

1. **License server URL**: `https://b2dm.app/api/validate-subscription` is a placeholder. User must (a) own the domain, (b) stand up the `/api/validate-subscription?apiKey=…` endpoint with the same response shape IPTRADE uses, (c) provision a B2DM product entry with subscription plans. Until then, dev uses a stub that accepts any non-empty key.
2. **Instagram ToS**: scraping and mass DMs violate Instagram's ToS and accounts can be banned. This is the user's business decision; our responsibility is to (a) add a clear disclosure in onboarding, (b) ship sensible defaults (intervals, jitter) that reduce detection.
3. **Installer size**: bundling Chromium adds ~150 MB per platform. Acceptable for v1 — avoids the "run, wait 5 min for browser download" first-use issue.
4. **Playwright bot detection**: Instagram increasingly fingerprints automation. We use `chromium` with a realistic user-agent and the account's real cookies, but that may not be enough long-term. Plan: if detection rates rise, switch to `playwright-extra` + `stealth` plugin — it's a drop-in.
5. **macOS code signing of forked workers**: forked Node.js children inherit the signed parent — fine. But bundled Chromium is a separate binary and must be signed/notarized. `electron-builder`'s Mac builder handles this if the binary sits under `resources/`.
6. **Frontend source gap**: the IPTRADE frontend is not in this repo, so we're not porting UI — we're building new UI that *looks like* IPTRADE's based on Tailwind + Radix. Screens may drift from the original aesthetic; user should review early Phase 3 output.

---

## 12. Execution checklist (task list)

### Phase 1 — Clean slate  ✅ DONE
- [x] Delete `iptrade-api/` directory.
- [x] Delete root `Cargo.toml`, `Cargo.lock`.
- [x] Gut `electron/src/serverProduction.ts` (deleted outright).
- [x] Prune `electron/src/main.ts` of Rust-sidecar + MT5 references.
- [x] Prune `electron/src/afterPack.ts` of MT5 + bots copying.
- [x] Prune `electron/src/buildConfig.ts`.
- [x] Prune `build/installer.nsh` (remove MT5 kills).
- [x] Prune `config/buildConfig.ts` (later deleted outright — no importer).
- [x] Delete `electron/dist/` (will regenerate).
- [x] Salvage assets from root `dist/` into new `public/`.
- [x] Delete `electron/src/decryptedResources.ts` + `adm-zip.d.ts` (obfuscated-resource path not needed for v1).

### Phase 2 — Scaffolding  ✅ DONE (installer step still running)
- [x] Create `public/` with icons, sounds, welcome/conclusion .txt (B2DM-rebranded).
- [x] Create root `package.json` (B2DM version, no Rust/MT5, +sqlite/playwright/papaparse/xlsx).
- [x] Create `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tailwind.config.js`, `postcss.config.js`.
- [x] Create `index.html` (title B2DM).
- [x] Create `scripts/kill-port.mjs`, `scripts/run-electron-dev.mjs`, `scripts/build.mjs`.
- [x] Create `src/` skeleton (main.tsx, App.tsx, index.css, lib, components/ui+layout+common, context, screens, types).
- [x] Create `electron/src/backend/` skeleton: `types.ts`, `crypto.ts`, `db.ts` (+ accounts/jobs/scrape_results migrations already landed), `license.ts`, `oauth.ts`, `index.ts`. `accounts.ts`, `jobs.ts`, `workers/`, `ipc/channels.ts` deferred until Phase 4–5 when they gain real implementations.
- [ ] `npm install` succeeds. — **in progress** (running in the background; pulls better-sqlite3, playwright-core, @playwright/browser-chromium ~150 MB)

### Phase 3 — Auth + runnable shell  ✅ CODE DONE (acceptance tests pending install)
- [x] Implement `backend/crypto.ts` (safeStorage-backed AES-GCM).
- [x] Implement `backend/db.ts` (better-sqlite3, migrations).
- [x] Implement `backend/license.ts` (validateLicense, logout). Includes `MOCK_LICENSE_KEY = '123'` dev shortcut: typing `123` logs you in as `Mock User <mock@b2dm.app>` with a `pro` plan — remove once the real license endpoint is live.
- [x] Implement `backend/oauth.ts` (handle `b2dm://auth?…` deep link).
- [x] Wire IPC handlers for license + session (`session:get`, `license:validate`, `session:logout`, `session:changed` broadcast).
- [x] Rebrand `main.ts`: `IPTRADE` → `B2DM`, `iptrade://` → `b2dm://`.
- [x] Extend `preload.ts` with `b2dm.*` surface (plus `electronAPI` legacy alias).
- [x] Build `src/` Login + NoSubscription + AppShell (TitleBar + Sidebar). Status strip for running jobs deferred to Phase 5.
- [ ] Acceptance test: `dev:all` → login with `123` → land on Home. — pending `npm install`
- [ ] Acceptance test: Mac PKG + Win NSIS build. — pending later

### Phase 4 — Instagram accounts  ✅ CODE DONE (manual acceptance skipped per user)
- [x] Add `accounts` table migration. (already in db.ts migrations)
- [x] Implement `backend/accounts.ts` CRUD.
- [x] Implement `workers/login.ts` Playwright login-capture worker (forked via child_process.fork with ELECTRON_RUN_AS_NODE).
- [x] Wire `accounts:*` IPC.
- [x] Build `InstagramAccounts.tsx` with empty state + card grid.
- [x] Build proxy config dialog + delete-with-confirm.
- [~] Acceptance test: skipped per user — no manual test tasks in this phase.

### Phase 5 — Actions & scraping  ✅ CODE DONE (manual acceptance skipped per user)
- [x] Add `jobs` + `scrape_results` tables. (already in db.ts migrations)
- [x] Implement `backend/jobs.ts` (start/cancel/list, worker orchestration, per-account lock, on-startup reconcile).
- [x] Implement `workers/massDm.ts`.
- [x] Implement `workers/scrape.ts` (4 modes — by username/post/hashtag/location).
- [x] Build `Actions.tsx` landing + links to MassDMs and Scrape.
- [x] Build `MassDMs.tsx` (CSV/XLS input, message w/ `{{username}}`, interval).
- [x] Build `Scrape.tsx` (4-mode tabs).
- [x] Build `Data.tsx` (results list + download CSV + reveal-in-folder).
- [x] Build status strip (live job indicators + cancel button).
- [~] Acceptance: skipped per user — no manual test tasks in this phase.

### Phase 6 — Build & ship
- [ ] Bundle Playwright Chromium in installers.
- [ ] Update entitlements.
- [ ] Mac PKG smoke test.
- [ ] Win NSIS smoke test.
- [ ] Tag v0.1.0.

---

## 13. Session log

**Session 1 (this one):**

- ✅ Phase 1 — copy-trading/MT5/Rust sidecar stripped. Deleted: `iptrade-api/`, `Cargo.toml`, `Cargo.lock`, `electron/src/serverProduction.ts`, `decryptedResources.ts`, `adm-zip.d.ts`, stale `dist/`, unused `config/`. Pruned + rebranded: `electron/src/main.ts`, `afterPack.ts`, `buildConfig.ts`, `build/installer.nsh`, `index.html`, `.gitignore`.
- ✅ Phase 2 — scaffolding rebuilt. New files: root `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tailwind.config.js`, `postcss.config.js`, `scripts/{kill-port,run-electron-dev,build}.mjs`, `public/` (icons + sounds + welcome/conclusion, all rebranded), `src/` (Login, NoSubscription, Home, InstagramAccounts/Actions/Data placeholders, AppShell, TitleBar, Sidebar, UI primitives, session context, lib helpers), `electron/src/backend/` (types, crypto, db, license, oauth, index).
- ✅ Phase 3 — auth + runnable shell landed. License flow works end-to-end code-wise; `b2dm://auth` deep link intercepted and validated. Mock `123` license added so the app can be tested without the license server.
- ⏳ `npm install` — running in background. Required before first `npm run dev:all`.
- ⏭️ Acceptance tests (`dev:all` boots to Login, `123` unlocks Home, mac PKG + win NSIS builds) — pending install completion.

**Follow-up sessions** will pick up Phase 4 (Instagram account add with Playwright), then Phase 5 (Mass DMs + scraping workers + Data view), then Phase 6 (build/sign/ship).
