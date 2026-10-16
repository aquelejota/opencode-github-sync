/** Only what this plugin needs from the V2 CLI plugin context. */
interface TuiContext {
    ui?: {
        toast?: {
            show?: (input: {
                title?: string;
                message: string;
                variant?: string;
                duration?: number;
            }) => unknown;
        };
    };
}
declare const _default: {
    id: string;
    setup(ctx: TuiContext): Promise<() => void>;
};
export default _default;
//# sourceMappingURL=tui.d.ts.map