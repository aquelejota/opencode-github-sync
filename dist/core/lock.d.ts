export interface SyncLock {
    dir: string;
    id: string;
}
export interface AcquireOptions {
    /** How long to wait for an existing holder. Default: fail immediately. */
    waitMs?: number;
    pollMs?: number;
}
export declare function acquireSyncLock(configRoot: string, options?: AcquireOptions): SyncLock | null;
export declare function releaseSyncLock(lock: SyncLock | null): void;
/** Run `fn` while holding the lock, always releasing it. */
export declare function withSyncLock<T>(configRoot: string, options: AcquireOptions, fn: () => Promise<T> | T): Promise<T>;
//# sourceMappingURL=lock.d.ts.map