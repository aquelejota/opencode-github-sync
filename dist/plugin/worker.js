/**
 * Sync worker.
 *
 * The core's `git()` helper is synchronous (`execFileSync`), so a pull or push
 * started on the main thread freezes everything else in the OpenCode process —
 * including the TUI that is supposed to show the sync happening. The plugin
 * therefore runs the exact same core calls here, on a worker thread, and
 * relays progress messages to the main thread.
 */
import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { withSyncLock } from "../core/lock.js";
import { SESSIONS_DIR, getRoots } from "../core/paths.js";
import { pull, push } from "../core/sync.js";
const action = workerData?.action === "push" ? "push" : "pull";
const startedAt = Date.now();
function post(message) {
    parentPort?.postMessage(message);
}
function countShards(configRoot) {
    try {
        return fs
            .readdirSync(path.join(configRoot, SESSIONS_DIR))
            .filter((file) => file.endsWith(".json.gz")).length;
    }
    catch {
        return 0;
    }
}
async function run() {
    const roots = getRoots();
    post({ type: "start", action, shards: countShards(roots.config) });
    const reporter = {
        step: (message) => post({ type: "log", action, level: "step", message }),
        info: (message) => post({ type: "log", action, level: "info", message }),
        success: (message) => post({ type: "log", action, level: "success", message }),
        warn: (message) => post({ type: "log", action, level: "warn", message }),
        error: (message) => post({ type: "log", action, level: "error", message }),
        detail: (message) => post({ type: "log", action, level: "detail", message }),
        changes: (summary, files) => post({ type: "changes", action, count: files.length }),
    };
    try {
        const result = await withSyncLock(roots.config, { waitMs: 10_000 }, () => action === "push" ? push({ reporter, roots }) : pull({ reporter, roots }));
        post({
            type: "done",
            action,
            durationMs: Date.now() - startedAt,
            changed: result.changed,
            files: result.files.length,
            message: result.message,
            restartRequired: result.restartRequired,
        });
    }
    catch (error) {
        post({ type: "error", action, message: error.message });
    }
}
const port = parentPort;
if (port) {
    void run().finally(() => {
        setTimeout(() => port.close(), 50);
    });
}
//# sourceMappingURL=worker.js.map