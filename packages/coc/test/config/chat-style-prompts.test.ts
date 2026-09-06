/**
 * Unit tests for the chat-style prompt override module (AC-03).
 *
 * The built-in defaults and the override resolution rules live here rather
 * than beside the injector so the admin SPA can import them; these tests pin
 * the validation contract PUT /api/admin/config exposes and the "malformed
 * config is ignored, never thrown on" rule injection depends on.
 */
import { describe, expect, it } from 'vitest';

import {
    CHAT_STYLE_FOCUS_LINES,
    CHAT_STYLE_PROMPT_MAX_LENGTH,
    EDITABLE_CHAT_STYLES,
    normalizeChatStylePromptOverrides,
    resolveChatStylePrompt,
    validateChatStylePromptOverrides,
} from '../../src/config/chat-style-prompts';

describe('CHAT_STYLE_FOCUS_LINES', () => {
    it('carries exactly the three editable styles and no default entry', () => {
        expect(Object.keys(CHAT_STYLE_FOCUS_LINES).sort()).toEqual(['direct', 'human', 'structured']);
        expect(EDITABLE_CHAT_STYLES).toEqual(['human', 'direct', 'structured']);
        expect((CHAT_STYLE_FOCUS_LINES as Record<string, string>).default).toBeUndefined();
    });
});

describe('validateChatStylePromptOverrides', () => {
    it('accepts an empty map, a partial map, and explicit nulls', () => {
        expect(validateChatStylePromptOverrides({})).toBeUndefined();
        expect(validateChatStylePromptOverrides({ direct: 'Lead with the answer.' })).toBeUndefined();
        expect(validateChatStylePromptOverrides({ human: null, direct: 'x' })).toBeUndefined();
        expect(validateChatStylePromptOverrides(undefined)).toBeUndefined();
    });

    it('rejects non-objects', () => {
        expect(validateChatStylePromptOverrides(42)).toMatch(/must be an object/);
        expect(validateChatStylePromptOverrides('text')).toMatch(/must be an object/);
        expect(validateChatStylePromptOverrides([])).toMatch(/must be an object/);
    });

    // 'default' has no prompt by design, so accepting it would let an admin
    // configure text that injection can never emit.
    it('rejects default and unknown style keys', () => {
        expect(validateChatStylePromptOverrides({ default: 'nope' })).toMatch(/not an editable chat style/);
        expect(validateChatStylePromptOverrides({ casual: 'nope' })).toMatch(/not an editable chat style/);
    });

    it('rejects non-string values and text over the length cap', () => {
        expect(validateChatStylePromptOverrides({ direct: 5 })).toMatch(/must be a string/);
        expect(validateChatStylePromptOverrides({ direct: 'x'.repeat(CHAT_STYLE_PROMPT_MAX_LENGTH) })).toBeUndefined();
        expect(validateChatStylePromptOverrides({ direct: 'x'.repeat(CHAT_STYLE_PROMPT_MAX_LENGTH + 1) }))
            .toMatch(/at most 4000 characters/);
    });
});

describe('normalizeChatStylePromptOverrides', () => {
    it('trims, and treats blank text as "no override"', () => {
        expect(normalizeChatStylePromptOverrides({ direct: '  keep it short  ' })).toEqual({ direct: 'keep it short' });
        expect(normalizeChatStylePromptOverrides({ direct: '   ' })).toEqual({});
        expect(normalizeChatStylePromptOverrides({ direct: '' })).toEqual({});
    });

    it('drops unknown keys, nulls and non-strings instead of throwing', () => {
        expect(normalizeChatStylePromptOverrides({ default: 'x', casual: 'y', human: null, direct: 7, structured: 'ok' }))
            .toEqual({ structured: 'ok' });
    });

    it('returns an empty map for anything that is not a plain object', () => {
        for (const bad of [undefined, null, 'text', 42, [], true]) {
            expect(normalizeChatStylePromptOverrides(bad)).toEqual({});
        }
    });
});

describe('resolveChatStylePrompt', () => {
    it('falls back to the built-in default when no override is set', () => {
        for (const style of EDITABLE_CHAT_STYLES) {
            expect(resolveChatStylePrompt(style, undefined)).toBe(CHAT_STYLE_FOCUS_LINES[style]);
            expect(resolveChatStylePrompt(style, {})).toBe(CHAT_STYLE_FOCUS_LINES[style]);
        }
    });

    it('prefers a set override', () => {
        expect(resolveChatStylePrompt('direct', { direct: 'Answer first.' })).toBe('Answer first.');
        // An override for one style leaves the others on their built-in text.
        expect(resolveChatStylePrompt('human', { direct: 'Answer first.' })).toBe(CHAT_STYLE_FOCUS_LINES.human);
    });

    it('never resolves a prompt for default or an unknown style', () => {
        expect(resolveChatStylePrompt('default', { direct: 'x' })).toBeUndefined();
        expect(resolveChatStylePrompt('casual', {})).toBeUndefined();
    });
});
