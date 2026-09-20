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
export default OpencodeGithubSync;
//# sourceMappingURL=index.d.ts.map