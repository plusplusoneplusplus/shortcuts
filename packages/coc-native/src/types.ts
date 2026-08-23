/**
 * Types that describe the addon itself, independent of what it can do.
 * Capability-specific types live beside their capability (see `file-index.ts`).
 */

/**
 * The addon's module surface: whatever the loaded binary exports.
 *
 * The loader is deliberately capability-agnostic — it resolves and loads a
 * binary and nothing more. Each capability module narrows this shape to the
 * exports it needs and reports the capability missing when they are absent.
 */
export interface NativeAddon {
    readonly [exportName: string]: unknown;
}

/** Whether the addon (or one capability of it) is usable, and why not. */
export interface NativeAddonStatus {
    loaded: boolean;
    /** Absolute path of the binary that loaded, when one did. */
    binaryPath?: string;
    /** Why loading was skipped or failed, when it was. */
    reason?: string;
}
