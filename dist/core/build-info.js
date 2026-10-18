import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Which build is actually loaded.
 *
 * The plugin is vendored into the synced config directory, so two machines can
 * run different builds of the same version and nothing says so — it took a
 * hand-run `md5sum` comparison to find that out. Reporting the sha in the
 * `opencode_sync status` result turns it into a one-line check.
 */
export function buildInfo() {
    try {
        const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build-info.json");
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (typeof parsed?.version === "string" && typeof parsed?.commit === "string") {
            return {
                version: parsed.version,
                commit: parsed.commit,
                builtAt: String(parsed.builtAt ?? ""),
            };
        }
    }
    catch {
        // Running from source, or the file was not generated: not an error.
    }
    return undefined;
}
//# sourceMappingURL=build-info.js.map