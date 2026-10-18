
## 3.1.0

### Added
- **Session tombstones.** Deleting a session now travels between machines. The
  export writes `_sessions/_deleted/<id>.json` when a shard disappears because
  the session left the database (never for the retention window); the import
  deletes the local row (children first) and ignores that shard. Last-writer-wins
  keeps a session that was resumed after the deletion, and a V1 database no
  longer touches V2 shards it cannot read. (`CHANGES.md` item 13)
- **Repository growth tooling.** A push past 1.5 GB warns — toast plus a desktop
  notification, at most once a week — and names `scripts/compact-sync-repo.sh`
  and the `/compact-sync` command, which squash the shard history behind guards
  (clean tree, exactly in sync, `--yes`, auto-push paused). (item 14)
- **Build identity and deployment.** `npm run build` writes
  `dist/build-info.json` (version, commit, `+dirty` when the tree is dirty) and
  `status` reports it, so "which build is loaded?" is one line instead of a
  hand-run checksum; `scripts/update-vendor.sh` builds and mirrors `dist/` into
  the vendored copy and prints the restart reminder. (item 15)

### Fixed
- The export no longer ships `project.time_active`, which the app rewrites
  continuously — one activity bump used to rewrite every shard of that project
  (26 files per push on a 26-session project).
- A V2 shard carrying `todo`/`session_share` rows is no longer rolled back by the
  foreign key against the legacy `session` table. (item 11)
- The vendored plugin entrypoint travels again: the unanchored `plugin/` line in
  the generated `.gitignore` was swallowing `vendor/…/dist/plugin/`. (item 12)
- `service.json` is ignored, so the V2 service password stops being committed.
  (item 10)

### Changed
- The export compares uncompressed content and canonical row order, and rebases
  that only touch derived paths (`_sessions/`, `_state/`, `_data/`) resolve
  automatically. (item 6)
- One schema family per shard (item 7), V2 event shapes and per-location
  instances (item 8), and sync progress toasts in the V2 TUI (item 9).

## 3.0.1

### Fixed
- `status` no longer reports the config file as uncommitted work on machines
  that use per-machine overrides. The file on disk is *supposed* to differ from
  the committed version once overrides are in play, so plain `git status`
  flagged it as modified forever — a warning the user could never clear. The
  config is now compared with overrides subtracted, so only genuine edits count.
- `git status --porcelain` output is parsed by pattern rather than at a fixed
  column offset. Output is trimmed before parsing, which removed the leading
  column of an unstaged entry and shifted every field after it, silently
  yielding a truncated filename.

## 3.0.0

Complete rewrite. The previous release was a set of shell-wrapped Node scripts;
this is a typed library with two entry points and a real test suite.

### Added
- **OpenCode plugin.** Startup pull, optional push on idle, and an
  `opencode_sync` tool. The CLI remains, because a plugin cannot repair the
  configuration that stops the plugin from loading.
- **Per-machine overrides.** `opencode-sync.overrides.jsonc` is deep-merged into
  the config after every pull and subtracted again before every push, so an
  overridden key is invisible to sync in both directions.
- **Selective session sync.** Sessions are exported one at a time as gzipped
  JSON shards, selected by time window, explicit include list, project directory
  and per-session size cap. Import is a transactional upsert; the newer
  `time_updated` wins.
- `opencode-sync init` / `link` for one-command setup through the GitHub CLI.
- `--dry-run` on push and pull.
- `extraPaths` for syncing arbitrary additional files.
- Cross-platform CI on Node 20/22/24 across Linux, macOS and Windows.

### Changed
- Rewritten in TypeScript, published to npm as `opencode-github-sync`.
- New terminal UI with colour that degrades correctly for pipes, `NO_COLOR`
  and non-truecolor terminals.
- Commit messages now use a stable pseudonym rather than the raw hostname, so a
  corporate asset tag can never reach the repository.
- Line endings are pinned to LF in the worktree; `text=auto` alone was rewriting
  shell scripts inside skills to CRLF on Windows.
- Credential syncing is opt-in and refused on public repositories.

### Removed
- Whole-database session sync and the Git LFS dependency. Committing
  `opencode.db` stops being viable once it passes a gigabyte, and copying it
  alongside a live write-ahead log risks capturing torn data.
- The shell/`.cmd` wrapper scripts, replaced by a real `bin` entry.

### Fixed
- A push is now verified by reading the remote head back; `git push` can exit
  zero without the remote moving.
- Symlinks and Windows junctions are refused instead of followed.
- File and directory replacements are atomic, so an interrupted sync cannot
  leave a half-written config.
- Nested `.git` directories left behind by skill installs are stripped from the
  staging copy, so skill contents are committed as files rather than as unusable
  gitlinks.
- A cross-process lock prevents concurrent syncs from the plugin, the CLI and
  multiple OpenCode windows.
