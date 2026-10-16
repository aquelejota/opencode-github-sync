import type { Reporter } from "./reporter.js";
import type { SessionSettings } from "./settings.js";
import { type SqliteDatabase } from "./sqlite.js";
/**
 * `event` and `event_sequence` are deliberately excluded. They are an internal
 * append-only runtime log, they dwarf everything else in row count, and nothing
 * about resuming a conversation on another machine depends on them.
 */
export interface SessionRecord {
    id: string;
    title: string;
    directory: string;
    timeUpdated: number;
    timeCreated: number;
    projectId: string;
}
export interface SessionShard {
    formatVersion: 1;
    session: Record<string, unknown>;
    project?: Record<string, unknown>;
    workspace?: Record<string, unknown>;
    tables: Record<string, Record<string, unknown>[]>;
    exportedAt: number;
    /**
     * Present only on shards produced from an OpenCode 2 database. The field is
     * additive, so V1 readers that predate it simply ignore it; readers that know
     * it use it to route the session row (`session` vs `session_v2`), to refuse
     * V2-only shards on a V1 database, and to never downgrade a V2 shard.
     */
    generation?: "v2";
}
export interface SelectOptions extends SessionSettings {
    now?: number;
}
export interface ExportResult {
    /** Sessions whose shard was written or rewritten. */
    written: string[];
    /** Sessions whose shard on disk already had this exact content. */
    unchanged: string[];
    skippedTooLarge: {
        id: string;
        title: string;
        bytes: number;
    }[];
    considered: number;
}
export interface ImportResult {
    imported: number;
    skippedOlder: number;
    /** V2 shards skipped whole because the local database has no `session_v2`. */
    skippedV2Only: number;
    failed: {
        file: string;
        reason: string;
    }[];
}
/** Session ids are opaque; keep them filesystem-safe without losing identity. */
export declare function sanitizeId(id: string): string;
/**
 * Choose which sessions to export.
 *
 * Explicitly included ids always win, even when they fall outside the window.
 * Everything else must be inside the time window, pass the directory filter and
 * survive the count cap, which keeps the newest sessions.
 */
export declare function selectSessions(db: SqliteDatabase, options: SelectOptions): SessionRecord[];
/** Export the selected sessions into `<repo>/_sessions`. */
export declare function exportSessions(databaseFile: string, repoRoot: string, options: SelectOptions, reporter: Reporter): Promise<ExportResult>;
/**
 * Import every shard from `<repo>/_sessions` into the local database.
 *
 * Shards written by an OpenCode 2 machine (`generation: "v2"`) land in the V2
 * tables and are skipped whole when the local database is still V1. Shards
 * without the marker keep the original V1 behavior.
 */
export declare function importSessions(databaseFile: string, repoRoot: string, reporter: Reporter): Promise<ImportResult>;
/** List sessions available locally, newest first — powers `sessions list`. */
export declare function listSessions(databaseFile: string, limit: number): Promise<SessionRecord[]>;
//# sourceMappingURL=sessions.d.ts.map