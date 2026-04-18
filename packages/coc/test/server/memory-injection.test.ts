/**
 * Tests for appendBoundedMemoryContext in prompt-builder.ts
 */
import { describe, it, expect } from 'vitest';
import { appendBoundedMemoryContext } from '../../src/server/executors/prompt-builder';
import type { BoundedMemoryAddon } from '../../src/server/executors/bounded-memory-addon';
import type { SystemMessageConfig } from '@plusplusoneplusplus/forge';

// ============================================================================
// Tests
// ============================================================================

describe('appendBoundedMemoryContext', () => {
    it('passes through when addon is undefined', () => {
        const msg: SystemMessageConfig = { mode: 'append', content: 'base' };
        const result = appendBoundedMemoryContext(msg, undefined);
        expect(result).toBe(msg);
    });

    it('passes through when addon has no systemMessageSuffix', () => {
        const msg: SystemMessageConfig = { mode: 'append', content: 'base' };
        const addon: BoundedMemoryAddon = { systemMessageSuffix: undefined, tools: [], suffix: '' };
        const result = appendBoundedMemoryContext(msg, addon);
        expect(result).toBe(msg);
    });

    it('appends suffix to existing content', () => {
        const msg: SystemMessageConfig = { mode: 'append', content: 'You are a helpful assistant.' };
        const addon: BoundedMemoryAddon = {
            systemMessageSuffix: 'MEMORY BLOCK HERE',
            tools: [],
            suffix: '',
        };
        const result = appendBoundedMemoryContext(msg, addon);
        expect(result).not.toBe(msg);
        expect(result?.content).toContain('You are a helpful assistant.');
        expect(result?.content).toContain('MEMORY BLOCK HERE');
        expect(result?.mode).toBe('append');
    });

    it('creates system message from scratch when base is undefined', () => {
        const addon: BoundedMemoryAddon = {
            systemMessageSuffix: 'MEMORY BLOCK HERE',
            tools: [],
            suffix: '',
        };
        const result = appendBoundedMemoryContext(undefined, addon);
        expect(result).not.toBeUndefined();
        expect(result?.content).toBe('MEMORY BLOCK HERE');
        expect(result?.mode).toBe('append');
    });

    it('creates system message when base has empty content', () => {
        const msg: SystemMessageConfig = { mode: 'append', content: '' };
        const addon: BoundedMemoryAddon = {
            systemMessageSuffix: 'MEMORY BLOCK',
            tools: [],
            suffix: '',
        };
        const result = appendBoundedMemoryContext(msg, addon);
        expect(result?.content).toBe('MEMORY BLOCK');
    });

    it('old appendMemoryContext is removed', async () => {
        const promptBuilder = await import('../../src/server/executors/prompt-builder');
        expect((promptBuilder as any).appendMemoryContext).toBeUndefined();
    });
});
