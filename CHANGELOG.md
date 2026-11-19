# Changelog

All notable changes to Spindle Make. `npm run release` moves the **Unreleased** section under the new version.

## Unreleased

## v0.1.4 — 2026-11-19

- **Simpler, calmer interface** (following Google's Material 3 guidelines): one clear main action per area, quiet surfaces instead of outlines, pill-shaped buttons with bigger click targets, stronger text contrast and a clear keyboard focus ring everywhere.
- **A much simpler message box**: just your message, one settings button (model, thinking effort, what the agent may do on its own, goal mode, spend limit — all in one panel) and Send. Goal mode and unusual permissions show as a small chip so you always see them.
- **Commands that work**: the `/` menu lists only commands that work in Spindle, explains each in plain words, groups them (commands, skills, plugins), says when nothing matches, and runs commands like `/context`, `/compact` or `/code-review` as soon as you pick them. Fixed: answers from commands like `/context`, `/mcp` and `/usage` never showed up.
- **No more side tabs**: the side panel shows the preview; a single menu switches to changes, emails, data, logs and the rest, each with a one-line explanation. Review & ship is now one focused dialog, opened from the next-step button or the stage chip in the header.
- **Tidier header and preview**: one header row (title, stage, open in browser, side panel, and a ⋮ menu for the rest) and a one-row preview toolbar with **Comment** and **Log in as** up front.

## v0.1.3 — 2026-11-19

- **Fixed: SQLite databases that "didn't exist"** although Spindle said it created them. Changes sharing the main database now point at the main checkout's file (they pointed at a missing file inside the worktree), and every change's `.env` gets the database's full path, so artisan, the preview server, Herd and the AI all open the same file. Re-run setup on an existing change to fix it.
- **Smarter setup**: Spindle works out what a project needs and in which order — dependencies and build, then migrations, sample data for new databases (when the seeders do something), then things like `storage:link` or Passport keys. It follows Laravel 12's `composer setup` script and suggests commands it finds in the README, Makefile or `bin/setup`. **Detect with AI** has Claude read the project (read-only) and propose the setup for you to review.
- **Exact models**: pick a specific Claude version (Opus 5.5, Sonnet 5.5, Fable 5.2, Opus 4.8 …) or type any model ID; aliases still follow the latest. Optional fallback model in Settings → Agents.
- **The full Claude Code harness**: type `/` for every command and skill Claude Code has (including `/goal`, `/compact`, `/code-review`, `/security-review`, `/simplify` and your own), `@` to hand work to a subagent, or turn on **Goal** to keep Claude going until the goal is met. Subagents show their own steps nested and live, the agent's task list is a live checklist (and the status bar says which step it's on), plans come with **Approve & build**, context compaction is shown, and a chip lists the loaded skills, subagents and MCP servers (with status). Codex custom prompts work as `/name` too.
- **Log in as any user** (Laravel apps): a *Log in as* button in the preview lists the users in that change's database — search by name, email or id, pick one, and the preview is logged in as them. No passwords, no login form, nothing added to your app's code. Works with Breeze, Jetstream, Fortify, Filament and custom session logins; refuses on production.
- **Simpler setup in Creator mode**: a new change shows one progress bar in plain words ("Getting your copy ready" → "Your copy is ready") with technical steps behind *Details*, and if something fails, *Fix it for me* hands it to Claude. Project settings show only what a creator decides — tips for Claude, what data each change starts with, and keeping emails inside Spindle; the rest stays in Developer mode.
- Setup no longer creates a `package-lock.json` in projects that don't have one (it showed up as a change you never made).

- **New look**: a neutral, modern design in dark and light (follows macOS, or pick one in Settings → Appearance). The Spindle logo stays; the green theme is gone. Colour now only means something: blue = working, amber = needs you, green = done, red = problem. Buttons, tabs and lists respond to presses, new messages ease in, and "working" gently shimmers.
- **Compact message box**: the send button sits inside the box, and model, reasoning and permissions moved to a small row underneath.
- **Sidebar for many threads**: collapse it to a slim icon rail (⌘B or the button at the top), search threads, compact one-line rows, long projects show the latest few with "Show more", and shipped changes and long-idle chats move to a collapsed **Done & older** section at the bottom.

## v0.1.2 — 2026-11-18

- **Start changes from the live app**: *Start a change* now shows your project's main version running next to the description box. Point at anything in it, say what should change, and *Start a change* turns those notes (with screenshots) into a new change in its own workspace. The main version stays current: it fast-forwards to the latest main when it's clean, and refreshes packages, assets and migrations only when they changed.
- **Fixed: "Couldn't store the secret: the macOS Keychain isn't available."** Keychain access no longer blocks the app or times out behind a prompt, and if saving ever fails you now see macOS's actual reason.

## v0.1.1 — 2026-11-18

- **Fixed: crash about decrypting a saved token** ("Error while decrypting the ciphertext provided to safeStorage"). Tokens now live in the macOS Keychain, so app updates can't make them unreadable. Old tokens move over automatically in the background — or, if macOS doesn't allow it, Ploi asks you to connect again once.
- **Fixed: the preview reset when switching tabs** (or threads, or closing the panel), which broke logins and OTP flows. Previews now stay alive, and when the AI finishes it offers *New changes — reload* instead of reloading under you.
- **Always clear whose turn it is**: a status bar above the message box shows *working* (what it's doing, for how long, Stop), *waiting for you*, or *done — your turn* with the next step. Threads that finished while you were elsewhere are marked in the sidebar and counted on the Dock icon.
- **Clear next steps** while testing and after: *Try it*, *Check & submit*, review status, deploy — plus a short "how to test" guide in the preview.
- **Check changes shows live progress**: which check is running, its output as it happens, elapsed time, an estimate from earlier passing runs, and a Stop button. Checks also work for projects without GitHub.
- **Merging waits for green CI**: merging is blocked (and refused by the app itself) while GitHub checks are running or after they failed.
- Background errors show as a message instead of a crash dialog.

## v0.1.0 — 2026-11-18

First public release of Spindle / Make — from idea to pull request in one app.

- **Changes as conversations**: every change gets its own git worktree, branch, database and HTTPS site, so several can run in parallel. Plain chats work too.
- **Claude Code and Codex**, with model and reasoning-level choice, live approvals and questions from the agent.
- **Preview and visual feedback**: point at parts of the page and send them to the AI with screenshots.
- **Built-in HTTPS web server**: `https://<change>.<project>.localhost` with local certificates; Laravel Herd works too.
- **Per-change databases** in DBngin MySQL/Postgres or SQLite, cleaned up after shipping.
- **Email capture, database browser and checks** built in.
- **Ship from the app**: pull requests with honest descriptions, CI status, merge, and Ploi deploys with live status.
- **Permissions enforced in the app**: contributors end at “Submit for review”; the AI has the same limits.
- **Development environment in the repo** (`.spindle/`): runtime versions, setup steps, processes, notes for the AI; commands need approval before they run.
- **Self-updating**: new versions download in the background and install with one click.

