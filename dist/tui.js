/**
 * OpenCode V2 CLI plugin: sync progress toasts in the TUI.
 *
 * V2 runs the sync (and its server-side plugin) inside the background service —
 * a different process from the TUI — so the toasts the V1 path shows through
 * the client have no channel there. The service appends every toast it would
 * show to a JSONL log under the state root (`plugin/progress-file.ts`); this
 * plugin watches that file and shows each new entry as a toast.
 *
 * The TUI loads it through the directory `tui` entrypoint (cli.json `plugins`),
 * in the same style as the other local plugins: a tiny bridge file re-exports
 * this module from the vendored `dist`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { getRoots } from "./core/paths.js";
import { progressFilePath, splitProgressLines } from "./plugin/progress-file.js";
const POLL_MS = 700;
const TOAST_DURATION_MS = 6_000;
export default {
    id: "opencode-github-sync.tui",
    async setup(ctx) {
        const file = progressFilePath(getRoots());
        const show = (message, variant) => {
            try {
                ctx?.ui?.toast?.show?.({ title: "sync", message, variant, duration: TOAST_DURATION_MS });
            }
            catch {
                // The TUI is not reachable (headless) — nothing to do.
            }
        };
        // Desktop notification for alerts the user should see even without looking
        // at the TUI. Best effort: no notifier (or no session bus) is not an error.
        const notifyDesktop = (message) => {
            try {
                const child = spawn("notify-send", ["opencode sync", message], {
                    detached: true,
                    stdio: "ignore",
                });
                child.on("error", () => { });
                child.unref();
            }
            catch {
                // Ignored on purpose.
            }
        };
        // Start from the end of the log: history belongs to previous sessions.
        let offset = 0;
        let inode = 0;
        try {
            const stat = fs.statSync(file);
            offset = stat.size;
            inode = stat.ino;
        }
        catch {
            // No log yet — the first sync will create it.
        }
        const pump = () => {
            try {
                const stat = fs.statSync(file);
                if (stat.ino !== inode || stat.size < offset) {
                    // Truncated or replaced (`beginProgress` starts a fresh log).
                    offset = 0;
                    inode = stat.ino;
                }
                if (stat.size <= offset)
                    return;
                const fd = fs.openSync(file, "r");
                let raw = "";
                try {
                    const buffer = Buffer.alloc(stat.size - offset);
                    fs.readSync(fd, buffer, 0, buffer.length, offset);
                    raw = buffer.toString("utf8");
                }
                finally {
                    fs.closeSync(fd);
                }
                // Only consume complete lines: a torn trailing write is retried on the
                // next tick with the rest of its bytes.
                const lastNewline = raw.lastIndexOf("\n");
                if (lastNewline === -1)
                    return;
                const complete = raw.slice(0, lastNewline + 1);
                offset += Buffer.byteLength(complete, "utf8");
                for (const toast of splitProgressLines(complete)) {
                    show(toast.message, toast.variant);
                    if (toast.notify)
                        notifyDesktop(toast.message);
                }
            }
            catch {
                // File rotated mid-read; the next tick will pick it up.
            }
        };
        pump();
        const timer = setInterval(pump, POLL_MS);
        timer.unref?.();
        return () => clearInterval(timer);
    },
};
//# sourceMappingURL=tui.js.map