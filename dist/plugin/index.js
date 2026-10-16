import fs from "node:fs";
import { Worker } from "node:worker_threads";
import { getRoots } from "../core/paths.js";
import { loadSettings, repoUrl, settingsPath } from "../core/settings.js";
import { status } from "../core/sync.js";
import { formatDuration, phaseLabel, } from "./progress.js";
/**
 * OpenCode plugin entry point.
 *
 * The plugin is a convenience layer, never the only way in. It runs inside the
 * OpenCode process, which means it cannot help when the configuration it just
 * synced is what stops OpenCode from starting. The CLI stays the rescue path,
 * and both call the exact same core.
 *
 * What the plugin adds:
 *   - a pull on startup, so a machine you have not touched in a week is current
 *   - an optional push when a session goes idle
 *   - an `opencode_sync` tool, so syncing can be asked for in plain language
 *
 * The pull and the push run on a worker thread (`worker.ts`). The core's git
 * calls are synchronous, and running them on the main thread freezes the whole
 * process — and with it the TUI — for the length of the sync, which then looks
 * exactly like a hang. The worker posts progress messages and the plugin shows
 * them as toasts, so a slow sync is visible while it happens.
 *
 * Everything is off unless the user configured a repository, and every failure
 * is reported as a toast instead of taking OpenCode down with it.
 */
/** Only announce a sync that is slow enough to be worth watching. */
const ANNOUNCE_AFTER_MS = 3_000;
/** Refresh the toast while a phase runs long, so it never looks frozen. */
const HEARTBEAT_MS = 15_000;
const WORKER_FILE = new URL("./worker.js", import.meta.url);
async function toast(client, message, variant) {
    try {
        await client?.tui?.showToast?.({ body: { message, variant } });
    }
    catch {
        // The TUI is not attached (headless run) — nothing to show.
    }
}
async function log(client, level, message, extra) {
    try {
        await client?.app?.log?.({
            body: { service: "opencode-github-sync", level, message, extra },
        });
    }
    catch {
        // Logging must never break a sync.
    }
}
function isConfigured() {
    const roots = getRoots();
    if (!fs.existsSync(settingsPath(roots.config)))
        return false;
    try {
        return Boolean(repoUrl(loadSettings(roots.config)));
    }
    catch {
        return false;
    }
}
/**
 * Run a pull or push on the worker thread and resolve with the result.
 *
 * Errors are already surfaced as toasts by the time the promise rejects, so
 * callers that fire and forget only need `void runSync(...).catch(() => {})`.
 */
function runSync(client, action) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let announced = false;
        let shards = 0;
        let phase = action === "push" ? "sending configuration" : "checking for changes";
        const startedAt = Date.now();
        let lastEventAt = startedAt;
        const announceTimer = setTimeout(() => {
            if (settled)
                return;
            announced = true;
            void toast(client, `Sync: ${phase}…`, "info");
        }, ANNOUNCE_AFTER_MS);
        const heartbeat = setInterval(() => {
            if (settled)
                return;
            if (!announced) {
                announced = true;
                void toast(client, `Sync: ${phase}…`, "info");
                return;
            }
            const now = Date.now();
            if (now - lastEventAt < HEARTBEAT_MS)
                return;
            lastEventAt = now;
            void toast(client, `Sync: ${phase}… (${formatDuration((now - startedAt) / 1000)})`, "info");
        }, 5_000);
        heartbeat.unref?.();
        const finish = () => {
            settled = true;
            clearTimeout(announceTimer);
            clearInterval(heartbeat);
        };
        const fail = (message, error) => {
            finish();
            void log(client, "error", `sync ${action} failed: ${message}`);
            void toast(client, `Sync failed: ${message}`, "error");
            reject(error);
        };
        let worker;
        try {
            worker = new Worker(WORKER_FILE, { workerData: { action } });
        }
        catch (error) {
            // Never fail silently: a missing worker file used to make this a no-op.
            fail(error.message, error);
            return;
        }
        worker.on("message", (message) => {
            lastEventAt = Date.now();
            switch (message.type) {
                case "start":
                    shards = message.shards;
                    return;
                case "log":
                    if (message.level === "step") {
                        phase = phaseLabel(message.message, shards);
                        if (announced)
                            void toast(client, `Sync: ${phase}…`, "info");
                        void log(client, "info", message.message);
                    }
                    else if (message.level === "detail") {
                        void log(client, "debug", message.message);
                    }
                    else {
                        void log(client, message.level === "success" ? "info" : message.level, message.message);
                    }
                    return;
                case "changes":
                    if (message.count > 0) {
                        phase = `${message.count} file(s) to apply`;
                        if (announced)
                            void toast(client, `Sync: ${phase}…`, "info");
                    }
                    return;
                case "done": {
                    const duration = formatDuration(message.durationMs / 1000);
                    void log(client, "info", `sync ${action}: files=${message.files} ${duration}`);
                    if (action === "push") {
                        if (message.files > 0) {
                            void toast(client, `Sync: sent ${message.files} file(s) in ${duration}`, "success");
                        }
                        else if (announced) {
                            void toast(client, `Sync: nothing to send (${duration})`, "info");
                        }
                    }
                    else if (message.files > 0) {
                        const restart = message.restartRequired ? " — restart OpenCode to apply" : "";
                        void toast(client, `Sync: applied ${message.files} file(s) in ${duration}${restart}`, "success");
                    }
                    else if (announced) {
                        void toast(client, `Sync: already up to date (${duration})`, "info");
                    }
                    finish();
                    resolve({
                        action,
                        changed: message.changed,
                        files: message.files,
                        message: message.message,
                        restartRequired: message.restartRequired,
                        durationMs: message.durationMs,
                    });
                    return;
                }
                case "error":
                    fail(message.message, new Error(message.message));
                    return;
            }
        });
        worker.on("error", (error) => {
            if (settled)
                return;
            fail(error.message, error);
        });
        worker.on("exit", (code) => {
            if (settled)
                return;
            fail(`sync worker exited with code ${code}`, new Error(`sync worker exited with code ${code}`));
        });
    });
}
const SYNC_TOOL_DESCRIPTION = "Sync OpenCode configuration with the GitHub sync repository. " +
    "Use action 'push' to upload this machine's configuration, 'pull' to apply the shared " +
    "configuration, or 'status' to report what is out of sync.";
