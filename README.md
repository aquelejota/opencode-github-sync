# opencode-github-sync — session-sync fork

> **Resumo (PT-BR):** Fork do [opencode-github-sync](https://github.com/doomsday616/opencode-github-sync) focado em **sincronizar sessões** do OpenCode entre máquinas. **Não sou desenvolvedor:** isto foi "vibecoded" com **OpenCode + DeepSeek v4.1 Flash**, para uso pessoal e de amigos — tenha cuidado ao implementar e recomendo usar seu agente para revisar e ajustar. Mudanças principais: export de sessões determinístico (fim do churn de ~900 arquivos por sync), pull/push numa worker thread com toasts de progresso (a TUI não trava mais) e correções para dois bugs de sessão abertos no upstream (perda de dados no import e projeto `global` vazando entre máquinas).

> ⚠️ **Vibecoded — use with care.** I'm not a developer. This fork was vibe-coded with **OpenCode + DeepSeek v4.1 Flash** for personal use and for friends. Take care before deploying it: review and adjust the implementation with your own agent. It works for us, but treat it as experimental and keep backups.

A fork of [doomsday616/opencode-github-sync](https://github.com/doomsday616/opencode-github-sync) (MIT) that keeps the same plugin/CLI surface — same settings file, same commands, same private-repository model — and fixes the parts that hurt in daily use with **session sync enabled**.

The deterministic-export fix is also proposed upstream: [PR #5](https://github.com/doomsday616/opencode-github-sync/pull/5).

---

## Why this fork exists

Two machines, session sync on, `autoPullOnStartup` and `autoPushOnIdle` enabled. In practice:

- Every push rewrote **all ~912 session shards**, so every push was a 900-file commit and every startup pull downloaded all of them.
- That pull ran **synchronously on the event loop**. With a cold cache it blocked startup for **29 s to 8 m 37 s** — the TUI just showed a black screen, which looks exactly like a hang. There was no progress indicator, so waiting was indistinguishable from being broken.
- Two open upstream issues hurt session sync directly: [#2](https://github.com/doomsday616/opencode-github-sync/issues/2) (import can silently delete previously imported sessions through an `INSERT OR REPLACE` + `ON DELETE CASCADE` interaction) and [#4](https://github.com/doomsday616/opencode-github-sync/issues/4) (the machine-specific synthetic `global` project row is shipped between machines).

This fork fixes all of that, and its test suite actually exercises the session paths.

## What changed

| # | Change | Upstream ref |
|---|--------|--------------|
| 1 | **Deterministic session shards.** `exportedAt` comes from the session's own `time_updated` instead of `Date.now()`, so an unchanged session produces identical bytes and pushes stay incremental. | [#3](https://github.com/doomsday616/opencode-github-sync/issues/3), [PR #5](https://github.com/doomsday616/opencode-github-sync/pull/5) |
| 2 | **Non-blocking sync with progress toasts.** Pull and push run on a worker thread (`src/plugin/worker.ts`); the plugin shows phases ("fetching", "applying 912 sessions…"), a heartbeat for long phases, and a final summary. A fast no-op stays silent. | new |
| 3 | **Import never deletes sessions.** The upsert is a true `ON CONFLICT DO UPDATE` instead of `INSERT OR REPLACE`; replacing a shared `project` row no longer cascades through `session.project_id` and wipes sessions imported earlier in the same run. | [#2](https://github.com/doomsday616/opencode-github-sync/issues/2) |
| 4 | **`global` project stays local.** The synthetic project row and its machine-specific `worktree`/`vcs` metadata are not exported, so importing cannot overwrite the receiving machine's row. | [#4](https://github.com/doomsday616/opencode-github-sync/issues/4) |
| 5 | **Session tests actually run.** Under vitest the dynamic `import("node:sqlite")` fails to resolve, `sqliteAvailable()` returned `false` and every session test returned early — which is how the two bugs above stayed green in CI. The loader now falls back to `createRequire`. | fixed here |
| 6 | **Content-based export, canonical row order, state out of the repo.** The export compares uncompressed content (not gzip bytes) and sorts rows by `id`, so two machines stop rewriting each other's shards; `_state/` left the repository and conflicts that only touch derived paths (`_sessions/`, `_state/`, `_data/`) resolve themselves. | fixed here |
| 7 | **One schema family per shard.** A V2 shard carries `session_v2` + `session_message` only, and a V1 reader skips it whole instead of importing half a session. Export payload on our repository: 611 MB → 309 MB. | V2 |
| 8 | **V2 runtime.** The plugin speaks OpenCode 2's event shapes and per-location instances, so pull-on-startup and push-on-idle work under the background service. | V2 |
| 9 | **Sync toasts in the V2 TUI.** V2 has no client channel inside the service, so the service appends progress to a JSONL under the state root and a small CLI plugin tails it into `ui.toast.show`. | V2 |
| 10 | **Machine-local secrets stay out of the repository.** `service.json` — the V2 background-service password — joins `DEFAULT_GITIGNORE`; a hand edit is not enough, because the file is regenerated on every sync. | fixed here |
| 11 | **A V2 shard carrying `todo`/`session_share` is no longer rolled back.** Those tables reference the legacy `session` row, so the imported session is mirrored there too; without it the foreign key aborted the whole session. | fixed here |
| 12 | **The vendored plugin build travels.** The `plugin/` line in the generated `.gitignore` was unanchored and swallowed `vendor/…/dist/plugin/`, so a fresh machine got everything except the entrypoint. | fixed here |
| 13 | **Deletions travel: session tombstones.** Deleting a session writes `_sessions/_deleted/<id>.json`; the import deletes the row (children first) and skips that shard, with last-writer-wins keeping a session that was resumed after the deletion. | new |
| 14 | **Repository growth is watched, not ignored.** A push past the size threshold warns (toast + desktop notification, at most weekly) and names `scripts/compact-sync-repo.sh` / the `/compact-sync` command, which squash the history behind guards. | new |
| 15 | **You can tell which build is running.** `npm run build` writes `dist/build-info.json` (version, sha, `+dirty` when the tree is dirty) and `status` reports it; `scripts/update-vendor.sh` builds and mirrors `dist/` into the vendored copy. | new |

Measured on a real two-machine setup (~912 shards):

| | before | after |
|---|---|---|
| files per push (no session changed) | ~912 | 0–2 |
| push duration | ~65 s | ~13 s |
| startup pull with 915 incoming files | TUI blocked for the whole pull | TUI ready in **2.1 s**, sync in background |
| export stability (914 shards exported twice) | all bytes differ | **914 identical, 0 different** |
| repository after 59 days (one rewritten shard per push) | `.git` **8.3 GB**, 1,930 commits | **~380 MB** after fixing the churn and rebuilding the repository |

## Sessions first

The point of this fork is sessions. Enable them in `~/.config/opencode/opencode-sync.jsonc` (machine-local, never committed):

```jsonc
{
  "repo": { "url": "https://<your-git-host>/you/your-opencode-sync.git", "branch": "main" },
  "machineAlias": "laptop",
  "includeCredentials": false,
  "includeSkills": true,
  "includeState": true,
  "sessions": {
    "enabled": true,
    "days": 36500,          // keep everything; or narrow the window
    "maxSessions": 5000,
    "maxSessionBytes": 20971520,
    "include": [],
    "exclude": [],
    "directories": []
  },
  "autoPullOnStartup": true,  // now non-blocking, with progress toasts
  "autoPushOnIdle": true
}
```

Everything else (overrides, CLI commands, `extraPaths`, the `opencode_sync` tool, credentials opt-in) is unchanged from upstream — see the [upstream README](https://github.com/doomsday616/opencode-github-sync#readme) for the full reference.

## Install

As an OpenCode plugin, pointing at this fork:

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-github-sync@git+https://github.com/aquelejota/opencode-github-sync.git"]
}
```

The build output (`dist/`) is committed, so no build step is needed on install.

> **Caveat (observed on opencode 1.18.31).** Installing a plugin from an npm/git spec can fail *silently*: the package is fetched into `~/.cache/opencode/packages/`, but the plugin is never imported — no toast, no log line. If the startup pull never runs, vendor `dist/` into your config and load it from a local plugin file instead (this path is proven and syncs with the rest of your config):
>
> ```bash
> mkdir -p ~/.config/opencode/vendor/opencode-github-sync
> cp -r dist ~/.config/opencode/vendor/opencode-github-sync/
> ```
>
> ```js
> // ~/.config/opencode/plugins/opencode-sync-fork.js
> export { default } from "../vendor/opencode-github-sync/dist/plugin/index.js";
> ```
>
> Then keep `"opencode-github-sync"` out of the `plugin` array and update `vendor/` from this repository when you pull a new version.

CLI, if you want the rescue path too:

```bash
npm install -g github:aquelejota/opencode-github-sync
```

## Compatibility

- Settings, shard format and commands are unchanged — you can point an existing upstream setup at this fork.
- The first export after switching rewrites every shard once (the `exportedAt` value changes), producing one big commit. After that, pushes only carry what actually changed.
- The `opencode_sync` tool still reports its result synchronously; the startup pull and idle push are the asynchronous paths.

## Verification

```bash
npm install
npm run check     # lint + typecheck + 135 tests
npm run build
```

The test suite now genuinely exercises SQLite-backed session tests (including regression tests for the two upstream session bugs). Negative controls were checked: reverting each fix makes the corresponding test fail.

## Roadmap

Open items we want to agree on before writing code live in [ROADMAP.md](./ROADMAP.md) — currently: session tombstones so deletions travel between machines (today a deleted session comes back from the other machine's next export).

## Credits & license

- Based on [opencode-github-sync](https://github.com/doomsday616/opencode-github-sync) by [@doomsday616](https://github.com/doomsday616) — MIT, see [LICENSE](./LICENSE).
- Issue reports that described the session bugs: [@logser13](https://github.com/logser13) (#2, #3, #4).
- Fork changes: [@aquelejota](https://github.com/aquelejota). See [CHANGES.md](./CHANGES.md) for the technical detail.

[MIT](./LICENSE)
