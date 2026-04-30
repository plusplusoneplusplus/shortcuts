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
import type { MemoryWriteFrequency } from './memory-tool';

export { ENTRY_DELIMITER };

/** Visual separator for the memory block header. */
const SEPARATOR = '═'.repeat(46);

/**
 * Behavioral guidance injected into the system prompt alongside the memory
 * block. Tells the AI how to use the memory tool effectively.
 */
export const MEMORY_GUIDANCE = `You have a persistent \`memory\` tool. Use it to save durable, high-value \
facts worth keeping for future sessions — see the tool description for the full save/skip criteria. \
The most valuable memory prevents the user from repeating themselves and prevents you from \
re-deriving the same fact next session.`;

const MEMORY_GUIDANCE_LOW = `You have a persistent \`memory\` tool. Use memory sparingly — only when \
the user explicitly asks you to remember something or corrects you. Do not proactively save facts.`;

const MEMORY_GUIDANCE_HIGH = `You have a persistent \`memory\` tool. Actively capture facts, preferences, \
and patterns you discover during this session. When in doubt, save it — storage is cheap and \
forgetting is expensive.`;

/**
 * Returns the level-specific guidance text for the system prompt.
 * Falls back to `MEMORY_GUIDANCE` (medium) when frequency is undefined.
 */
export function getMemoryGuidance(frequency?: MemoryWriteFrequency): string {
    switch (frequency) {
        case 'low': return MEMORY_GUIDANCE_LOW;
        case 'high': return MEMORY_GUIDANCE_HIGH;
        default: return MEMORY_GUIDANCE;
    }
}

export interface MemoryPromptBuilderOptions {
    /** BoundedMemoryStore to read MEMORY.md from. */
    store: BoundedMemoryStore;
    /**
     * Optional second store for system-level memory.
     * When provided, both repo and system blocks are rendered.
     */
    systemStore?: BoundedMemoryStore;
    /** Controls which guidance text is injected. Default: 'medium'. */
    writeFrequency?: MemoryWriteFrequency;
}

export class MemoryPromptBuilder {
    /** Frozen rendered block captured at construction. Empty string if no entries. */
    private readonly repoBlock: string;
    /** Frozen rendered block for system-level memory. Empty string if no entries. */
    private readonly systemBlock: string;
    /** Frozen guidance text selected at construction. */
    private readonly guidance: string;

    constructor(options: MemoryPromptBuilderOptions) {
        this.guidance = getMemoryGuidance(options.writeFrequency);

        const repoEntries = options.store.read();
        const repoLimit = options.store.getUsage().limit;
        this.repoBlock = MemoryPromptBuilder.renderBlock(
            'MEMORY (your personal notes)',
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
        return blocks.join('\n\n') + '\n\n' + this.guidance;
    }

    /**
     * Return just the MEMORY_GUIDANCE text (no memory content).
     * Useful when memory is empty but guidance should still be injected.
     */
    getGuidance(): string {
        return this.guidance;
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
