import { type Roots } from "./paths.js";
import { type ChangedFile, type Reporter, emptySummary } from "./reporter.js";
import { type Settings } from "./settings.js";
export interface SyncOptions {
    settings?: Settings;
    roots?: Roots;
    reporter?: Reporter;
    /** Overwrite the other side on conflict. */
    force?: boolean;
    /** Compute the result without writing anything to the remote. */
    dryRun?: boolean;
}
export interface SyncResult {
    action: "push" | "pull";
    changed: boolean;
    summary: ReturnType<typeof emptySummary>;
    files: ChangedFile[];
    sessions?: {
        exported?: number;
        imported?: number;
        skipped?: number;
    };
    message: string;
    /** True when OpenCode must restart for the pulled config to take effect. */
    restartRequired: boolean;
}
declare class SyncError extends Error {
    constructor(message: string);
}
export declare function push(options?: SyncOptions): Promise<SyncResult>;
export declare function pull(options?: SyncOptions): Promise<SyncResult>;
export interface StatusResult {
    configured: boolean;
    remote?: string;
    branch: string;
    initialized: boolean;
    ahead: number;
    behind: number;
    dirty: number;
    lastCommit?: string;
    lastCommitDate?: string;
    sessionsEnabled: boolean;
    sessionShards: number;
    overridesActive: boolean;
    machineAlias: string;
}
export declare function status(options?: SyncOptions): StatusResult;
export declare function formatBytes(bytes: number): string;
export { SyncError };
//# sourceMappingURL=sync.d.ts.map