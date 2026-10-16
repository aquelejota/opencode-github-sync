/**
 * Progress bridge between the sync plugin (server side) and the V2 CLI plugin.
 *
 * V1 runs the plugin in the same process as the TUI, so the toasts the worker
 * progress deserves can be shown through the client. V2 does not: the plugin
 * runs inside the background service while the TUI is a separate process, so
 * there is no client to call. Every toast the plugin would show is appended to
 * a small JSONL file under the state root instead, and `src/tui.ts` — the CLI
 * plugin the TUI loads — tails that file and shows the toasts.
 *
 * The state root is machine-local and excluded from the sync itself, so the log
 * never leaks into the repository.
 */
import fs from "node:fs";
import path from "node:path";
import { getRoots } from "../core/paths.js";
export const PROGRESS_FILE = "opencode-github-sync-progress.jsonl";
export function progressFilePath(roots = getRoots()) {
    return path.join(roots.state, PROGRESS_FILE);
}
/**
 * Truncate the log and mark the start of a sync, so the reader can tell a
 * fresh run from entries it has already shown.
 */
export function beginProgress(roots, action) {
    try {
        fs.mkdirSync(roots.state, { recursive: true });
        fs.writeFileSync(progressFilePath(roots), `${JSON.stringify({ kind: "begin", action, at: Date.now() })}\n`);
    }
    catch {
        // The progress log is cosmetic: a sync must never fail over it.
    }
}
export function appendProgress(roots, message, variant) {
    try {
        fs.mkdirSync(roots.state, { recursive: true });
        fs.appendFileSync(progressFilePath(roots), `${JSON.stringify({ kind: "toast", message, variant, at: Date.now() })}\n`);
    }
    catch {
        // Same: never break a sync over the progress log.
    }
}
/**
 * Parse a chunk of the log into the toasts it carries. Pure on purpose: the
 * reader in `src/tui.ts` only has to deal with file offsets around it, and the
 * parsing rules are testable without a TUI.
 */
export function splitProgressLines(raw) {
    const toasts = [];
    for (const line of raw.split("\n")) {
        const text = line.trim();
        if (!text)
            continue;
        try {
            const entry = JSON.parse(text);
            if (entry?.kind !== "toast")
                continue;
            if (typeof entry.message !== "string" || !entry.message)
                continue;
            toasts.push({
                message: entry.message,
                variant: typeof entry.variant === "string" ? entry.variant : "info",
            });
        }
        catch {
            // partial write or garbage
        }
    }
    return toasts;
}
//# sourceMappingURL=progress-file.js.map