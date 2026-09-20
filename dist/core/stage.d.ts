import { type Roots } from "./paths.js";
import type { Reporter } from "./reporter.js";
import type { Settings } from "./settings.js";
export interface StageContext {
    repoRoot: string;
    roots: Roots;
    settings: Settings;
    reporter: Reporter;
    force: boolean;
}
export declare function createStageContext(repoRoot: string, settings: Settings, reporter: Reporter, force: boolean, roots?: Roots): StageContext;
/** Copy everything from the machine into the repository worktree. */
export declare function stageIn(ctx: StageContext): void;
/**
 * Rewrite the repository's config file with override-owned keys removed.
 *
 * The baseline comes from `git show HEAD:<file>`, not from disk: the worktree
 * and the config directory are the same place, so the file on disk already has
 * this machine's overrides applied to it.
 *
 * Without overrides nothing happens at all, which keeps comments and formatting
 * byte-identical for the majority of users.
 *
 * Returns true when the file on disk was changed.
 */
export declare function normalizeConfigForRepo(ctx: StageContext): boolean;
/** Copy everything from the repository worktree back onto the machine. */
export declare function stageOut(ctx: StageContext): void;
/**
 * Drop cached plugin packages that the config no longer references.
 *
 * Only `package.json` and the stale module directories are touched; OpenCode
 * reinstalls whatever it still needs on the next start. Returns how many
 * packages were removed.
 */
export declare function prunePluginCache(configRoot: string, cacheRoot: string): number;
/**
 * Reduce a plugin specifier to its package name.
 *
 * `opencode-foo@1.2.3` -> `opencode-foo`
 * `@scope/opencode-foo@1.2.3` -> `@scope/opencode-foo`
 */
export declare function pluginSpecToName(spec: string): string;
//# sourceMappingURL=stage.d.ts.map