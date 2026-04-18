/**
 * MemoryPromptBuilder — Frozen snapshot prompt builder for bounded memory.
 *
 * Reads entries from BoundedMemoryStore at construction time, captures a
 * frozen snapshot, and renders it as a system prompt block. The snapshot is
 * immutable for the lifetime of the builder instance — mid-session writes
 * to MEMORY.md never affect the injected prompt. This preserves LLM prefix
 * cache stability.
 */
import type { BoundedMemoryStore } from './bounded-memory-store';
import { ENTRY_DELIMITER } from './bounded-memory-types';

export { ENTRY_DELIMITER };

/** Visual separator for the memory block header. */
const SEPARATOR = '═'.repeat(46);

/**
 * Behavioral guidance injected into the system prompt alongside the memory
 * block. Tells the AI how to use the memory tool effectively.
 */
export const MEMORY_GUIDANCE = `You have persistent memory across sessions. Save durable facts using the memory \
tool: user preferences, environment details, tool quirks, and stable conventions. \
Memory is injected into every turn, so keep it compact and focused on facts that \
will still matter later.
Prioritize what reduces future user steering — the most valuable memory is one \
that prevents the user from having to correct or remind you again. \
User preferences and recurring corrections matter more than procedural task details.
Do NOT save task progress, session outcomes, completed-work logs, or temporary TODO \
state to memory.`;

export interface MemoryPromptBuilderOptions {
    /** BoundedMemoryStore to read MEMORY.md from. */
    store: BoundedMemoryStore;
    /**
     * Optional second store for system-level memory.
     * When provided, both repo and system blocks are rendered.
     */
    systemStore?: BoundedMemoryStore;
}

export class MemoryPromptBuilder {
    /** Frozen rendered block captured at construction. Empty string if no entries. */
    private readonly repoBlock: string;
    /** Frozen rendered block for system-level memory. Empty string if no entries. */
    private readonly systemBlock: string;

    constructor(options: MemoryPromptBuilderOptions) {
        const repoEntries = options.store.read();
        const repoLimit = options.store.getUsage().limit;
        this.repoBlock = MemoryPromptBuilder.renderBlock(
            'MEMORY (your persistent notes)',
            repoEntries,
            repoLimit,
        );

        if (options.systemStore) {
            const sysEntries = options.systemStore.read();
            const sysLimit = options.systemStore.getUsage().limit;
            this.systemBlock = MemoryPromptBuilder.renderBlock(
                'SYSTEM MEMORY (cross-project notes)',
                sysEntries,
                sysLimit,
            );
        } else {
            this.systemBlock = '';
        }
    }

    /**
     * Return the frozen memory block for system prompt injection.
     * Returns null if both repo and system snapshots are empty.
     *
     * The returned string contains:
     * 1. The rendered memory block(s) with ═══ separators and usage headers
     * 2. A blank line
     * 3. The MEMORY_GUIDANCE text
     *
     * This value NEVER changes after construction — preserves prefix cache.
     */
    getSystemPromptBlock(): string | null {
        const blocks = [this.repoBlock, this.systemBlock].filter(Boolean);
        if (blocks.length === 0) return null;
        return blocks.join('\n\n') + '\n\n' + MEMORY_GUIDANCE;
    }

    /**
     * Return just the MEMORY_GUIDANCE text (no memory content).
     * Useful when memory is empty but guidance should still be injected.
     */
    getGuidance(): string {
        return MEMORY_GUIDANCE;
    }

    /**
     * Render a single memory block with separator, usage header, and content.
     * Returns empty string if entries is empty.
     */
    private static renderBlock(label: string, entries: string[], charLimit: number): string {
        if (entries.length === 0) return '';

        const content = entries.join(ENTRY_DELIMITER);
        const current = content.length;
        const pct = Math.min(100, Math.floor((current / charLimit) * 100));
        const header = `${label} [${pct}% — ${current.toLocaleString()}/${charLimit.toLocaleString()} chars]`;

        return `${SEPARATOR}\n${header}\n${SEPARATOR}\n${content}`;
    }
}
