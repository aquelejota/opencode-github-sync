import fs from "node:fs";
import path from "node:path";
import { parseJsonc } from "./jsonc.js";
import { getConfigRoot } from "./paths.js";
/** Filename of the tool's own settings (local-only, never committed). */
export const SETTINGS_FILE = "opencode-sync.jsonc";
/** Filename of the per-machine OpenCode config patch (local-only). */
export const OVERRIDES_FILE = "opencode-sync.overrides.jsonc";
export const DEFAULT_SETTINGS = {
    repo: { branch: "main" },
    includeCredentials: false,
    includeSkills: true,
    includeState: true,
    extraPaths: [],
    sessions: {
        enabled: false,
        days: 7,
        maxSessions: 50,
        maxSessionBytes: 5 * 1024 * 1024,
        include: [],
        exclude: [],
        directories: [],
    },
    autoPullOnStartup: true,
    autoPushOnIdle: false,
};
export function settingsPath(configRoot = getConfigRoot()) {
    return path.join(configRoot, SETTINGS_FILE);
}
export function overridesPath(configRoot = getConfigRoot()) {
    return path.join(configRoot, OVERRIDES_FILE);
}
function mergeSettings(base, patch) {
    return {
        ...base,
        ...patch,
        repo: { ...base.repo, ...(patch.repo ?? {}) },
        sessions: { ...base.sessions, ...(patch.sessions ?? {}) },
    };
}
export function loadSettings(configRoot = getConfigRoot()) {
    const file = settingsPath(configRoot);
    if (!fs.existsSync(file))
        return { ...DEFAULT_SETTINGS };
    let parsed;
    try {
        parsed = parseJsonc(fs.readFileSync(file, "utf8"));
    }
    catch (e) {
        throw new Error(`Cannot read ${SETTINGS_FILE}: ${e.message}`);
    }
    return mergeSettings(DEFAULT_SETTINGS, parsed ?? {});
}
export function saveSettings(settings, configRoot = getConfigRoot()) {
    fs.mkdirSync(configRoot, { recursive: true });
    fs.writeFileSync(settingsPath(configRoot), `${JSON.stringify(settings, null, 2)}\n`);
}
export function repoUrl(settings) {
    if (process.env.SYNC_REMOTE_URL)
        return process.env.SYNC_REMOTE_URL;
    if (settings.repo.url)
        return settings.repo.url;
    if (settings.repo.owner && settings.repo.name) {
        return `https://github.com/${settings.repo.owner}/${settings.repo.name}.git`;
    }
    return undefined;
}
export function repoBranch(settings) {
    return settings.repo.branch || "main";
}
export const SETTINGS_TEMPLATE = `{
  // opencode-github-sync settings. This file is never committed.
  "repo": {
    "owner": "YOUR_GITHUB_USERNAME",
    "name": "my-opencode-config",
    "branch": "main"
  },

  // A short name for this machine, used in commit messages.
  // Leave unset to auto-generate a stable pseudonym from the hostname.
  // "machineAlias": "laptop",

  // Sync auth.json / account.json. Only enable for a PRIVATE repository.
  "includeCredentials": false,

  "includeSkills": true,
  "includeState": true,

  // Selective session sync. Off by default.
  "sessions": {
    "enabled": false,
    "days": 7,
    "maxSessions": 50,
    "maxSessionBytes": 5242880,
    "include": [],
    "exclude": [],
    "directories": []
  },

  "autoPullOnStartup": true,
  "autoPushOnIdle": false
}
`;
export const OVERRIDES_TEMPLATE = `{
  // Per-machine OpenCode configuration.
  //
  // This file is never committed. After every pull its contents are merged
  // back into opencode.json(c), so machine-specific settings survive syncing.
  //
  // Merge rules:
  //   - objects merge key by key
  //   - arrays and scalars replace whatever is in the shared config
  //   - null deletes the key
  //
  // Example:
  //   "model": "github-copilot/claude-sonnet-4",
  //   "mcp": { "playwright": { "enabled": true } }
}
`;
//# sourceMappingURL=settings.js.map