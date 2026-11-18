# Spindle / Make

**One application. One workspace. From idea to pull request.** — *powered by jsj*

Spindle / Make is a Laravel-native, AI-first desktop app for macOS. You describe a change, AI builds it in a safe copy of your project, you try it in a live preview (point at things to change them), check it, and submit it for review. Engineers keep control of approval, merging and deploying.

- **Creator mode** (default for new users): plain language, no branches, no terminals. The steps are *Start a change → Preview → Check changes → Submit for review*.
- **Developer mode** (⇧⌘D): everything — branches, processes, logs, queries, CI, merges and deploys. Both modes work on the same projects.

## Download

Get the latest **`Spindle-Make-<version>-arm64.dmg`** from [Releases](https://github.com/spindle-as/make/releases/latest), open it and drag **Spindle Make** to Applications (Apple Silicon Macs).

The app isn't notarized by Apple yet. The first time you open it, macOS says it can't check it: open **System Settings → Privacy & Security** and click **Open Anyway**, or run:

```bash
xattr -cr "/Applications/Spindle Make.app"
```

After that, Spindle Make keeps itself up to date: new versions download in the background (verified against the release's SHA-256 checksums), and **Restart to update** appears in the sidebar. Check by hand from the app menu → *Check for Updates…*, or turn background downloads off in Settings → General.

### The creator journey

1. **Open project:** from GitHub (searchable, showing your role on each repo), a folder on this Mac, or a brand-new Laravel app. Setup is automatic: dependencies, project settings, database, data, built assets and a local site. It shows friendly progress, resumes when you retry, and offers **Ask AI to fix it** if a step fails.
2. **Describe it:** the AI builds it in an isolated workspace with its own branch, preview server, database copy and captured email.
3. **Preview:** a live preview at desktop, tablet or mobile size, showing the page's console errors. **Point at something to change**: pick elements, comment on each, and send them all to the AI with cropped screenshots. Vue and React dev builds also report the source component.
4. **Check changes:** runs the project's real checks (tests, Pint, PHPStan, npm test, lint, build) and records the results.
5. **Submit for review:** a professional PR (summary, changes, visual changes, database changes, testing, risks, reviewer notes). The Testing section is built *only* from recorded check runs, so it never claims tests passed when they didn't. Contributors without push access submit from their own fork automatically.
6. Maintainers then get **Approve and apply** and **Go live**.

### Permissions & security

- Your role on each repo (maintainer, can push, or contributor) is read from GitHub and **enforced in the main process**: merging needs push access, deploying needs maintainer access, and both refuse otherwise, even if the UI were bypassed.
- **Contributor-only machine** (Settings → General): never merges or deploys, and won't accept production tokens.
- The agent can't push, merge, call the GitHub API, ssh or rsync. Contributors' agents can't use `gh` at all. These are passed to Claude Code as `--disallowedTools`, and tokens are stripped from the agent's environment.
- The database browser only connects to local development databases. Changes and restores are only allowed in a change's own copy, and development email is always captured, never delivered.

## Features

| Area | What it does |
| --- | --- |
| **Start like a chat** | Choose *Feature* or *Chat* and a project, type, press ↵. The thread opens right away, setup progress appears in it as a live checklist, and the agent starts as soon as the workspace is ready. Titles are written by a small model, and you can rename by clicking the title. |
| **Plain chats** | Ask questions about a project (read-only by default) or have a general chat with no project. **Continue as feature** carries the discussion into a new feature branch. |
| **Models & reasoning** | Per thread: agent (Claude Code / Codex), model, and reasoning level (low → max, plus *ultra* for Codex models that support it). The Codex list comes from your CLI's own model cache, so it is always current. Claude threads can also have a spend limit per turn. Replies stream in live. |
| **Approvals & questions** | Claude asks before risky actions and asks questions when something is ambiguous. Both appear as cards in the conversation: ↵ allow, ⌥↵ always allow (for this thread), Esc decline, or type what to do instead; questions take number keys. Waiting threads show **Needs you** in the sidebar, in a Dock badge and in a notification. You can also add messages while the agent is working. |
| **Background processes** | Per-feature services such as `npm run dev`, queue workers, Horizon or Reverb (detected automatically) start when the workspace is ready. The Processes tab has live logs, start/stop/restart, stdin and **Fix with agent**. The agent is told where the logs are, so it can debug the dev server itself. |
| **Parallel features** | Each feature gets `feature/<slug>`, its own worktree, its own `.test` site in Herd and **its own database**, so several agents can work side by side. |
| **Per-feature databases** | MySQL, MariaDB or Postgres, including servers run by **DBngin**: a new database on the same server, either a copy of your main database or fresh and migrated. SQLite gets a separate copied file. The worktree's `.env` is pointed at it automatically. |
| **Automatic cleanup** | Once a feature is merged (and deployed, if an environment auto-deploys), its worktree, Herd site, database and local branch are removed. The conversation is kept. You can also run cleanup manually from the palette. |
| **Changes / Preview / Terminal** | Branch diff with per-file revert and AI commit messages, an embedded preview of the feature's site, and a terminal with quick commands and **Fix** on failures. |
| **GitHub** | PRs, live checks, failed-job logs, **Fix with agent**, re-runs, conflict resolution and merge. |
| **Deploy (Ploi)** | Paste a token, and the app suggests the matching site for each project and links it in one click (it auto-links when the match is clear). Deploys are tracked live everywhere: a pill in the feature header shows *Deploying to production · 0:42* and then the result, the sidebar marks projects that are deploying, and the Ship tab shows a progress bar, the duration, commit, log and recent history. Deploys that Ploi starts by itself after a merge (auto-deploy on push) are picked up too, and you get a notification when each one finishes. |
| **Local HTTPS sites** | A built-in web server, like Herd: every project gets `https://<project>.localhost` and every change `https://<change>.<project>.localhost`. `.localhost` names resolve on macOS without any DNS setup. A local certificate authority issues a certificate per site on demand. The in-app preview trusts it automatically, and **Trust certificates** (one macOS password prompt) makes Safari and Chrome trust it too. Each site's PHP backend (`php -S` with workers) starts on its first request. Laravel sees real HTTPS, HTTP redirects to HTTPS, WebSockets pass through, and only this Mac can connect. Uses port 443, or 8443 when something like Herd already holds 443. Herd remains an option per project. |
| **Email testing** | A built-in mail catcher (local SMTP). Each change's `.env` points at it, tagged with that change, so its email shows up in the **Email** tab with an HTML preview, plain text, headers and attachments. Nothing reaches real inboxes. |
| **Data** | Tables and rows of the change's own database (MySQL, MariaDB, PostgreSQL, SQLite), read-only queries (changes only when switched on), snapshots and restore, and **Start over with sample data**. |
| **Monitoring** | Live local and SSH Laravel logs with **Fix N errors**, plus the Nightwatch MCP for agents with **Triage & fix top issue**. |

## Keyboard

Everything can be done from the keyboard. Press **⌘K** for the command palette, or **⌘/** to see every shortcut.

| | |
| --- | --- |
| ⌘N / ⇧⌘N | New feature / new chat |
| ⌘K | Command palette (threads, projects, actions) |
| ⌥↑ / ⌥↓, ⌘1–9 | Previous / next thread, jump to thread |
| ⌘L, ⌘. | Focus the message box, stop the agent |
| ⇧⌘M | Model & reasoning menu (↑↓ model, ←→ reasoning) |
| ⌘B, ⌘J | Toggle sidebar, toggle side panel |
| ⌥⌘1–6 | Changes, Preview, Ship, Logs, Terminal, Setup |
| ⌘E, ⇧⌘T, ⇧⌘B | Open in editor / Terminal / browser |
| ⌘+ ⌘− ⌘0 | Text size |
| ↑ in an empty box | Edit your last message |

## Requirements

- macOS (Apple Silicon)
- `git`, and the [GitHub CLI](https://cli.github.com) logged in (`gh auth login`)
- [Claude Code](https://claude.com/claude-code) and/or [Codex CLI](https://developers.openai.com/codex) installed and logged in
- [Laravel Herd](https://herd.laravel.com) for local sites (optional)
- [DBngin](https://dbngin.com) or any local MySQL/Postgres for per-feature databases (optional; SQLite works out of the box)
- A Ploi API token with server and site scopes (optional), created at <https://ploi.io/profile/api-keys>
- SSH key access to your servers for remote logs (optional)

**Settings → Integrations** (also shown on first launch) detects everything and offers one button per missing piece: *Install*, *Repair*, *Sign in* or *Connect*. Installs and sign-ins run visibly in Terminal, and the card turns green on its own when you're done. The app loads your login shell's `PATH`, so it finds Homebrew, Herd and `~/.local/bin` binaries even when launched from Finder.

## Run it

```bash
npm install
npm run dev        # development, with hot reload
npm test           # unit + git/sqlite integration tests
SF_LIVE=1 npx vitest run tests/github.live.test.ts                 # read-only gh checks
SF_LIVE_DB=1 SF_DB_PORT=3308 npx vitest run tests/db.live.test.ts  # creates & drops sf_livetest_* on local MySQL
SF_LIVE_UPDATE=1 npx vitest run tests/updater.live.test.ts        # downloads + verifies the latest GitHub release
SF_LIVE_KEYCHAIN=1 npx vitest run tests/keychain.live.test.ts    # round-trips a throwaway login-keychain item
npm run dist       # builds dist/Spindle-Make-<version>-arm64.dmg (+ .zip for the updater)
```

## Releasing

One command, from a clean, up-to-date `main`:

```bash
npm run release              # next patch: 0.1.0 → 0.1.1
npm run release -- minor     # or major, or an exact version: npm run release -- 1.0.0
npm run release -- --dry-run # preview the version and notes, change nothing
npm run release -- --local   # build and publish from this Mac instead of GitHub Actions
```

If GitHub has no macOS runner free (it happens), publish an already-pushed tag from your Mac with `git checkout v0.1.1 && node scripts/release.mjs publish v0.1.1` — the workflow sees the release exists and skips.

It runs typecheck and tests, bumps the version, moves **Unreleased** in [CHANGELOG.md](CHANGELOG.md) under the new version (or lists the commits since the last release if that section is empty), commits, tags `vX.Y.Z` and pushes. The [Release workflow](.github/workflows/release.yml) then builds the app on a macOS runner and publishes a GitHub release with the DMG, the zip and `SHA256SUMS.txt`. Installed apps pick it up within six hours, or right away via *Check for Updates…*.

Write user-facing notes under `## Unreleased` as you go; they become the release notes and the "What's new" text in the update dialog.

**How updates install:** the app is ad-hoc signed (no Apple Developer ID), so it can't use Squirrel/electron-updater. Instead it downloads the release zip itself, checks it against `SHA256SUMS.txt`, unpacks it, verifies the bundle id and version, and — after you click Restart — a small helper swaps the app bundle (restoring the old one if anything fails) and relaunches. Files the app downloads itself aren't quarantined, so updates open without the Gatekeeper warning. With a Developer ID later, add `CSC_LINK`/`APPLE_ID` secrets and notarization to the workflow.

## Development environment (`.spindle/`)

How a project runs locally lives in the repo, so the whole team shares it and each branch can change it:

```
.spindle/config.json      runtime, site, setup steps, processes, quick commands, database, mail, .env values
.spindle/instructions.md  how the project works — given to the AI on every turn
```

```json
{
  "version": 1,
  "runtime": { "php": "8.4", "node": "22" },
  "site": { "docroot": "public", "command": "" },
  "setup": ["composer install --no-interaction --prefer-dist --no-progress", "npm ci --no-audit --no-fund", "npm run build"],
  "processes": [
    { "name": "Dev server", "command": "npm run dev", "autoStart": true },
    { "name": "Queue worker", "command": "php artisan queue:work --tries=1", "autoStart": true }
  ],
  "commands": ["php artisan test", "php artisan migrate"],
  "database": { "mode": "clone", "migrate": true },
  "mail": { "capture": true },
  "env": { "QUEUE_CONNECTION": "database" }
}
```

- **Edit it** in Project settings → Environment, or by hand. Without a file, Spindle detects sensible defaults; the first edit (or *Save to .spindle*) writes it. Projects Spindle creates get one from the start.
- **Runtime pinning** finds installed PHP/Node versions (Herd, Homebrew, nvm, fnm) and puts them first on PATH for setup steps, processes, the site backend, quick commands and the AI. Spindle warns when a version isn't installed, or is older than the installed Composer packages need.
- **Site**: `docroot` overrides `public/`; `command` replaces PHP's server with your own backend listening on `$PORT` (e.g. a Node app) — Spindle still adds the domain and HTTPS.
- **Per change**: a change follows the main checkout's live file until its branch edits its own copy; then it uses that copy.
- **Approval**: commands from the repo (setup steps, processes, site command, `.env` values) never run until you approve them on this Mac. A pull or a branch (or the AI) changing them asks again — in the change's setup card and in project settings. Edits you make in Spindle count as approved. The editor refuses to save over a file that changed on disk since you opened it.

## Workflow

1. **Add a project** (⌘O): pick a local git repo. The app detects the default branch, the GitHub remote and whether it's a Laravel app, and fills in a setup script and quick commands. In project settings, add environments and link them to Ploi sites; the URL, SSH target and remote path are filled in from Ploi.
2. **New feature** (⌘N): type what you want and press ↵. The worktree, Herd site and database are created while the conversation is already open, and the agent starts as soon as they're ready. You can start more features right away; they run in parallel.
3. **Test**: the pipeline strip moves to *Test* when the agent finishes. Check the **Preview** tab or the `.test` URL, the **Changes** diff, run tests in **Terminal**, and keep chatting to iterate.
4. **Ship**: open the PR (the agent's summary becomes the PR body). Watch checks and use **Fix with agent** on red CI. Then merge.
5. **Deploy**: hit Deploy on an environment, or turn on *auto-deploy on merge*. The status is polled, and failures show the Ploi log plus a **Fix with agent** button.
6. **Monitor**: under **Logs**, use Nightwatch triage, the remote log tail and **Fix N errors**.
7. **Cleanup** happens on its own after shipping. **Archive** (⌘⌫) removes a thread from the sidebar.

## Permission modes

The agents run headless, so there's no interactive approval prompt. Choose per feature:

| Mode | Claude Code | Codex |
| --- | --- | --- |
| Plan only | `--permission-mode plan` | `--sandbox read-only` |
| Ask | `default` (anything that needs approval is denied) | `--sandbox workspace-write` |
| Auto-edit (default) | `acceptEdits` | `--sandbox workspace-write` |
| Auto | `auto` | `--approve-for-me` |
| Full access | `bypassPermissions` | `--dangerously-bypass-approvals-and-sandbox` |

Use *Full access* only for features in an isolated worktree.

## Nightwatch

Nightwatch has no public REST API. Agents reach it through its official **MCP server** (OAuth). Use **Settings → Agent MCP servers → Add**, or the button in **Logs → Nightwatch**. Then authenticate once in a terminal: run `claude` and type `/mcp`, or run `codex mcp login nightwatch`. After that, **Triage & fix top issue** asks the agent to list production issues, read the stack trace and fix the root cause with a test. The Ploi MCP server can be added the same way.

## Architecture

```
src/main/        Electron main process
  agents/        Claude + Codex process runner and stream parsers (normalised ChatItem events)
  factory.ts     feature lifecycle: worktree → setup → agent → PR → merge → deploy
  git.ts         worktrees, branch diff/status, commit, push, sync
  github.ts      gh CLI: PRs, checks, runs, failed logs, merge
  herd.ts        herd link/secure/unlink, site discovery
  ploi.ts        Ploi REST client (deploy + deployment polling)
  mcp.ts         Nightwatch/Ploi MCP registration for agents
  logs.ts        local + SSH Laravel log tailing
  processes.ts   per-feature services & commands (process groups, log files, stdin)
  deploy.ts      live deploy tracking (ours by id, Ploi-initiated by site status + history)
  webserver.ts   built-in HTTPS server: local CA, SNI certs, host routing, PHP backends
  db.ts          per-feature databases (MySQL/MariaDB/Postgres via DBngin binaries, SQLite files)
  models.ts      model catalog (Claude aliases + Codex models cache) and reasoning levels
  integrations.ts  detection + one-click install/repair/sign-in for every integration
  store.ts       JSON state in ~/Library/Application Support/Software Factory (secrets via safeStorage)
src/preload/     typed IPC bridge (window.api)
src/renderer/    React 19 + Tailwind 4 UI (sidebar · chat · Changes/Preview/Ship/Logs/Terminal/Setup)
src/shared/      types, diff parser, log parser, utils
tests/           vitest: parsers, agent runner (fake binary), git worktrees, Ploi client, opt-in live gh test
```

State lives in `~/Library/Application Support/Software Factory/`: `state.json` plus one file per chat thread. The Ploi token is encrypted with macOS `safeStorage`.
