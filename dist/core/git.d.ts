export interface GitResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    code: number | null;
}
export interface GitOptions {
    cwd: string;
    /** Allow git to prompt on the terminal. Off by default so we never hang. */
    interactive?: boolean;
    timeoutMs?: number;
}
/**
 * Run git and never throw.
 *
 * Every caller wants to inspect the failure rather than unwind, so the exit
 * status is returned as data. Terminal prompting is disabled by default: a sync
 * that silently blocks on a hidden credential prompt is far worse than one that
 * fails fast with an actionable message.
 */
export declare function git(args: string[], options: GitOptions): GitResult;
export declare function gitAsync(args: string[], options: GitOptions): Promise<GitResult>;
export declare function isGitRepo(dir: string): boolean;
export declare function firstLine(text: string): string;
/** True when a git failure is really "your GitHub credentials are not working". */
export declare function isAuthFailure(result: GitResult): boolean;
export declare class GitAuthError extends Error {
    readonly result: GitResult;
    constructor(operation: string, result: GitResult);
}
export declare class GitError extends Error {
    readonly result: GitResult;
    constructor(operation: string, result: GitResult);
}
/** Convert a failed `GitResult` into the most specific error we can. */
export declare function toGitError(operation: string, result: GitResult): Error;
/**
 * Extract the file paths from `git status --porcelain` output.
 *
 * The format is fixed-width — two status columns, a space, then the path — but
 * this deliberately does not slice at a fixed offset. Output here is trimmed
 * before parsing, which eats the leading space of an unstaged entry (` M file`)
 * and shifts every subsequent column. Matching the status field by pattern
 * instead survives that, as well as the quoting git applies to paths with
 * unusual characters.
 *
 * Renames appear as `old -> new`; the destination is reported, since that is
 * what exists afterwards.
 */
export declare function parsePorcelainPaths(output: string): string[];
export interface NameStatusEntry {
    kind: "added" | "modified" | "deleted" | "renamed";
    path: string;
}
/**
 * Parse `git diff --name-status` output.
 *
 * Rename entries carry three tab-separated fields (`R100  old  new`); we report
 * the destination path because that is what exists after the operation.
 */
export declare function parseNameStatus(output: string): NameStatusEntry[];
//# sourceMappingURL=git.d.ts.map