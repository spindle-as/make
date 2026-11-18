# Changelog

All notable changes to Spindle Make. `npm run release` moves the **Unreleased** section under the new version.

## Unreleased

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

