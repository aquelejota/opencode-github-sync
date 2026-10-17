# Roadmap / open items

Ideas not yet implemented, kept here so we can decide before writing code.
Numbered independently from `CHANGES.md` (which documents what is already done).

---

## R1. Deletions do not travel: session tombstone + GC

**Status:** open — to discuss before implementing.
**Raised:** 2026-10-17 (Ryzendeb, "fix restante" round: 79 sessions were deleted
locally and would come back from the other machine on its next export).

### Problem

`exportSessions()` prunes shards that no longer qualify (`pruneShards` removes the
file from the repository), but `importSessions()` only ever *upserts* what the
shards contain — there is no `DELETE` anywhere in `src/`. So:

1. Machine A deletes session `S` from its DB. The next export removes
   `_sessions/<S>.json.gz` and the push carries the deletion.
2. Machine B still has `S` in its DB. On pull, nothing in the shard set refers to
   `S`, so its import does nothing (fine). But on its next **export**, `S` is still
   a candidate, so B **writes the shard back** and pushes it.
3. Machine A pulls the resurrected shard. `S` is absent locally, so the
   last-writer-wins check finds no local row and `S` is **imported again**.

Deleting a session is therefore only durable if every machine deletes it by hand
(that is what `docs/tarefa-thinkdeb-fix-restante.md` in the config project does
today: a handoff script with the explicit id list).

### Why it matters more in OpenCode 2

The V2 UI makes it easy to delete sessions/projects (`Ctrl+X` menus, project
removal), so users will hit this without knowing. The symptom is confusing: the
session reappears on the machine where it was deleted, some minutes later.

### Options considered

1. **Tombstone file** — `_sessions/_deleted.json` (or `.ndjson`), a repository-level
   list of `{ id, deletedAt, deletedBy }`. Export appends an entry whenever a shard
   that exists on disk is about to be pruned *because its session is gone from the
   DB* (the retention-window prune must **not** create tombstones). Import, before
   the upsert loop: for each tombstone newer than the local row, `DELETE` the local
   rows and skip the shard.
   - Pros: explicit, cheap (one small file), survives rebases, easy to test.
   - Cons: the file grows forever unless compacted; "newer than the local row"
     needs a clock assumption (we already trust `time_updated` for LWW, so this is
     consistent); needs a rule for "the session was recreated on purpose" —
     probably: a newer local `time_created` wins and drops the tombstone.
2. **Full GC reconciliation on pull** — compare the shard set against the local DB
   and delete sessions that are absent from the repo. Simple, but **unsafe**: it
   cannot distinguish "deleted elsewhere" from "never synced" (e.g. a session
   created while offline, or one excluded by the retention window/`exclude` list).
   Only viable with tombstones marking the difference.
3. **Config-level `sessions.exclude` as a kill list** — no code change, but per
   machine (`opencode-sync.jsonc` is not synced) and it only stops the *export*;
   the other machine still has to do the same. Not a solution, only a patch.

### Open questions

- Should the tombstone live in `_sessions/` (one file per shard family) or in
  `_data/`? `_sessions/` keeps the shard logic together; `_data/` matches the
  "repository metadata" role.
- Compaction policy: drop tombstones older than N days, or keep them forever
  (a few hundred bytes each)?
- Interaction with `pull --force`: a force pull adopts the remote state — should it
  also apply tombstones (yes, presumably) and drop local tombstones for sessions
  the remote still has (probably yes)?
- What should the toast say when a pull applies tombstones ("3 sessions deleted on
  another machine")?

### Test plan (vitest, `tests/sessions.test.ts`)

1. Export after deleting a session locally writes a tombstone and removes the shard.
2. Import of a tombstone deletes the local session, its messages and its children
   (session_message has `ON DELETE CASCADE`, so a plain `DELETE FROM session_v2`
   is enough — verify with foreign keys ON).
3. Import of a shard whose id is tombstoned but whose `time_created` is newer than
   the tombstone keeps the local row and drops the tombstone.
4. Retention-window pruning does **not** write tombstones.
5. Two-machine simulation: A deletes, pushes; B pulls, B exports, B pushes; A pulls —
   the session stays deleted on both.

### Notes from the 2026-10-17 incident

- Backup material for the deleted sessions is still in the sync repository history
  and in the pre-round DB backup (`~/backups/opencode/2026-10-17-fix-restante/` on
  the Ryzendeb), so nothing was lost — but the round needed a hand-written script
  and a "run before the first push" ordering constraint, which is exactly the kind
  of footgun this item removes.
