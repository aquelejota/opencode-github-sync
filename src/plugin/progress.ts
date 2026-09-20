/**
 * Progress reporting shared by the plugin and its sync worker.
 *
 * The worker runs the blocking core off the main thread and posts plain
 * messages; the plugin turns them into toasts. Everything that decides *what*
 * a message looks like lives here as pure functions, so it can be tested
 * without a Worker, a TUI or a repository.
 */

export type SyncAction = "pull" | "push";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type LogLevel = "step" | "info" | "success" | "warn" | "error" | "detail";

export interface StartMessage {
  type: "start";
  action: SyncAction;
  shards: number;
}

export interface LogMessage {
  type: "log";
  action: SyncAction;
  level: LogLevel;
  message: string;
}

export interface ChangesMessage {
  type: "changes";
  action: SyncAction;
  count: number;
}

export interface DoneMessage {
  type: "done";
  action: SyncAction;
  durationMs: number;
  changed: boolean;
  files: number;
  message: string;
  restartRequired: boolean;
}

export interface ErrorMessage {
  type: "error";
  action: SyncAction;
  message: string;
}

export type WorkerMessage = StartMessage | LogMessage | ChangesMessage | DoneMessage | ErrorMessage;

/** Short human duration: `42s`, `3m 07s`. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Turn a core step ("Importing sessions") into a progress phrase. */
export function phaseLabel(step: string, shards: number): string {
  const text = String(step ?? "").toLowerCase();
  if (text.includes("fetching")) return "checking the repository";
  if (text.includes("staging")) return "staging local files";
  if (text.includes("exporting")) return "exporting sessions";
  if (text.includes("importing")) {
    if (shards <= 0) return "applying sessions";
    return `applying ${shards} session${shards === 1 ? "" : "s"}`;
  }
  if (text.includes("pushing")) return "sending pending commits";
  return step ? String(step) : "syncing";
}
