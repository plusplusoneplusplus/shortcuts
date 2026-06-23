import { describe, it, expect, vi, beforeAll } from 'vitest';
import { buildAskUserAddon } from '../../../src/server/executors/prompt-builder';
import type { AskUserToolDeps } from '../../../src/server/llm-tools/ask-user-tool';

describe('buildAskUserAddon', () => {
    function makeDeps(): AskUserToolDeps {
        return {
            emitQuestions: vi.fn(),
            computeTurnIndex: vi.fn().mockReturnValue(0),
        };
    }

    it('returns empty tools and suffix when disabled', () => {
        const result = buildAskUserAddon(false, makeDeps());
        expect(result.tools).toEqual([]);
        expect(result.suffix).toBe('');
        expect(result.hasPending()).toBe(false);
    });

    it('returns a tool when enabled', () => {
        const result = buildAskUserAddon(true, makeDeps());
        expect(result.tools).toHaveLength(1);
        expect(result.tools[0].name).toBe('ask_user');
    });

    it('returns an empty suffix when enabled', () => {
        const result = buildAskUserAddon(true, makeDeps());
        expect(result.suffix).toBe('');
    });

    it('answerQuestion returns false when disabled', () => {
        const result = buildAskUserAddon(false, makeDeps());
        expect(result.answerQuestion('q1', 'yes')).toBe(false);
    });

    it('skipQuestion returns false when disabled', () => {
        const result = buildAskUserAddon(false, makeDeps());
        expect(result.skipQuestion('q1')).toBe(false);
    });

    it('answerQuestions returns false when disabled', () => {
        const result = buildAskUserAddon(false, makeDeps());
        expect(result.answerQuestions([{ questionId: 'q1', answer: 'yes' }])).toBe(false);
    });

    it('cancelAll is a no-op when disabled', () => {
        const result = buildAskUserAddon(false, makeDeps());
        expect(() => result.cancelAll()).not.toThrow();
    });
});

describe('assertNoAskUserConflict', () => {
    // Import here to keep test file self-contained
    let assertNoAskUserConflict: typeof import('../../../src/server/executors/prompt-builder').assertNoAskUserConflict;

    beforeAll(async () => {
        const mod = await import('../../../src/server/executors/prompt-builder');
        assertNoAskUserConflict = mod.assertNoAskUserConflict;
    });

    it('does nothing when onUserInputRequest is not set', () => {
        expect(() => assertNoAskUserConflict({ tools: [{ name: 'ask_user', handler: async () => 'ok' }] })).not.toThrow();
    });

    it('does nothing when onUserInputRequest is set but no custom ask_user tool', () => {
        expect(() => assertNoAskUserConflict({
            onUserInputRequest: async () => ({ answer: 'yes', wasFreeform: false }),
            tools: [{ name: 'other_tool', handler: async () => 'ok' }],
        })).not.toThrow();
    });

    it('does nothing when both are absent', () => {
        expect(() => assertNoAskUserConflict({})).not.toThrow();
    });

    it('does nothing when onUserInputRequest is set and tools is undefined', () => {
        expect(() => assertNoAskUserConflict({
            onUserInputRequest: async () => ({ answer: 'yes', wasFreeform: false }),
        })).not.toThrow();
    });

    it('throws when both custom ask_user tool and onUserInputRequest are set', () => {
        expect(() => assertNoAskUserConflict({
            onUserInputRequest: async () => ({ answer: 'yes', wasFreeform: false }),
            tools: [{ name: 'ask_user', handler: async () => 'ok' }],
        })).toThrow(/Configuration conflict.*both.*custom ask_user.*onUserInputRequest/);
    });

    it('throws even when ask_user is among other tools', () => {
        expect(() => assertNoAskUserConflict({
            onUserInputRequest: async () => ({ answer: 'yes', wasFreeform: false }),
            tools: [
                { name: 'search', handler: async () => 'ok' },
                { name: 'ask_user', handler: async () => 'ok' },
                { name: 'edit', handler: async () => 'ok' },
            ],
        })).toThrow(/Configuration conflict/);
    });
});
