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

## 7. One schema family per shard (OpenCode 2, 2026-10-16)

**Problem.** An OpenCode 2 database keeps the legacy V1 tables (`session`, `message`, `part`) next to its own (`session_v2`, `session_message`), and every migrated conversation is stored in both. The export table list included both families, so each shard held the same messages twice: re-exporting the 1105 shards produced ~608 MB of payload and the push died on the Forgejo proxy (HTTP 504, repeatedly).

**Fix.** An export now ships exactly one family, chosen by the local schema: `session_v2` + `session_message` when the database has the V2 tables, `session` + `message` + `part` otherwise. Shards written from a V2 database carry `generation: "v2"` (additive field — older V1 readers ignore it). The import routes the session row by generation, skips V2 shards whole on a V1 database (`skippedV2Only`), and the export refuses to downgrade a shard that is already `generation: "v2"` — a V1 machine coming back online cannot rewrite V2 shards forever or strip their data.

**Tests.** `tests/sessions.test.ts`: "exports V2 sessions once — session_v2 rows plus session_message — without the legacy tables", "never downgrades a shard already written with generation v2", "skips V2 shards whole when the local database has no session_v2", "round-trips V2 sessions into an empty V2 database", "keeps last-writer-wins per generation (V2 shard vs session_v2 time)".

**Evidence (production, 2026-10-16).** Full export of the live 1116-session database: 1113 shards in 19.6 s, 309 MB — against 611 MB with both families. Three sessions exceed the 20 MB shard cap and stay local.

**Remark.** The first V2 push rewrites every shard once (format change), then incremental again.

## 8. V2 runtime: real event shapes and per-location instances (2026-10-16)

**Problem.** V2 hosts instantiate plugins once per location and deliver every event to every instance, with a different envelope than V1: payloads live under `event.data` (not `event.properties`) and there is no `session.idle` — a successful turn ends with `session.execution.succeeded`. Ported plugins that kept the V1 shapes failed silently: the continuity prompt never fired and the idle auto-push never ran.

**Fix.** The V2 setup path was rewritten against the observed contract. The plugin listens for `session.execution.succeeded` with a machine-wide 10 s debounce, and its startup pull plus event subscription are guarded to run once per process.

**Evidence (production, 2026-10-16).** The idle auto-push produced `sync: 2026-10-16 15:24:33 from ryzendeb` right after a run, using the new event.

## 9. Sync progress toasts in the OpenCode 2 TUI (2026-10-16)

**Problem.** Under V2 the plugin runs inside the background service — a different process from the TUI — so `client.tui.showToast`, the V1 flash channel, does not exist and every sync ran silently: no phases, no heartbeat, no result, no failures.

**Fix.** The plugin appends every toast it would show — same messages, same variants — to a JSONL log under the state root (`src/plugin/progress-file.ts`, a `begin` marker per run), and a CLI plugin (`src/tui.ts`, exposed through the `tui` entrypoint: the loader calls `setup(context)`) tails the file and shows `ui.toast.show` in the TUI. The state root stays out of the sync, the log rotates on each run, and both write and read failures are swallowed on purpose — the progress trail must never break a sync.

**Evidence (production, 2026-10-16).** On a real push: `Sync: exporting sessions…` → `Sync: 22 file(s) to apply…` → `Sync: sent 22 file(s) in 16s` appeared in the TUI (v2.0.31), matching the V1 wording. 6 new tests (`tests/progress-file.test.ts`); 117 green.

**Deploy note.** The service does not hot-reload plugins the way the TUI does: after updating the vendored `dist`, restart the service so the new code loads.

## 10. Machine-local secrets stay out of the repository (2026-10-17)

**Problem.** OpenCode 2 writes the background-service password to `service.json` **inside the config directory** — which is the sync worktree. `writeRepoMetadata()` regenerates `.gitignore` from `DEFAULT_GITIGNORE` on every sync, so the file was never listed there; `stageIn()` runs `git add -A`, so the password was committed and pushed on the next auto-push (first seen in the ryzendeb push of 2026-10-16 15:24). A hand edit to `.gitignore` is not a fix: the next sync rewrites the file from the constant, re-adds the secret and commits the revert — which is exactly what happened when it was fixed by hand on 2026-10-17 (15 s later, same machine).

**Fix.** `service.json` joins `DEFAULT_GITIGNORE` under a "machine-local secrets" heading: the password is per machine and has no reason to travel. Untracking it (`git rm --cached`) is then durable, because no sync regenerates the entry away.

**Test.** `tests/repo.test.ts` → "ignores the machine-local service password" and "writes both metadata files, even when they already exist" (a hand-edited `.gitignore` is rewritten to the constant). 119 green.

**Note.** The file stays on disk; only its presence in the repository is removed. A password already pushed stays in that repository's history — rotate it by deleting the file and restarting the service, which mints a new one.

## 11. A V2 shard whose todos reference the legacy `session` table is no longer rolled back (2026-10-17)

**Problem.** An OpenCode 2 database keeps the legacy tables (`session`, `message`, `part`) next to its own (`session_v2`, `session_message`, …), and `todo.session_id` / `session_share.session_id` still reference the **legacy** `session` table, not `session_v2`. A V2 shard ships `session_v2` + `session_message` + `todo`, so importing one into a database that has both families tried to insert `todo` rows for a session that existed only in `session_v2` — the foreign key failed, the transaction rolled back, and the **entire session** was lost. On the 2026-10-17 recovery of the machine that had been offline for three weeks, 45 of 1046 shards failed this way; every one of them carried `todo` rows.

