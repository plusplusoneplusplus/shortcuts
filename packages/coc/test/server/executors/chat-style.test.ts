/**
 * Chat Style Instruction Builder Unit Tests
 *
 * The emitted `<chat-style>` text is a versioned product contract, so the four
 * blocks are asserted verbatim here. A wording change should be a deliberate
 * product change that updates these snapshots, not an incidental edit.
 */

import { describe, it, expect } from 'vitest';
import {
    CHAT_STYLE_SYSTEM_TAG,
    buildChatStyleSystemMessage,
    chatStyleLabel,
} from '../../../src/server/executors/chat-style';
import { systemMessageBuilder } from '../../../src/server/executors/system-message-builder';
import { CHAT_STYLES } from '@plusplusoneplusplus/coc-client';

describe('buildChatStyleSystemMessage', () => {
    it('emits the exact Human block', () => {
        expect(buildChatStyleSystemMessage('human', true)).toBe(
            '<chat-style>\n'
            + 'Selected style: Human.\n'
            + 'Write like a helpful coworker in a normal conversation. Keep the flow natural and let the wording carry the answer instead of structure.\n'
            + '</chat-style>',
        );
    });

    it('emits the exact Direct block', () => {
        expect(buildChatStyleSystemMessage('direct', true)).toBe(
            '<chat-style>\n'
            + 'Selected style: Direct.\n'
            + 'Lead with the answer or action. Use the fewest words that preserve important facts. Cut preamble, softening, repetition, and background the user did not ask for.\n'
            + '</chat-style>',
        );
    });

    it('emits the exact Analytical block, asking for a reasoning summary rather than hidden chain-of-thought', () => {
        const block = buildChatStyleSystemMessage('analytical', true);
        expect(block).toBe(
            '<chat-style>\n'
            + 'Selected style: Analytical.\n'
            + 'Explain the reasoning. Surface assumptions, evidence, causes, alternatives, and tradeoffs, and say what the risks are. Give a useful summary of the reasoning and its conclusions rather than a raw transcript of your internal thinking.\n'
            + '</chat-style>',
        );
        expect(block).toContain('rather than a raw transcript of your internal thinking');
    });

    it('emits the exact Structured block, gated on the answer benefiting from it', () => {
        const block = buildChatStyleSystemMessage('structured', true);
        expect(block).toBe(
            '<chat-style>\n'
            + 'Selected style: Structured.\n'
            + 'Make the answer easy to scan: outcome, key points, decisions, risks, and next steps. Only organize this way when the answer benefits from it, and never pad a one-line answer into a template. Do not invent owners, dates, decisions, risks, or certainty the context does not support.\n'
            + '</chat-style>',
        );
        expect(block).toContain('Only organize this way when the answer benefits from it');
    });

    it.each(CHAT_STYLES)('carries no shared preamble for %s — tag, label, focus, tag', (style) => {
        const lines = buildChatStyleSystemMessage(style, true)!.split('\n');
        expect(lines).toHaveLength(4);
        expect(lines[0]).toBe(`<${CHAT_STYLE_SYSTEM_TAG}>`);
        expect(lines[1]).toBe(`Selected style: ${chatStyleLabel(style)}.`);
        expect(lines[3]).toBe(`</${CHAT_STYLE_SYSTEM_TAG}>`);
        expect(lines.some((line) => line === '')).toBe(false);
    });

    it('drops the precedence disclaimer and every other shared baseline line', () => {
        for (const style of CHAT_STYLES) {
            const block = buildChatStyleSystemMessage(style, true)!;
            expect(block).not.toContain('This guidance covers presentation only.');
            expect(block).not.toContain('all take priority');
            expect(block).not.toContain('Use plain, natural language');
            expect(block).not.toContain('Avoid robotic phrasing');
            expect(block).not.toContain('Use headings and lists only when they help');
        }
    });

    it.each(CHAT_STYLES)('returns undefined for %s when the feature is disabled', (style) => {
        expect(buildChatStyleSystemMessage(style, false)).toBeUndefined();
    });

    it('returns undefined when no style was selected', () => {
        expect(buildChatStyleSystemMessage(undefined, true)).toBeUndefined();
    });

    it.each([
        'HUMAN',
        'friendly',
        '',
        ' direct',
        null,
        42,
        {},
    ])('returns undefined for the invalid value %j', (value) => {
        expect(buildChatStyleSystemMessage(value as unknown as string, true)).toBeUndefined();
    });

    it('covers every stable wire value', () => {
        for (const style of CHAT_STYLES) {
            const block = buildChatStyleSystemMessage(style, true);
            expect(block).toBeDefined();
            expect(block).toContain(`Selected style: ${chatStyleLabel(style)}.`);
        }
    });
});

describe('SystemMessageBuilder.appendChatStyle', () => {
    it('inserts the block exactly once, in chain order', async () => {
        const result = await systemMessageBuilder()
            .append('Repository behavior instructions.')
            .appendChatStyle('direct', true)
            .append('Source-link formatting.')
            .build();

        const content = result!.content!;
        const openTags = content.match(new RegExp(`<${CHAT_STYLE_SYSTEM_TAG}>`, 'g')) ?? [];
        expect(openTags).toHaveLength(1);
        expect(content.indexOf('Repository behavior instructions.')).toBeLessThan(content.indexOf(`<${CHAT_STYLE_SYSTEM_TAG}>`));
        expect(content.indexOf(`</${CHAT_STYLE_SYSTEM_TAG}>`)).toBeLessThan(content.indexOf('Source-link formatting.'));
    });

    it('is a no-op when the feature is disabled', async () => {
        const result = await systemMessageBuilder()
            .append('Only block.')
            .appendChatStyle('structured', false)
            .build();

        expect(result?.content).toBe('Only block.');
        expect(result?.content).not.toContain(CHAT_STYLE_SYSTEM_TAG);
    });

    it('is a no-op when the style is absent or invalid', async () => {
        for (const style of [undefined, 'nonsense']) {
            const result = await systemMessageBuilder()
                .append('Only block.')
                .appendChatStyle(style, true)
                .build();
            expect(result?.content).toBe('Only block.');
        }
    });

    it('produces nothing at all when the style block is the only step', async () => {
        expect(await systemMessageBuilder().appendChatStyle('human', false).build()).toBeUndefined();
    });
});
