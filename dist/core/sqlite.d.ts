/**
 * Minimal SQLite adapter.
 *
 * OpenCode stores every session in a single SQLite database. We need to read
 * and write it without dragging in a native dependency, because this package is
 * loaded inside the OpenCode runtime where a compiled addon would have to match
 * whatever engine the user happens to be running.
 *
 * Two built-in drivers are supported, in preference order:
 *   1. `bun:sqlite`  — present when OpenCode runs the plugin under Bun
 *   2. `node:sqlite` — Node 22.5+
 *
 * Neither requires an install step. When neither is available session sync is
 * disabled with a clear message rather than failing halfway through.
 */
export interface SqliteStatement {
    all(...params: unknown[]): any[];
    run(...params: unknown[]): unknown;
}
export interface SqliteDatabase {
    prepare(sql: string): SqliteStatement;
    exec(sql: string): void;
    close(): void;
}
export interface OpenOptions {
    readOnly?: boolean;
}
export declare class SqliteUnavailableError extends Error {
    constructor();
}
export declare function sqliteAvailable(): Promise<boolean>;
export declare function openDatabase(file: string, options?: OpenOptions): Promise<SqliteDatabase>;
/** Which of the given tables actually exist in this database. */
export declare function existingTables(db: SqliteDatabase, candidates: string[]): string[];
/** Column names of a table, in declaration order. */
export declare function tableColumns(db: SqliteDatabase, table: string): string[];
//# sourceMappingURL=sqlite.d.ts.map