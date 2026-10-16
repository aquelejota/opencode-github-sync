import { type Roots } from "../core/paths.js";
export declare const PROGRESS_FILE = "opencode-github-sync-progress.jsonl";
export declare function progressFilePath(roots?: Roots): string;
/**
 * Truncate the log and mark the start of a sync, so the reader can tell a
 * fresh run from entries it has already shown.
 */
export declare function beginProgress(roots: Roots, action: string): void;
export declare function appendProgress(roots: Roots, message: string, variant: string): void;
export interface ProgressToast {
    message: string;
    variant: string;
}
/**
 * Parse a chunk of the log into the toasts it carries. Pure on purpose: the
 * reader in `src/tui.ts` only has to deal with file offsets around it, and the
 * parsing rules are testable without a TUI.
 */
export declare function splitProgressLines(raw: string): ProgressToast[];
//# sourceMappingURL=progress-file.d.ts.map