/**
 * Shared implementation behind the `opencode_sync` tool in both entrypoints.
 * `client` is optional: the V2 setup has no TUI client, and toast/log are no-ops
 * without one.
 */
async function syncToolResult(action, client, roots) {
    if (action === "status") {
        const state = status({ roots });
        return JSON.stringify(state, null, 2);
    }
    try {
        const result = await runSync(client, action === "push" ? "push" : "pull");
        const lines = [result.message];
        if (result.files > 0)
            lines.push(`Files: ${result.files}`);
        if (result.restartRequired && result.changed) {
            lines.push("Restart OpenCode for the new configuration to take effect.");
        }
        return lines.join("\n");
    }
    catch (error) {
        return `Sync failed: ${error.message}`;
    }
}
export const OpencodeGithubSync = async (ctx) => {
    const client = ctx?.client;
    const roots = getRoots();
    await log(client, "info", "opencode-github-sync plugin loaded");
    if (!isConfigured()) {
        await log(client, "info", "opencode-github-sync is installed but no repository is configured. Run `opencode-sync init`.");
        return {};
    }
    const settings = loadSettings(roots.config);
    if (settings.autoPullOnStartup) {
        // Deliberately not awaited: OpenCode should finish starting even when the
        // network is slow or the repository is unreachable.
        void runSync(client, "pull").catch(() => { });
    }
    return {
        event: async ({ event }) => {
            if (event.type === "session.idle" && settings.autoPushOnIdle) {
                void runSync(client, "push").catch(() => { });
            }
        },
        tool: {
            opencode_sync: {
                description: SYNC_TOOL_DESCRIPTION,
                args: {
                    action: {
                        type: "string",
                        enum: ["push", "pull", "status"],
                        description: "Which sync operation to run.",
                    },
                },
                async execute(args) {
                    return syncToolResult(args?.action ?? "status", client, roots);
                },
            },
        },
    };
};
/**
 * Dual-generation entrypoint (OpenCode V1 and V2).
 *
 * V1 hosts (1.18.29+) call `server()` and get the legacy hooks/tools exactly as
 * before. V2 hosts call `setup()` and register the same behavior through the V2
 * context: pull on startup, push on idle, the `opencode_sync` tool, and cleanup.
 *
 * V2 status: partial. Progress toasts still live on the V1 path; port them with
 * the V2 TUI/RPC API before relying on this plugin under OpenCode 2.
 */
export default {
    id: "opencode-github-sync",
    async setup(ctx) {
        const roots = getRoots();
        if (!isConfigured()) {
            console.log("opencode-github-sync is installed but no repository is configured. Run `opencode-sync init`.");
            return;
        }
        const settings = loadSettings(roots.config);
        const report = (level, message) => {
            const line = `[opencode-github-sync] ${message}`;
            if (level === "error")
                console.error(line);
            else
                console.log(line);
        };
        report("info", "plugin loaded");
        if (settings.autoPullOnStartup) {
            // Deliberately not awaited, same as the V1 path.
            void runSync(undefined, "pull").catch(() => { });
        }
        await ctx.tool.transform((editor) => {
            editor.add({
                name: "opencode_sync",
                options: { codemode: false },
                description: SYNC_TOOL_DESCRIPTION,
                input: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: ["push", "pull", "status"],
                            description: "Which sync operation to run.",
                        },
                    },
                    required: ["action"],
                    additionalProperties: false,
                },
                async execute(input) {
                    const action = input?.action ?? "status";
                    return { content: await syncToolResult(action, undefined, getRoots()) };
                },
            });
        });
        const controller = new AbortController();
        const task = (async () => {
            for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
                if (controller.signal.aborted)
                    break;
                if (event?.type === "session.idle" && settings.autoPushOnIdle) {
                    void runSync(undefined, "push").catch(() => { });
                }
            }
        })().catch((error) => {
            if (!controller.signal.aborted) {
                report("error", `event subscription failed: ${error.message}`);
            }
        });
        return async () => {
            controller.abort();
            await task;
        };
    },
    async server(ctx) {
        return OpencodeGithubSync(ctx);
    },
};
//# sourceMappingURL=index.js.map