import type { ChangeSummary, ChangedFile, Reporter } from "../core/reporter.js";
export declare function write(line?: string): void;
/**
 * The product wordmark.
 *
 * Rendered on every command so the output reads as one coherent tool rather
 * than a pile of scripts.
 */
export declare function banner(subtitle?: string, badge?: string): void;
export declare function rule(width?: number): void;
export declare function heading(text: string): void;
export declare function keyValue(key: string, value: string, width?: number): void;
export declare function ok(message: string): void;
export declare function fail(message: string): void;
export declare function warn(message: string): void;
export declare function info(message: string): void;
export declare function step(message: string): void;
export declare function detail(message: string): void;
export declare function summaryLine(summary: ChangeSummary): string;
/**
 * Print the changed files.
 *
 * The list is capped so a large sync does not bury the important lines; the
 * full list is one environment variable away.
 */
export declare function changeList(files: ChangedFile[]): void;
export declare function outcome(message: string, changed: boolean): void;
/** A live spinner that degrades to a single static line when not a TTY. */
export declare class Spinner {
    private label;
    private timer;
    private frame;
    private active;
    /** Last label printed in non-animated mode, so restarts do not duplicate it. */
    private printed;
    constructor(label: string);
    start(): void;
    update(label: string): void;
    /** In non-animated mode each distinct label is printed exactly once. */
    private print;
    stop(): void;
}
/** Reporter that renders straight to the terminal. */
export declare function createCliReporter(spinner?: Spinner): Reporter;
//# sourceMappingURL=render.d.ts.map