/**
 * Filesystem helpers used by staging.
 *
 * Two properties matter throughout this module:
 *
 * 1. **Symlinks are refused, never followed.** A sync repo that follows a
 *    symlink can be tricked into copying arbitrary files off the machine, and
 *    on Windows a directory junction silently turns a delete into a delete of
 *    something else entirely.
 * 2. **Replacements are atomic.** Destinations are built beside the target and
 *    renamed into place, so a crash mid-copy can never leave a half-written
 *    config that stops OpenCode from starting.
 */
export declare function ensureDir(dir: string): void;
export declare function exists(target: string): boolean;
export declare function removeRecursive(target: string): void;
export declare class SymlinkRefusedError extends Error {
    constructor(role: string, target: string);
}
export declare function rejectLink(target: string, role: "source" | "target"): void;
/** Write only when the content actually differs. Returns true if written. */
export declare function writeIfDiffers(filePath: string, content: string): boolean;
/** Create the file only when missing. Returns true if created. */
export declare function ensureFile(filePath: string, content: string): boolean;
export declare function copyFileIfExists(src: string, dst: string): boolean;
/** Copy `src` onto `dst`, deleting `dst` when `src` does not exist. */
export declare function mirrorFile(src: string, dst: string): number;
export interface CopyOptions {
    excludeFiles?: Set<string>;
    excludeDirs?: Set<string>;
}
export declare function copyDirRecursive(src: string, dst: string, options?: CopyOptions): number;
export interface IncrementalOptions extends CopyOptions {
    /** Delete files in `dst` that no longer exist in `src`. Default true. */
    deleteExtraneous?: boolean;
}
export interface IncrementalResult {
    copied: number;
    deleted: number;
}
/**
 * Mirror `srcDir` into `dstDir`, copying only what changed.
 *
 * Change detection compares size and modification time at **one-second
 * granularity**, then falls back to a content compare. Whole seconds are
 * exactly representable on every filesystem we support; sub-second precision
 * drifts between NTFS and APFS and would make every run re-copy the entire
 * tree, which defeats the point.
 */
export declare function syncDirIncremental(srcDir: string, dstDir: string, options?: IncrementalOptions): IncrementalResult;
export interface ReplaceFileOptions {
    /** When `src` is missing, keep the existing destination instead of deleting. */
    preserveMissing?: boolean;
}
/** Replace a single file atomically. */
export declare function replaceFileAtomically(src: string, dst: string, options?: ReplaceFileOptions): number;
export interface ReplaceDirOptions extends CopyOptions {
    /** Files at the destination root that survive the replacement. */
    preserveRootFiles?: Iterable<string>;
}
/** Replace a whole directory atomically. */
export declare function replaceDirAtomically(src: string, dst: string, options?: ReplaceDirOptions): number;
/**
 * Copy a path that may be either a file or a directory.
 *
 * OpenCode's `storage/migration` is a one-byte file while `storage/project` is
 * a directory, and which is which has changed between releases — so the type is
 * decided by looking at the source, not by assumption.
 */
export declare function copyPath(src: string, dst: string): number;
/**
 * Strip nested `.git` directories from a staging copy.
 *
 * The `skills` CLI installs by cloning, which leaves a `.git` inside the skill
 * directory. Git records a nested repository as a gitlink instead of tracking
 * the files, so the skill's contents become invisible to every other machine.
 * Only staging copies are touched; the real source directories are never
 * modified.
 */
export declare function removeNestedGitDirs(...dirs: string[]): number;
//# sourceMappingURL=fsx.d.ts.map