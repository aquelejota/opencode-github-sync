/**
 * Progress reporting shared by the plugin and its sync worker.
 *
 * The worker runs the blocking core off the main thread and posts plain
 * messages; the plugin turns them into toasts. Everything that decides *what*
 * a message looks like lives here as pure functions, so it can be tested
 * without a Worker, a TUI or a repository.
 */
/** Short human duration: `42s`, `3m 07s`. */
export function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}
/** Turn a core step ("Importing sessions") into a progress phrase. */
export function phaseLabel(step, shards) {
    const text = String(step ?? "").toLowerCase();
    if (text.includes("fetching"))
        return "checking the repository";
    if (text.includes("staging"))
        return "staging local files";
    if (text.includes("exporting"))
        return "exporting sessions";
    if (text.includes("importing")) {
        if (shards <= 0)
            return "applying sessions";
        return `applying ${shards} session${shards === 1 ? "" : "s"}`;
    }
    if (text.includes("pushing"))
        return "sending pending commits";
    return step ? String(step) : "syncing";
}
//# sourceMappingURL=progress.js.map