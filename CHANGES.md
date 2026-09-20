# Changes in this fork

Base: **opencode-github-sync 3.0.1** (MIT) by [@doomsday616](https://github.com/doomsday616). The base history is preserved and the `upstream` remote still points at the original repository.

## 1. Deterministic session shard export (upstream issue #3)

**Problem.** `buildShard()` in `src/core/sessions.ts` wrote `exportedAt: Date.now()` into every shard, so the payload changed on every export even when the session had not. `exportSessions()` compares gzipped bytes before rewriting, so it always rewrote. With `autoPushOnIdle`, every idle produced a commit touching all shards; with `autoPullOnStartup`, every machine pulled all of them.

**Fix.** `exportedAt` is derived from the session's own `time_updated`. The field stays for format compatibility (import reads `shard.session.time_updated`, not `exportedAt`), but an unchanged session now serialises to identical bytes.

**Evidence.** 914 shards exported twice: 914 identical, 0 different. In production, a push that used to touch ~912 files now carries only the sessions actually in use (0–2 files, ~13 s instead of ~65 s).

**Test.** `tests/sessions.test.ts` → "writes byte-identical shards on a repeat export" (strengthened to compare bytes, not just mtime).

## 2. Non-blocking sync with progress toasts (new)

**Problem.** The core's `git()` helper uses `execFileSync`. The plugin's `void runPull(...)` only defers a call that then blocks the event loop — and with it the TUI — for the whole sync. On a slow pull this looks exactly like a hang: a black screen with no feedback.

**Fix.** `src/plugin/worker.ts` runs the same core `pull()`/`push()` on a worker thread and posts progress messages over `postMessage`. `src/plugin/index.ts` relays them as toasts: phase labels, a 15 s heartbeat for long phases, and a final summary. A sync that finishes in under 3 s without changes stays silent. `src/plugin/progress.ts` holds the pure message/formatting logic, covered by `tests/progress.test.ts`.

**Evidence.** With 915 incoming shards the TUI became interactive in 2.1 s while the sync ran in the background, reporting "applying 912 sessions…" and heartbeats; an unreachable remote produces a toast instead of a frozen screen.

## 3. Import no longer deletes sessions (upstream issue #2)

**Problem.** `upsert()` used `INSERT OR REPLACE`. SQLite's REPLACE deletes the conflicting row before inserting the replacement, and deleting a `project` row cascades through `session.project_id -> project.id ON DELETE CASCADE`. Importing many shards that share a project (they all do: `global`) therefore deleted every session imported before the last.

**Fix.** A true UPSERT: `INSERT ... ON CONFLICT DO UPDATE SET ...` never deletes.

**Test.** The test schema now declares the same foreign key as OpenCode, and "keeps every session when shards share one project" imports two shards sharing a project and asserts both survive.

**Note.** Most visible on Node-run setups: `node:sqlite` enables foreign keys by default, `bun:sqlite` does not. OpenCode under Bun (the common case) hides the bug; Node 22.5+ exposes it.

## 4. The synthetic global project stays local (upstream issue #4)

**Problem.** Every session with `project_id = 'global'` shipped the shared, machine-specific project row (`worktree`, `vcs`, `time_updated`), which could overwrite the receiving machine's own row and re-dirty shards on the next export.

**Fix.** `buildShard()` skips the `project` block when the session references `global`. Import reads nothing for it and OpenCode creates its own row.

**Test.** "does not export the synthetic global project row".

## 5. Session tests actually run under vitest

**Problem.** Under vitest, `await import("node:sqlite")` throws ("Failed to load url sqlite") because the runner resolves it as a project file. `sqliteAvailable()` then reported `false`, and every session test began with `if (!available) return;` — a silent pass. That is how issues #2 and #3 stayed green in CI.

**Fix.** `src/core/sqlite.ts` falls back to `createRequire(import.meta.url)("node:sqlite")` when the dynamic import fails. Plain Node and Bun are unaffected (the dynamic import succeeds there).

**Evidence.** The session suite went from ~15 ms (every test early-returning) to ~95 ms with the database actually exercised; reverting each fix makes the corresponding test fail.

## Migration notes

- The first export after switching rewrites every shard once, because the stable `exportedAt` value differs from the old wall-clock one. One large commit, then incremental.
- No settings or shard-format changes: CLI, overrides, `extraPaths` and the `opencode_sync` tool behave as before.

## Distribution note (opencode 1.18.31)

On opencode 1.18.31 installing a plugin from an npm/git spec failed silently on our machines: the package was fetched to `~/.cache/opencode/packages/`, but the plugin module was never imported — no error toast, no log line. The working path was a local file plugin that re-exports the vendored `dist/`:

```js
// ~/.config/opencode/plugins/opencode-sync-fork.js
export { default } from "../vendor/opencode-github-sync/dist/plugin/index.js";
```

Both machines run it this way, with `vendor/` carried inside the synced config repository. The npm/git spec remains the intended install path once the loader issue is understood.

