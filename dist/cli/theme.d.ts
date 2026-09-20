/**
 * Terminal theme.
 *
 * Colour is opt-out: it is disabled when stdout is not a TTY, when `NO_COLOR`
 * is set, or when `TERM=dumb`, so piping the CLI into a file or a CI log
 * produces clean text. Truecolor is used when the terminal advertises it and
 * degrades to the 256-colour palette otherwise.
 */
export declare const style: {
    reset: string;
    bold: string;
    dim: string;
    italic: string;
    brand: string;
    accent: string;
    cyan: string;
    green: string;
    yellow: string;
    red: string;
    text: string;
    muted: string;
    faint: string;
};
export declare function paint(text: string, ...styles: string[]): string;
/** Strip ANSI sequences — used for width calculations. */
export declare function stripAnsi(text: string): string;
/** Display width, counting CJK and emoji as two columns. */
export declare function displayWidth(text: string): number;
export declare const glyph: {
    ok: string;
    fail: string;
    warn: string;
    info: string;
    step: string;
    bullet: string;
    added: string;
    modified: string;
    deleted: string;
    renamed: string;
    arrow: string;
};
/** Braille spinner frames — smooth at 80ms. */
export declare const SPINNER: string[];
export declare const canAnimate: boolean;
//# sourceMappingURL=theme.d.ts.map