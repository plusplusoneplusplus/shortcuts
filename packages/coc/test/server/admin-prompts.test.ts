/**
 * Tests for GET /api/admin/prompts endpoint and getBuiltInPrompts().
 */

import { describe, it, expect } from 'vitest';
import { getBuiltInPrompts } from '../../src/server/admin/admin-handler';

describe('getBuiltInPrompts', () => {
    it('returns all 8 built-in prompts', () => {
        const prompts = getBuiltInPrompts();
        const ids = Object.keys(prompts);
        expect(ids).toHaveLength(8);
        expect(ids).toContain('read-only-mode');
        expect(ids).toContain('task-creation');
        expect(ids).toContain('plan-generation');
        expect(ids).toContain('skill-prompt-wrapper');
        expect(ids).toContain('memory-tool-schema');
        expect(ids).toContain('memory-security-patterns');
        expect(ids).toContain('follow-up-suggestions');
        expect(ids).toContain('diff-classification-user');
    });

    it('each prompt has all required fields', () => {
        const prompts = getBuiltInPrompts();
        for (const [key, p] of Object.entries(prompts)) {
            expect(p.id).toBe(key);
            expect(typeof p.title).toBe('string');
            expect(p.title.length).toBeGreaterThan(0);
            expect(typeof p.group).toBe('string');
            expect(typeof p.source).toBe('string');
            expect(typeof p.description).toBe('string');
            expect(typeof p.text).toBe('string');
            expect(p.text.length).toBeGreaterThan(0);
        }
    });

    it('groups are Pipeline, Memory, UI, or Diff Classification', () => {
        const prompts = getBuiltInPrompts();
        const validGroups = new Set(['Pipeline', 'Memory', 'UI', 'Diff Classification']);
        for (const p of Object.values(prompts)) {
            expect(validGroups.has(p.group)).toBe(true);
        }
    });

    it('Pipeline group contains 4 prompts', () => {
        const prompts = getBuiltInPrompts();
        const pipelinePrompts = Object.values(prompts).filter(p => p.group === 'Pipeline');
        expect(pipelinePrompts).toHaveLength(4);
    });

    it('Memory group contains 2 prompts', () => {
        const prompts = getBuiltInPrompts();
        const memoryPrompts = Object.values(prompts).filter(p => p.group === 'Memory');
        expect(memoryPrompts).toHaveLength(2);
    });

    it('UI group contains 1 prompt', () => {
        const prompts = getBuiltInPrompts();
        const uiPrompts = Object.values(prompts).filter(p => p.group === 'UI');
        expect(uiPrompts).toHaveLength(1);
    });

    it('Diff Classification group contains 1 editable prompt', () => {
        const prompts = getBuiltInPrompts();
        const diffPrompts = Object.values(prompts).filter(p => p.group === 'Diff Classification');
        expect(diffPrompts).toHaveLength(1);
        for (const p of diffPrompts) {
            expect(p.editable).toBe(true);
            expect(Array.isArray(p.templateVars)).toBe(true);
        }
    });

    it('Pipeline, Memory, and UI prompts are not editable', () => {
        const prompts = getBuiltInPrompts();
        const readOnlyPrompts = Object.values(prompts).filter(p => ['Pipeline', 'Memory', 'UI'].includes(p.group));
        for (const p of readOnlyPrompts) {
            expect(p.editable).toBeFalsy();
        }
    });

    it('read-only-mode prompt contains key phrases', () => {
        const prompts = getBuiltInPrompts();
        const p = prompts['read-only-mode'];
        expect(p.text).toContain('read-only mode');
        expect(p.text).toContain('<coc-read-only-mode>');
        expect(p.text).toContain('plan file');
    });
});
