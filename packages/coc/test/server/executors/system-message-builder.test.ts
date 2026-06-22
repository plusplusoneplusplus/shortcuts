/**
 * System Message Builder Unit Tests
 *
 * Focused tests for the admin global-system-prompt block helper and the
 * `appendGlobalSystemPrompt()` builder step (AC-03). The block must be a
 * labeled wrapper around the raw prompt and inert when no prompt is set.
 */

import { describe, it, expect } from 'vitest';
import {
    systemMessageBuilder,
    buildGlobalSystemPromptBlock,
    GLOBAL_SYSTEM_PROMPT_TAG,
} from '../../../src/server/executors/system-message-builder';

describe('buildGlobalSystemPromptBlock', () => {
    it('wraps the prompt in a labeled block', () => {
        const block = buildGlobalSystemPromptBlock('Cite all sources.');
        expect(block).toBeDefined();
        expect(block).toContain(`<${GLOBAL_SYSTEM_PROMPT_TAG}>`);
        expect(block).toContain(`</${GLOBAL_SYSTEM_PROMPT_TAG}>`);
        expect(block).toContain('Cite all sources.');
        // The wrapper is just the labeled tag around the raw prompt — no extra
        // framing prose is injected (removed in the doc cleanup refactor).
        expect(block).toBe(`<${GLOBAL_SYSTEM_PROMPT_TAG}>\nCite all sources.\n</${GLOBAL_SYSTEM_PROMPT_TAG}>`);
    });

    it('trims surrounding whitespace from the prompt', () => {
        const block = buildGlobalSystemPromptBlock('  Be concise.  \n');
        expect(block).toContain('Be concise.');
        expect(block).not.toContain('  Be concise.  ');
    });

    it.each([undefined, '', '   ', '\n\t '])('returns undefined for empty/whitespace input (%j)', (value) => {
        expect(buildGlobalSystemPromptBlock(value as string | undefined)).toBeUndefined();
    });
});

describe('SystemMessageBuilder.appendGlobalSystemPrompt', () => {
    it('includes the global block in the assembled content', async () => {
        const result = await systemMessageBuilder()
            .append('Mode restriction block.')
            .appendGlobalSystemPrompt('Always be polite.')
            .build();

        expect(result?.mode).toBe('append');
        expect(result?.content).toContain('Mode restriction block.');
        expect(result?.content).toContain(`<${GLOBAL_SYSTEM_PROMPT_TAG}>`);
        expect(result?.content).toContain('Always be polite.');
    });

    it('is a no-op when the prompt is empty (default inert path)', async () => {
        const result = await systemMessageBuilder()
            .append('Only block.')
            .appendGlobalSystemPrompt(undefined)
            .build();

        expect(result?.content).toBe('Only block.');
        expect(result?.content).not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
    });

    it('returns undefined when only an empty global prompt is appended', async () => {
        const result = await systemMessageBuilder()
            .appendGlobalSystemPrompt('   ')
            .build();

        expect(result).toBeUndefined();
    });

    it('can be the sole content of the system message', async () => {
        const result = await systemMessageBuilder()
            .appendGlobalSystemPrompt('Stand-alone global instruction.')
            .build();

        expect(result?.mode).toBe('append');
        expect(result?.content).toContain('Stand-alone global instruction.');
    });
});
