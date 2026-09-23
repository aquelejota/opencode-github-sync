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

## 6. No more divergence: content-based export, state out of the repo, derived-path conflict resolution (2026-09-23)

**Problem.** Four compounding issues surfaced on 2026-09-22, when a DNS failure left both machines committing locally:

- `exportSessions()` compared **gzipped bytes**, and two zlib builds produce different bytes for the same JSON — 804 of the 912 "conflicting" shards had identical content. Every push rewrote the whole repository, so any divergence looked catastrophic and was.
- `_state/*` (`prompt-history.jsonl`, `kv.json`, `model.json`, `frecency.jsonl`) is runtime state rewritten by both machines on every idle, making a rebase conflict a matter of time.
- Any rebase conflict aborted the push, leaving only the manual `pull --force` + `push` rescue.
- Even with identical content, the two machines serialized each table's rows in **different array orders**: SQLite returns rows in rowid order unless told otherwise, and rowids are a per-machine insertion artifact. The shard comparison is positional, so each machine kept rewriting the other's shards (~75 files per machine alternation) even after the byte comparison was fixed.

**Fixes.**

1. `exportSessions()` compares **uncompressed content** — a fast byte path first, `isDeepStrictEqual` when the bytes differ — and only gzips when the shard is actually written. `written` now counts real writes; new `unchanged` counter.
2. `stageIn()` deletes the repository's `_state/` when `includeState` is false, so turning the option off is self-cleaning (same pattern as credentials). The local `~/.local/state/opencode` is never touched by pulls.
3. `pushBranch()` resolves a conflicted rebase automatically when **every** conflict is in a derived path (`_sessions/`, `_state/`, `_data/`; credentials excluded): this machine's version wins, and the other machine re-exports its newer copy on its next push. A conflict anywhere else still aborts with the original error.
4. `buildShard()` sorts each table's rows by a value derived from the row itself — the `id` when there is one, canonical JSON (keys sorted) otherwise — so the exported JSON no longer depends on the local rowid order.

**Tests.** `tests/sessions.test.ts`: "does not rewrite a shard whose content is unchanged but whose bytes differ" (same JSON re-gzipped at level 1 is left untouched), "reports changed and unchanged sessions separately", "exports the same content regardless of the local row order" (two databases, the same rows inserted in opposite orders, export to identical shards). `tests/sync.test.ts`: "removes state from the repository when the option is turned off", "auto-resolves a rebase conflict confined to derived paths" (the remote tip is asserted to carry the local bytes), "still refuses a rebase conflict outside derived paths".

**Evidence (production, 2026-09-23).** First push after deploying: 14 changed files (10 vendor build artifacts + 4 `_state` deletions) and 1 session shard — against ~900 files per push before. Follow-up pushes carry only the live session's shard, whose content genuinely changed. `git ls-files _state` is empty and stays empty while all four files remain locally.

**Evidence (row order, production, 2026-09-23).** Before fix 4 the two machines ping-ponged the same 75 shards: ryzendeb 11:55 (75), thinkdeb 12:14 (77, same 75), ryzendeb 12:27 (76, same 75) — byte sizes reverting exactly while the only difference was the array order of `part` rows. After deploying fix 4, the first push normalised 132 of 928 shards once (4 vendor files + 132 shards, 136 changes); the next push carried only the two live sessions' shards (2 changes).

## Migration notes

- The first export after switching rewrites every shard once, because the stable `exportedAt` value differs from the old wall-clock one. One large commit, then incremental.
- Switching to the canonical row order normalises only the shards whose local rowid order differs from the sorted order (132 of 928 on the machine that deployed first). One commit, then incremental.
- No settings or shard-format changes: CLI, overrides, `extraPaths` and the `opencode_sync` tool behave as before.

## Distribution note (opencode 1.18.31)

On opencode 1.18.31 installing a plugin from an npm/git spec failed silently on our machines: the package was fetched to `~/.cache/opencode/packages/`, but the plugin module was never imported — no error toast, no log line. The working path was a local file plugin that re-exports the vendored `dist/`:

```js
// ~/.config/opencode/plugins/opencode-sync-fork.js
export { default } from "../vendor/opencode-github-sync/dist/plugin/index.js";
```

Both machines run it this way, with `vendor/` carried inside the synced config repository. The npm/git spec remains the intended install path once the loader issue is understood.

