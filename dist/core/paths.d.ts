/**
 * Resolve every directory opencode-github-sync knows about.
 *
 * Each root can be overridden with an environment variable, which is what the
 * test-suite uses to run against a scratch directory instead of the real
 * machine.
 */
export interface Roots {
    /** `~/.config/opencode` — also the git worktree for the sync repo. */
    config: string;
    /** `~/.local/share/opencode` — auth, account, sqlite database. */
    data: string;
    /** `~/.local/state/opencode` — frecency, kv store, model cache. */
    state: string;
    /** `~/.agents/skills` — skills installed by the `skills` CLI. */
    agents: string;
    /** `~/.cache/opencode` — plugin package cache. */
    cache: string;
}
export declare function getConfigRoot(): string;
export declare function getDataRoot(): string;
export declare function getStateRoot(): string;
export declare function getAgentsRoot(): string;
export declare function getCacheRoot(): string;
export declare function getRoots(): Roots;
/** Path of the OpenCode SQLite database that holds all sessions. */
export declare function getDatabasePath(roots?: Roots): string;
/** Directory inside the sync repo where session shards are written. */
export declare const SESSIONS_DIR = "_sessions";
/** Directory inside the sync repo mirroring the OpenCode data root. */
export declare const DATA_DIR = "_data";
/** Directory inside the sync repo mirroring the OpenCode state root. */
export declare const STATE_DIR = "_state";
/** Directory inside the sync repo mirroring `~/.agents/skills`. */
export declare const AGENTS_DIR = "_agents";
//# sourceMappingURL=paths.d.ts.map