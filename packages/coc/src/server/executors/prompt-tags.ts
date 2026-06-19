/**
 * Helpers for wrapping prompt sections in named XML-style tags.
 *
 * Tagging makes each block self-delimiting and individually addressable by the
 * model, matching the convention already used elsewhere in the assembled system
 * prompt (`<memory_snapshot>`, `<recalled_memory>`, `<selected_skills>`,
 * `<admin-global-system-prompt>`). Tag names use `snake_case` to match those.
 *
 * This is a leaf module with no local imports so any prompt-assembly file can
 * use it without risking a circular dependency (notably `prompt-builder.ts`
 * re-exports from `memory-v2-addon.ts`, and both consume these helpers).
 *
 * No VS Code dependencies — pure string helpers. Cross-platform compatible.
 */

/** Wrap `body` in a `<tag>…</tag>` block on its own lines. */
export function tagBlock(tag: string, body: string): string {
    return `<${tag}>\n${body}\n</${tag}>`;
}

/**
 * Build a tool-guidance `suffix`: a {@link tagBlock} prefixed with the
 * blank-line separator that `applyLlmToolPreferences` relies on when
 * concatenating each addon's `suffix` into the aggregated `toolGuidance` prose.
 */
export function tagGuidanceSuffix(tag: string, body: string): string {
    return `\n\n${tagBlock(tag, body)}`;
}
