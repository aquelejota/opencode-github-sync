/**
 * Terminal presentation layer.
 *
 * The core never writes to stdout directly. It emits structured events through
 * a `Reporter`, so the same sync logic can render as a pretty CLI, as silent
 * JSON, or as OpenCode toast notifications from inside the plugin.
 */
export type ChangeKind = "added" | "modified" | "deleted" | "renamed";
export interface ChangeSummary {
    added: number;
    modified: number;
    deleted: number;
    renamed: number;
}
export interface ChangedFile {
    kind: ChangeKind;
    path: string;
}
export interface Reporter {
    step(message: string): void;
    info(message: string): void;
    success(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    detail(message: string): void;
    changes(summary: ChangeSummary, files: ChangedFile[]): void;
}
export declare const silentReporter: Reporter;
/** Collects everything for later inspection — used by the plugin and tests. */
export declare class CollectingReporter implements Reporter {
    readonly lines: {
        level: string;
        message: string;
    }[];
    summary: ChangeSummary;
    files: ChangedFile[];
    private push;
    step(message: string): void;
    info(message: string): void;
    success(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    detail(message: string): void;
    changes(summary: ChangeSummary, files: ChangedFile[]): void;
    get text(): string;
}
export declare function emptySummary(): ChangeSummary;
export declare function summarize(files: ChangedFile[]): ChangeSummary;
export declare function totalChanges(summary: ChangeSummary): number;
//# sourceMappingURL=reporter.d.ts.map