**Fix.** When a V2 shard carries rows for a table that still references the legacy `session` table, the import now also upserts the session row into legacy `session` (when that table exists). This is what OpenCode itself stores for a migrated conversation — it lives in both families — and the upsert is the same non-destructive `ON CONFLICT DO UPDATE`, so no cascade is triggered. A V2 shard without such tables still writes no legacy row.

**Test.** The test schema declared no foreign key on `todo`, so no test could see this. `tests/sessions.test.ts` now declares the real ones (`todo.session_id → session.id`, `session_message.session_id → session_v2.id`), the fixture only gives todos to the conversation that has both families, and a new test ("imports a V2 shard's todos by mirroring the legacy session row") fails with `FOREIGN KEY constraint failed` when the mirror is removed. 120 green.

**Evidence.** Reproduced against the real database with one failing shard: `project` OK, `session_v2` OK, `session_message` OK, `todo` → `FOREIGN KEY constraint failed`; with the legacy mirror inserted first, everything applies. After the fix the same 45 shards import cleanly.

## 12. The vendored plugin build travels with the repository (2026-10-17)

**Problem.** `DEFAULT_GITIGNORE` carried an unanchored `plugin/` ("empty directories recreated by OpenCode at runtime"). A gitignore pattern without a leading slash matches at any depth, so it also swallowed `vendor/opencode-github-sync/dist/plugin/` — the OpenCode 2 plugin entrypoint. The sync repository shipped `dist/core` and `dist/cli` but never `dist/plugin`, so a machine that pulled got a plugin whose `core` was current and whose `index.js` was an old hand-copied build. On the machine that had been offline for three weeks that stale entrypoint still exported a V1 function, and OpenCode 2 refused to load it (`Plugin must export a default definition with an id and an effect or setup function`) — no plugin, no sync, no error toast.

**Fix.** The pattern is anchored: `/plugin/`. The vendored `dist/plugin` and `dist/tui.js` are now committed and travel like the rest of `vendor/`. Since the file is regenerated from the constant on every sync, the fix belongs in the constant, not in the file.

**Test.** `tests/repo.test.ts` → "ignores the runtime plugin directory but not the vendored plugin build" runs `git check-ignore` against both paths on a freshly initialised repo. 121 green.

**Note.** The plugin entrypoint is what the local bridge plugin re-exports (`plugins/sync-fork.js` → `vendor/.../dist/plugin/index.js`), so a stale copy silently disables sync on that machine; restarting the service does not fix it, because nothing pulls the file.

## 13. Deletions travel: session tombstones (2026-10-18)

**Problem.** The import only ever upserted (`importSessions` has no `DELETE`), so a session deleted on one machine did not reach the other: the other machine's database kept the row, its export rebuilt the shard, and the next pull imported it back. The workaround was a hand-written script carrying the explicit id list, run on the other machine *before* its first push.

**Fix.** The export writes a deletion marker under `_sessions/_deleted/<id>.json` (`{ id, deletedAt }`) when a shard disappears **because the session is gone from the local database** — and only then: a session that merely left the retention window (`days`/`maxSessions`) still has its row and produces no marker. The import reads the markers, deletes the local row (children first — `todo`, `message`, `part`, `session_share`, `session_message`, … then the session row) and skips the matching shard. Last-writer-wins still applies: when the local row (or the incoming shard) is newer than the marker, the session was resumed after the deletion, so it is kept or imported and the export drops the marker. The export also refuses to publish a tombstoned session that has not changed since the deletion, which stops the ping-pong at its source.

**Generation guard.** A V1 database cannot import V2 shards, so it now leaves them alone entirely: no marker, no removal. Until now a V1 machine could delete a V2 machine's shards while pruning — "never downgrade" only covered selected sessions.

**Tests.** `tests/sessions.test.ts` → "session tombstones": marker written on deletion; no marker for the retention window; import deletes the row and its children and ignores the shard; a session resumed after the deletion survives and the marker is dropped; the two-machine cycle (delete on A, export on B, pull on A keeps it deleted, B applies the marker). Plus "a V1 database neither tombstones nor removes V2 shards it cannot read". 127 green.

## 14. Repository growth: a size nudge, a compaction script and `/compact-sync` (2026-10-18)

**Problem.** Every push rewrites the whole shard of each session that changed, and nothing ever prunes history: the sync repository reached **8.3 GB of `.git` against 389 MB of content** (1,929 commits in 59 days). Items 12 and 13 removed the two churn amplifiers (the cross-machine ping-pong and the volatile `project.time_active`); what remained is that trimming history is a decision only the user can make, and it must be made at a moment when both machines are quiet.

**Fix.** Three pieces. **(1)** `push()` measures the repository with `git count-objects -v` and, once past `REPO_SIZE_ALERT_BYTES` (1.5 GB) and at most once a week, warns with `{ notify: true }` — on V2 that becomes a toast *and* a `notify-send` desktop notification, and the text names the command to run. The throttle marker lives in the state root, outside the repository, so the nudge adds no churn. **(2)** `scripts/compact-sync-repo.sh` (shipped in the synced config) performs the squash: it refuses unless the worktree is clean and the branch is exactly in sync, pauses `autoPushOnIdle` for the duration, creates a single orphan commit with the current content, force-pushes with `--force-with-lease`, gc's locally and prints the exact steps for the other machine. The content does not change, so nothing needs re-importing — only the disk is recovered. **(3)** `commands/compact-sync.md` exposes it as `/compact-sync`; its shell block runs the read-only `--check` (shell blocks run outside the tool permission flow, so the destructive part stays a tool call with confirmation).

**Tests.** 5 new cases in `tests/growth.test.ts`: quiet below the limit, speaking up past it, the weekly interval, disabled with a zero limit, and `repoBytes` against a real temporary repository. 133 green.

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

