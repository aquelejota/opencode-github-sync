import os from "node:os";
import path from "node:path";
function xdg(envVar, ...fallback) {
    const fromEnv = process.env[envVar];
    if (fromEnv)
        return fromEnv;
    return path.join(os.homedir(), ...fallback);
}
export function getConfigRoot() {
    if (process.env.SYNC_CONFIG_ROOT)
        return process.env.SYNC_CONFIG_ROOT;
    return path.join(xdg("XDG_CONFIG_HOME", ".config"), "opencode");
}
export function getDataRoot() {
    if (process.env.SYNC_DATA_ROOT)
        return process.env.SYNC_DATA_ROOT;
    return path.join(xdg("XDG_DATA_HOME", ".local", "share"), "opencode");
}
export function getStateRoot() {
    if (process.env.SYNC_STATE_ROOT)
        return process.env.SYNC_STATE_ROOT;
    return path.join(xdg("XDG_STATE_HOME", ".local", "state"), "opencode");
}
export function getAgentsRoot() {
    if (process.env.SYNC_AGENTS_ROOT)
        return process.env.SYNC_AGENTS_ROOT;
    return path.join(os.homedir(), ".agents", "skills");
}
export function getCacheRoot() {
    if (process.env.SYNC_CACHE_ROOT)
        return process.env.SYNC_CACHE_ROOT;
    return path.join(xdg("XDG_CACHE_HOME", ".cache"), "opencode");
}
export function getRoots() {
    return {
        config: getConfigRoot(),
        data: getDataRoot(),
        state: getStateRoot(),
        agents: getAgentsRoot(),
        cache: getCacheRoot(),
    };
}
/** Path of the OpenCode SQLite database that holds all sessions. */
export function getDatabasePath(roots = getRoots()) {
    return path.join(roots.data, "opencode.db");
}
/** Directory inside the sync repo where session shards are written. */
export const SESSIONS_DIR = "_sessions";
/** Directory inside the sync repo mirroring the OpenCode data root. */
export const DATA_DIR = "_data";
/** Directory inside the sync repo mirroring the OpenCode state root. */
export const STATE_DIR = "_state";
/** Directory inside the sync repo mirroring `~/.agents/skills`. */
export const AGENTS_DIR = "_agents";
//# sourceMappingURL=paths.js.map