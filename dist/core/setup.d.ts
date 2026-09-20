import { type Roots } from "./paths.js";
import type { Reporter } from "./reporter.js";
/**
 * First-run setup.
 *
 * The single biggest barrier to a sync tool is the setup: create a repository,
 * find its URL, put it somewhere the tool can read, authenticate. All of that
 * is automated through the GitHub CLI, which most OpenCode users already have
 * authenticated. Every step is idempotent, so re-running after a failure is
 * always safe.
 */
export declare class SetupError extends Error {
    constructor(message: string);
}
export declare function ghAvailable(): boolean;
export declare function assertGhReady(): void;
export declare function currentGitHubUser(): string;
export interface RepoTarget {
    owner: string;
    name: string;
}
/** Accept `name`, `owner/name`, or nothing (defaults applied by the caller). */
export declare function parseRepoTarget(input: string | undefined, defaultOwner: string): RepoTarget;
export declare function repoExists(target: RepoTarget): boolean;
export declare function repoIsPrivate(target: RepoTarget): boolean;
export declare function createRepo(target: RepoTarget, reporter: Reporter): void;
export interface SetupOptions {
    repo?: string;
    reporter: Reporter;
    roots?: Roots;
    /** Enable credential syncing. Only allowed for private repositories. */
    includeCredentials?: boolean;
    /** Enable selective session syncing. */
    includeSessions?: boolean;
}
export interface SetupResult {
    target: RepoTarget;
    created: boolean;
    settingsFile: string;
    overridesFile: string;
}
/** Create (or adopt) a repository and write the local settings files. */
export declare function initSync(options: SetupOptions): SetupResult;
/** Point this machine at an existing sync repository. */
export declare function linkSync(options: SetupOptions): SetupResult;
/** Guess which of the user's repositories is a sync repository. */
export declare function discoverSyncRepos(): string[];
//# sourceMappingURL=setup.d.ts.map