/**
 * System Message Builder
 *
 * Fluent builder for assembling executor system messages. Replaces the
 * deeply-nested free-function pattern with a readable left-to-right chain:
 *
 *   const systemMessage = await systemMessageBuilder()
 *       .append(buildModeSystemMessage('ask')?.content)
 *       .withRepoInstructions(workingDirectory, 'ask')
 *       .appendMemory(boundedMemory)
 *       .appendAutoFolder(autoFolderContext)
 *       .build();
 *
 * `build()` is always async and resolves deferred steps in insertion order.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AutoFolderContext, SystemMessageConfig } from '@plusplusoneplusplus/forge';
import {
    buildAutoFolderLocationBlock,
    loadInstructions,
    toForwardSlashes,
} from '@plusplusoneplusplus/forge';
import type { BoundedMemoryAddon } from './bounded-memory-addon';
import type { MemoryV2Addon } from './memory-v2-addon';
import type { ChatMode } from '../tasks/task-types';
import { resolveInstructionMode } from '../tasks/task-types';

// ============================================================================
// Internal step types
// ============================================================================

/** A known, pre-computed string block. */
type EagerStep = { kind: 'eager'; block: string };

/** A deferred async step resolved at build time. */
type AsyncStep = { kind: 'async'; resolve: () => Promise<string | undefined> };

/**
 * A conditional step that is only included when prior content already exists.
 * Mirrors the legacy `appendAutoFolderBlock` contract: it was a no-op when
 * the incoming `systemMessage` was `undefined`.
 */
type ConditionalStep = { kind: 'conditional'; block: string };

type Step = EagerStep | AsyncStep | ConditionalStep;

// ============================================================================
// SystemMessageBuilder
// ============================================================================

class SystemMessageBuilder {
    private readonly steps: Step[] = [];

    /** Append a raw string block. No-op when the block is empty or undefined. */
    append(block: string | undefined): this {
        if (block) {
            this.steps.push({ kind: 'eager', block });
        }
        return this;
    }

    /** Append the bounded memory snapshot from an addon. No-op when the addon has no suffix. */
    appendMemory(addon: BoundedMemoryAddon | undefined): this {
        if (addon?.systemMessageSuffix) {
            this.steps.push({ kind: 'eager', block: addon.systemMessageSuffix });
        }
        return this;
    }

    /**
     * Append the redesigned coc-memory v2 context (frozen snapshot + per-turn recall).
     * No-op when the addon has no system message suffix (feature disabled or no facts).
     */
    appendMemoryV2(addon: MemoryV2Addon | undefined): this {
        if (addon?.systemMessageSuffix) {
            this.steps.push({ kind: 'eager', block: addon.systemMessageSuffix });
        }
        return this;
    }

    /**
     * Append the aggregated LLM-tool-guidance block (concatenated `suffix`
     * strings from each enabled addon, as produced by
     * `applyLlmToolPreferences` / `buildChatToolBundle`).
     *
     * Lives in the system message rather than appended to the user prompt
     * so the prose is sent exactly once at session creation instead of
     * being repeated on every turn.
     *
     * No-op when `block` is empty, undefined, or only whitespace.
     */
    appendToolGuidance(block: string | undefined): this {
        if (block && block.trim().length > 0) {
            this.steps.push({ kind: 'eager', block });
        }
        return this;
    }

    /**
     * Defer loading per-repo `.github/coc/` instructions.
     * No-op when `workingDir` or `mode` is `undefined`.
     */
    withRepoInstructions(workingDir: string | undefined, mode: ChatMode | undefined): this {
        if (!workingDir || !mode) return this;
        this.steps.push({
            kind: 'async',
            resolve: async () => {
                try {
                    return (await loadInstructions(workingDir, resolveInstructionMode(mode))) ?? undefined;
                } catch {
                    return undefined;
                }
            },
        });
        return this;
    }

    /**
     * Append a directive permitting edits to the attached note file.
     *
     * This step is **conditional**: it is only included when prior content
     * already exists at build time (preserving the same behaviour as
     * `appendAutoFolder`).
     *
     * No-op when `notePath` is `undefined` or empty.
     */
    appendNoteFile(notePath: string | undefined): this {
        if (!notePath) return this;
        const block = `You may also edit the attached note file: \`${notePath}\``;
        this.steps.push({ kind: 'conditional', block });
        return this;
    }

    /**
     * Append the auto-folder location directive.
     *
     * This step is **conditional**: it is only included when prior content
     * already exists at build time. This preserves the legacy behaviour of
     * `appendAutoFolderBlock`, which was a no-op when `systemMessage` was
     * `undefined`.
     *
     * No-op when `ctx` is `undefined`.
     */
    appendAutoFolder(ctx: AutoFolderContext | undefined): this {
        if (!ctx) return this;
        const block = buildAutoFolderLocationBlock(
            toForwardSlashes(ctx.tasksRoot),
            ctx.existingFolders,
        );
        this.steps.push({ kind: 'conditional', block });
        return this;
    }

    /**
     * Resolve all steps in insertion order and return the assembled
     * `SystemMessageConfig`, or `undefined` when nothing was produced.
     */
    async build(): Promise<SystemMessageConfig | undefined> {
        const parts: string[] = [];

        for (const step of this.steps) {
            if (step.kind === 'eager') {
                parts.push(step.block);
            } else if (step.kind === 'async') {
                const value = await step.resolve();
                if (value) parts.push(value);
            } else {
                // conditional: only append when prior content exists
                if (parts.length > 0) {
                    parts.push(step.block);
                }
            }
        }

        if (parts.length === 0) return undefined;
        return { mode: 'append' as const, content: parts.join('\n\n') };
    }
}

// ============================================================================
// Factory
// ============================================================================

/** Create a new {@link SystemMessageBuilder} instance. */
export function systemMessageBuilder(): SystemMessageBuilder {
    return new SystemMessageBuilder();
}
