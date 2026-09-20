import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { ensureFile } from "./fsx.js";
import { getRoots } from "./paths.js";
import { DEFAULT_SETTINGS, OVERRIDES_TEMPLATE, SETTINGS_TEMPLATE, loadSettings, overridesPath, saveSettings, settingsPath, } from "./settings.js";
/**
 * First-run setup.
 *
 * The single biggest barrier to a sync tool is the setup: create a repository,
 * find its URL, put it somewhere the tool can read, authenticate. All of that
 * is automated through the GitHub CLI, which most OpenCode users already have
 * authenticated. Every step is idempotent, so re-running after a failure is
 * always safe.
 */
export class SetupError extends Error {
    constructor(message) {
        super(message);
        this.name = "SetupError";
    }
}
function gh(args) {
    try {
        const stdout = execFileSync("gh", args, { encoding: "utf8", stdio: "pipe" });
        return { ok: true, stdout: stdout.trim(), stderr: "" };
    }
    catch (e) {
        return {
            ok: false,
            stdout: String(e.stdout ?? "").trim(),
            stderr: String(e.stderr ?? e.message ?? "").trim(),
        };
    }
}
export function ghAvailable() {
    return gh(["--version"]).ok;
}
export function assertGhReady() {
    if (!ghAvailable()) {
        throw new SetupError("The GitHub CLI (`gh`) is required for automatic setup.\n" +
            "Install it from https://cli.github.com, or configure the repository by hand in opencode-sync.jsonc.");
    }
    if (!gh(["auth", "status"]).ok) {
        throw new SetupError("You are not signed in to GitHub. Run: gh auth login");
    }
}
export function currentGitHubUser() {
    const result = gh(["api", "user", "--jq", ".login"]);
    if (!result.ok || !result.stdout) {
        throw new SetupError("Could not determine your GitHub username. Run: gh auth login");
    }
    return result.stdout;
}
/** Accept `name`, `owner/name`, or nothing (defaults applied by the caller). */
export function parseRepoTarget(input, defaultOwner) {
    const value = (input ?? "").trim();
    if (!value)
        return { owner: defaultOwner, name: "my-opencode-config" };
    if (value.includes("/")) {
        const [owner, name] = value.split("/", 2);
        if (!owner || !name)
            throw new SetupError(`Not a valid repository: ${value}`);
        return { owner, name };
    }
    return { owner: defaultOwner, name: value };
}
export function repoExists(target) {
    return gh(["repo", "view", `${target.owner}/${target.name}`, "--json", "name"]).ok;
}
export function repoIsPrivate(target) {
    const result = gh([
        "repo",
        "view",
        `${target.owner}/${target.name}`,
        "--json",
        "visibility",
        "--jq",
        ".visibility",
    ]);
    return result.ok && result.stdout.toUpperCase() === "PRIVATE";
}
export function createRepo(target, reporter) {
    reporter.step(`Creating private repository ${target.owner}/${target.name}`);
    const result = gh([
        "repo",
        "create",
        `${target.owner}/${target.name}`,
        "--private",
        "--description",
        "OpenCode configuration synced by opencode-github-sync",
    ]);
    if (!result.ok) {
        throw new SetupError(`Could not create the repository: ${result.stderr || result.stdout}`);
    }
}
/** Create (or adopt) a repository and write the local settings files. */
export function initSync(options) {
    assertGhReady();
    const roots = options.roots ?? getRoots();
    const owner = currentGitHubUser();
    const target = parseRepoTarget(options.repo, owner);
    let created = false;
    if (!repoExists(target)) {
        createRepo(target, options.reporter);
        created = true;
    }
    else {
        options.reporter.info(`Using the existing repository ${target.owner}/${target.name}`);
    }
    return writeSetupFiles(target, options, roots, created);
}
/** Point this machine at an existing sync repository. */
export function linkSync(options) {
    assertGhReady();
    const roots = options.roots ?? getRoots();
    const owner = currentGitHubUser();
    const target = parseRepoTarget(options.repo, owner);
    if (!repoExists(target)) {
        throw new SetupError(`Repository ${target.owner}/${target.name} was not found, or your account cannot see it.`);
    }
    return writeSetupFiles(target, options, roots, false);
}
function writeSetupFiles(target, options, roots, created) {
    const isPrivate = repoIsPrivate(target);
    if (options.includeCredentials && !isPrivate) {
        throw new SetupError("Credential syncing was requested but the repository is public.\n" +
            "Make it private first, or leave `includeCredentials` off.");
    }
    if (options.includeSessions && !isPrivate) {
        throw new SetupError("Session syncing was requested but the repository is public.\n" +
            "Conversations are private data; make the repository private first.");
    }
    fs.mkdirSync(roots.config, { recursive: true });
    const existing = fs.existsSync(settingsPath(roots.config))
        ? loadSettings(roots.config)
        : { ...DEFAULT_SETTINGS };
    const settings = {
        ...existing,
        repo: {
            ...existing.repo,
            owner: target.owner,
            name: target.name,
            branch: existing.repo.branch || "main",
        },
        includeCredentials: options.includeCredentials ?? existing.includeCredentials,
        sessions: {
            ...existing.sessions,
            enabled: options.includeSessions ?? existing.sessions.enabled,
        },
    };
    if (fs.existsSync(settingsPath(roots.config))) {
        saveSettings(settings, roots.config);
    }
    else {
        // A first-time file keeps the annotated template so the user can see every
        // available option instead of a bare JSON dump.
        fs.writeFileSync(settingsPath(roots.config), SETTINGS_TEMPLATE.replace("YOUR_GITHUB_USERNAME", target.owner).replace('"name": "my-opencode-config"', `"name": "${target.name}"`));
        if (options.includeCredentials || options.includeSessions)
            saveSettings(settings, roots.config);
    }
    ensureFile(overridesPath(roots.config), OVERRIDES_TEMPLATE);
    return {
        target,
        created,
        settingsFile: settingsPath(roots.config),
        overridesFile: overridesPath(roots.config),
    };
}
/** Guess which of the user's repositories is a sync repository. */
export function discoverSyncRepos() {
    const result = gh([
        "repo",
        "list",
        "--limit",
        "200",
        "--json",
        "name,owner,visibility",
        "--jq",
        '.[] | select(.visibility == "PRIVATE") | "\\(.owner.login)/\\(.name)"',
    ]);
    if (!result.ok)
        return [];
    const candidates = result.stdout.split("\n").filter(Boolean);
    const preferred = /opencode|my-opencode-config|dotfiles|config/i;
    return candidates.filter((name) => preferred.test(name));
}
//# sourceMappingURL=setup.js.map