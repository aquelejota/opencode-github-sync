/** Locate the OpenCode config file inside a directory, if there is one. */
export declare function findConfigFile(dir: string): string | undefined;
export declare function hasOverrides(configRoot: string): boolean;
export declare function loadOverrides(configRoot: string): Record<string, any>;
/**
 * Merge the local overrides into the config file after a pull.
 *
 * Returns true when the file was rewritten.
 */
export declare function applyOverrides(configRoot: string): boolean;
/**
 * Remove override-owned keys from an effective config so it can be pushed.
 *
 * `previous` is the version currently stored in the repository; the values it
 * holds for overridden keys are what gets restored. Keys the repository has
 * never seen are dropped.
 */
export declare function stripOverrides(effective: Record<string, any>, overrides: Record<string, any>, previous: Record<string, any> | undefined): Record<string, any>;
/**
 * True when the config on disk is, apart from override-owned keys, exactly what
 * the repository already holds.
 *
 * Once overrides are in use the file on disk permanently differs from the
 * committed version — that is the whole point. Plain `git status` therefore
 * reports it as modified forever, which looks like pending work that never goes
 * away. This lets the status command tell a real edit apart from the expected
 * override difference.
 *
 * Returns `false` when there are no overrides, so callers fall back to git.
 */
export declare function configMatchesRepo(configRoot: string, previousText: string | undefined): boolean;
/**
 * Produce the text that should be committed for the config file.
 *
 * `previousText` is the version currently recorded in the repository. It has to
 * be read out of git rather than off disk, because the worktree *is* the config
 * directory — the file on disk is the effective config, overrides and all, so
 * using it as the baseline would quietly publish this machine's overrides.
 *
 * Returns `undefined` when the file can be committed as-is.
 */
export declare function configTextForRepo(configRoot: string, previousText: string | undefined): string | undefined;
//# sourceMappingURL=overrides.d.ts.map