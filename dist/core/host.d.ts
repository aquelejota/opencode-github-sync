/**
 * A short, stable alias for the current machine.
 *
 * Commit messages record which machine produced a change. Raw hostnames are a
 * bad idea: corporate machines are often named after an asset tag, which is
 * effectively personally identifying information, and the sync repo may not
 * stay private forever. So unless the user picks a name explicitly we derive a
 * stable pseudonym from a hash of the hostname.
 *
 * Precedence:
 *   1. `OPENCODE_SYNC_HOST_ALIAS` environment variable
 *   2. `machine.alias` in the sync config file (passed in as `configured`)
 *   3. `<platform>-<hash>` fallback
 */
export declare function hostAlias(configured?: string): string;
/** Keep aliases filesystem- and commit-message-safe. */
export declare function sanitizeAlias(value: string): string;
/** Build a sync commit message: `sync: 2026-07-29 10:04:11 from mac-1a2b3c`. */
export declare function commitMessage(prefix: string, alias: string): string;
//# sourceMappingURL=host.d.ts.map