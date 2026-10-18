/** Written by `scripts/build-info.mjs` while `npm run build` runs. */
export interface BuildInfo {
    version: string;
    commit: string;
    builtAt: string;
}
/**
 * Which build is actually loaded.
 *
 * The plugin is vendored into the synced config directory, so two machines can
 * run different builds of the same version and nothing says so — it took a
 * hand-run `md5sum` comparison to find that out. Reporting the sha in the
 * `opencode_sync status` result turns it into a one-line check.
 */
export declare function buildInfo(): BuildInfo | undefined;
//# sourceMappingURL=build-info.d.ts.map