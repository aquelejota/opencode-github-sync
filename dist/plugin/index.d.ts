interface PluginContext {
    client?: any;
    directory?: string;
}
export declare const OpencodeGithubSync: (ctx: PluginContext) => Promise<{
    event?: undefined;
    tool?: undefined;
} | {
    event: ({ event }: {
        event: {
            type: string;
        };
    }) => Promise<void>;
    tool: {
        opencode_sync: {
            description: string;
            args: {
                action: {
                    type: string;
                    enum: string[];
                    description: string;
                };
            };
            execute(args: {
                action?: string;
            }): Promise<string>;
        };
    };
}>;
/** Structural types for the V2 setup context. Declared locally on purpose so
 * the package never depends on @opencode/plugin at runtime. */
interface PluginV2ToolEditor {
    add(tool: {
        name: string;
        options?: {
            codemode?: boolean;
        };
        description: string;
        input: Record<string, unknown>;
        execute(input: {
            action?: string;
        }): Promise<{
            content: string;
        }>;
    }): void;
}
interface PluginV2Context {
    tool?: {
        transform(fn: (editor: PluginV2ToolEditor) => void | Promise<void>): Promise<unknown>;
    };
    event?: {
        subscribe(options: {
            signal: AbortSignal;
        }): AsyncIterable<{
            type?: string;
        }>;
    };
}
/**
 * Dual-generation entrypoint (OpenCode V1 and V2).
 *
 * V1 hosts (1.18.29+) call `server()` and get the legacy hooks/tools exactly as
 * before. V2 hosts call `setup()` and register the same behavior through the V2
 * context: pull on startup, push on idle, the `opencode_sync` tool, and cleanup.
 *
 * V2 status: complete. V1 shows progress through client toasts; V2 runs in the
 * service, so the same toasts are appended to the progress log and `src/tui.ts`
 * (the CLI plugin the TUI loads) shows them — see `progress-file.ts`.
 */
declare const _default: {
    id: string;
    setup(ctx: PluginV2Context): Promise<(() => Promise<void>) | undefined>;
    server(ctx: PluginContext): Promise<{
        event?: undefined;
        tool?: undefined;
    } | {
        event: ({ event }: {
            event: {
                type: string;
            };
        }) => Promise<void>;
        tool: {
            opencode_sync: {
                description: string;
                args: {
                    action: {
                        type: string;
                        enum: string[];
                        description: string;
                    };
                };
                execute(args: {
                    action?: string;
                }): Promise<string>;
            };
        };
    }>;
};
export default _default;
//# sourceMappingURL=index.d.ts.map