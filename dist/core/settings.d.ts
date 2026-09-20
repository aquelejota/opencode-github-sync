/** Filename of the tool's own settings (local-only, never committed). */
export declare const SETTINGS_FILE = "opencode-sync.jsonc";
/** Filename of the per-machine OpenCode config patch (local-only). */
export declare const OVERRIDES_FILE = "opencode-sync.overrides.jsonc";
export interface RepoSettings {
    /** Full git remote URL. Takes precedence over owner/name. */
    url?: string;
    owner?: string;
    name?: string;
    branch?: string;
}
export interface SessionSettings {
    /** Master switch. Session sync is opt-in. */
    enabled: boolean;
    /** Only sync sessions touched within this many days. */
    days: number;
    /** Hard cap on how many sessions a single push may export. */
    maxSessions: number;
    /**
     * Skip any single session whose exported payload exceeds this many bytes.
     * Tool output can make one session hundreds of megabytes; without a cap a
     * single runaway session would dominate the repository.
     */
    maxSessionBytes: number;
    /** Explicit session ids to always include, regardless of the time window. */
    include: string[];
    /** Session ids to never export. */
    exclude: string[];
    /** Only export sessions belonging to these project directories. */
    directories: string[];
}
export interface Settings {
    repo: RepoSettings;
    /** Stable alias for this machine used in commit messages. */
    machineAlias?: string;
    /** Sync `auth.json` / `account.json`. Requires a private repository. */
    includeCredentials: boolean;
    /** Sync `~/.agents/skills`. */
    includeSkills: boolean;
    /** Sync `~/.local/state/opencode`. */
    includeState: boolean;
    /** Extra absolute paths to sync, relative to the home directory. */
    extraPaths: string[];
    sessions: SessionSettings;
    /** Pull automatically when OpenCode starts (plugin only). */
    autoPullOnStartup: boolean;
    /** Push automatically when a session goes idle (plugin only). */
    autoPushOnIdle: boolean;
}
export declare const DEFAULT_SETTINGS: Settings;
export declare function settingsPath(configRoot?: string): string;
export declare function overridesPath(configRoot?: string): string;
export declare function loadSettings(configRoot?: string): Settings;
export declare function saveSettings(settings: Settings, configRoot?: string): void;
export declare function repoUrl(settings: Settings): string | undefined;
export declare function repoBranch(settings: Settings): string;
export declare const SETTINGS_TEMPLATE = "{\n  // opencode-github-sync settings. This file is never committed.\n  \"repo\": {\n    \"owner\": \"YOUR_GITHUB_USERNAME\",\n    \"name\": \"my-opencode-config\",\n    \"branch\": \"main\"\n  },\n\n  // A short name for this machine, used in commit messages.\n  // Leave unset to auto-generate a stable pseudonym from the hostname.\n  // \"machineAlias\": \"laptop\",\n\n  // Sync auth.json / account.json. Only enable for a PRIVATE repository.\n  \"includeCredentials\": false,\n\n  \"includeSkills\": true,\n  \"includeState\": true,\n\n  // Selective session sync. Off by default.\n  \"sessions\": {\n    \"enabled\": false,\n    \"days\": 7,\n    \"maxSessions\": 50,\n    \"maxSessionBytes\": 5242880,\n    \"include\": [],\n    \"exclude\": [],\n    \"directories\": []\n  },\n\n  \"autoPullOnStartup\": true,\n  \"autoPushOnIdle\": false\n}\n";
export declare const OVERRIDES_TEMPLATE = "{\n  // Per-machine OpenCode configuration.\n  //\n  // This file is never committed. After every pull its contents are merged\n  // back into opencode.json(c), so machine-specific settings survive syncing.\n  //\n  // Merge rules:\n  //   - objects merge key by key\n  //   - arrays and scalars replace whatever is in the shared config\n  //   - null deletes the key\n  //\n  // Example:\n  //   \"model\": \"github-copilot/claude-sonnet-4\",\n  //   \"mcp\": { \"playwright\": { \"enabled\": true } }\n}\n";
//# sourceMappingURL=settings.d.ts.map