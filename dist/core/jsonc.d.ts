/**
 * Dependency-free JSONC support.
 *
 * OpenCode config files are JSON with comments and trailing commas. We cannot
 * pull in a parser dependency because this module is loaded inside the OpenCode
 * runtime, so the stripping is done by hand. String literals are copied
 * verbatim so `//` or `/*` inside a value is never mistaken for a comment.
 */
export declare function parseJsonc<T = any>(text: string): T;
export declare function tryParseJsonc<T = any>(text: string): T | undefined;
/**
 * Recursively merge `patch` into `base`, returning a new object.
 *
 * - Plain objects merge key by key.
 * - Arrays and scalars are replaced wholesale (an override should be able to
 *   shorten a list, which a concat-merge could never express).
 * - An explicit `null` in the patch deletes the key.
 */
export declare function deepMerge<T extends Record<string, any>>(base: T, patch: Record<string, any>): T;
//# sourceMappingURL=jsonc.d.ts.map