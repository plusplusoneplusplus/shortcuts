import { describe, it, expect, vi } from 'vitest';
import { buildAskUserAddon } from '../../../src/server/executors/prompt-builder';
import type { AskUserToolDeps } from '../../../src/server/llm-tools/ask-user-tool';

describe('buildAskUserAddon', () => {
    function makeDeps(): AskUserToolDeps {
        return {
            emitQuestion: vi.fn(),
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

    it('returns a non-empty suffix when enabled', () => {
        const result = buildAskUserAddon(true, makeDeps());
        expect(result.suffix.length).toBeGreaterThan(0);
        expect(result.suffix).toContain('ask_user');
    });

    it('answerQuestion returns false when disabled', () => {
        const result = buildAskUserAddon(false, makeDeps());
        expect(result.answerQuestion('q1', 'yes')).toBe(false);
    });

    it('skipQuestion returns false when disabled', () => {
        const result = buildAskUserAddon(false, makeDeps());
        expect(result.skipQuestion('q1')).toBe(false);
    });

    it('cancelAll is a no-op when disabled', () => {
        const result = buildAskUserAddon(false, makeDeps());
        expect(() => result.cancelAll()).not.toThrow();
    });
});
