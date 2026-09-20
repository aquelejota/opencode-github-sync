/**
 * Terminal presentation layer.
 *
 * The core never writes to stdout directly. It emits structured events through
 * a `Reporter`, so the same sync logic can render as a pretty CLI, as silent
 * JSON, or as OpenCode toast notifications from inside the plugin.
 */
export const silentReporter = {
    step() { },
    info() { },
    success() { },
    warn() { },
    error() { },
    detail() { },
    changes() { },
};
/** Collects everything for later inspection — used by the plugin and tests. */
export class CollectingReporter {
    lines = [];
    summary = { added: 0, modified: 0, deleted: 0, renamed: 0 };
    files = [];
    push(level, message) {
        this.lines.push({ level, message });
    }
    step(message) {
        this.push("step", message);
    }
    info(message) {
        this.push("info", message);
    }
    success(message) {
        this.push("success", message);
    }
    warn(message) {
        this.push("warn", message);
    }
    error(message) {
        this.push("error", message);
    }
    detail(message) {
        this.push("detail", message);
    }
    changes(summary, files) {
        this.summary = summary;
        this.files = files;
    }
    get text() {
        return this.lines.map((l) => l.message).join("\n");
    }
}
export function emptySummary() {
    return { added: 0, modified: 0, deleted: 0, renamed: 0 };
}
export function summarize(files) {
    const summary = emptySummary();
    for (const file of files)
        summary[file.kind]++;
    return summary;
}
export function totalChanges(summary) {
    return summary.added + summary.modified + summary.deleted + summary.renamed;
}
//# sourceMappingURL=reporter.js.map