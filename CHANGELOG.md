# Changelog

All notable changes to Spindle Make. `npm run release` moves the **Unreleased** section under the new version.

## Unreleased

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
