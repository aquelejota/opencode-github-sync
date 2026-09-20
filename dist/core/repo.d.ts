/**
 * Files the sync repository must never track.
 *
 * Three categories:
 *   - local-only settings (`opencode-sync*.jsonc`)
 *   - the SQLite database and its journals, which are gigabytes and are
 *     represented instead by the shards in `_sessions/`
 *   - caches, logs and OS junk
 */
export declare const DEFAULT_GITIGNORE = "# opencode-github-sync \u2014 machine-local, never committed\nopencode-sync.jsonc\nopencode-sync.overrides.jsonc\n.opencode-sync.lock\n\n# Runtime / generated\nnode_modules/\nbun.lock\nlogs/\n**/__pycache__/\n*.pyc\n\n# Session storage lives in _sessions/ as portable shards.\n# The raw database is far too large for git and cannot be merged.\n_data/opencode.db\n_data/opencode.db-shm\n_data/opencode.db-wal\n_data/bin/\n_data/log/\n_data/tool-output/\n_data/snapshot/\n_data/storage/session\n_data/storage/session_diff\n\n# Machine-local UI state\n_state/session.json\n\n# Empty directories recreated by OpenCode at runtime\nplugin/\n\n# OS files\n.DS_Store\nThumbs.db\ndesktop.ini\n";
export declare const DEFAULT_GITATTRIBUTES = "# Store and check out everything with LF.\n# \"text=auto\" alone would rewrite files to CRLF on Windows, which silently\n# breaks shell scripts shipped inside skills and makes every cross-platform\n# pull look like a whole-file change.\n* text=auto eol=lf\n\n# Append-only history files merge cleanly by taking both sides\n_state/prompt-history.jsonl text eol=lf merge=union\n\n# Session shards are gzipped JSON \u2014 binary, and never line-merged\n_sessions/*.json.gz binary\n";
/**
 * Paths that exist inside the worktree but must stay out of every commit.
 *
 * These are runtime artefacts of the machine, not configuration. They are
 * excluded from `add`, from stashing and from `clean`, so a sync can never
 * delete a user's local database or tool output.
 */
export declare const LOCAL_RUNTIME_PATHS: string[];
export declare function isLocalRuntimePath(candidate: string): boolean;
export declare function excludePathspecs(): string[];
/** Unstage runtime paths in a single git call — subprocesses are slow on Windows. */
export declare function unstageLocalRuntimePaths(root: string): void;
export interface EnsureRepoOptions {
    root: string;
    remote: string;
    branch: string;
}
export type RepoState = "ready" | "adopted" | "fresh";
/** Configure identity and metadata files. Safe to call repeatedly. */
export declare function ensureGitIdentity(root: string): void;
export declare function writeRepoMetadata(root: string): void;
/**
 * Make `root` a git worktree pointing at `remote`.
 *
 * Returns `adopted` when the remote already had commits (they become the local
 * state) and `fresh` when the remote exists but is empty.
 */
export declare function initRepo(options: EnsureRepoOptions): RepoState;
export declare function ensureRepo(options: EnsureRepoOptions): RepoState;
/** Fail fast when the remote is unreachable, distinguishing auth from network. */
export declare function assertRemoteReachable(root: string, branch: string, operation: string, allowMissingBranch?: boolean): void;
/**
 * Verify the commit really landed on the remote.
 *
 * `git push` can exit zero against a misconfigured proxy or a stale credential
 * helper without the remote actually moving, so success is confirmed by reading
 * the remote head back.
 */
export declare function assertPushLanded(root: string, branch: string, operation: string): void;
export declare const REPO_DIRS: {
    DATA_DIR: string;
    STATE_DIR: string;
    AGENTS_DIR: string;
    SESSIONS_DIR: string;
};
//# sourceMappingURL=repo.d.ts.map