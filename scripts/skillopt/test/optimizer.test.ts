/**
 * AC-05 tests: Optimizer edit (bounded)
 */
import { describe, it, expect } from 'vitest';
import { parseOptimizerEdit, applyEdit, buildOptimizerPrompt, OptimizerEdit } from '../optimizer';

// ─── parseOptimizerEdit ───────────────────────────────────────────────────────

describe('parseOptimizerEdit', () => {
    it('parses a valid add edit', () => {
        const output = '```json\n{"type":"add","anchor":"## Rules","content":"- Always add tests"}\n```';
        const { edit, note } = parseOptimizerEdit(output);
        expect(edit).not.toBeNull();
        expect(edit!.type).toBe('add');
        expect(edit!.anchor).toBe('## Rules');
        expect(edit!.content).toBe('- Always add tests');
        expect(note).toBe('ok');
    });

    it('parses a valid delete edit', () => {
        const output = '```json\n{"type":"delete","anchor":"- obsolete rule"}\n```';
        const { edit, note } = parseOptimizerEdit(output);
        expect(edit).not.toBeNull();
        expect(edit!.type).toBe('delete');
        expect(note).toBe('ok');
    });

    it('parses a valid replace edit', () => {
        const output = '```json\n{"type":"replace","anchor":"old line","content":"new line"}\n```';
        const { edit, note } = parseOptimizerEdit(output);
        expect(edit).not.toBeNull();
        expect(edit!.type).toBe('replace');
        expect(edit!.content).toBe('new line');
    });

    it('returns null edit and note when no JSON block present', () => {
        const { edit, note } = parseOptimizerEdit('Sorry, I cannot help.');
        expect(edit).toBeNull();
        expect(note).toMatch(/no json/i);
    });

    it('returns null edit on malformed JSON', () => {
        const output = '```json\n{not valid json}\n```';
        const { edit, note } = parseOptimizerEdit(output);
        expect(edit).toBeNull();
        expect(note).toMatch(/parse error/i);
    });

    it('returns null edit on invalid type', () => {
        const output = '```json\n{"type":"modify","anchor":"something"}\n```';
        const { edit, note } = parseOptimizerEdit(output);
        expect(edit).toBeNull();
        expect(note).toMatch(/type/i);
    });

    it('returns null edit on empty anchor', () => {
        const output = '```json\n{"type":"delete","anchor":""}\n```';
        const { edit, note } = parseOptimizerEdit(output);
        expect(edit).toBeNull();
        expect(note).toMatch(/anchor/i);
    });

    it('returns null edit when add/replace is missing content', () => {
        const output = '```json\n{"type":"add","anchor":"## Header"}\n```';
        const { edit, note } = parseOptimizerEdit(output);
        expect(edit).toBeNull();
        expect(note).toMatch(/content/i);
    });
});

// ─── applyEdit ────────────────────────────────────────────────────────────────

describe('applyEdit', () => {
    const skillText = [
        '# My Skill',
        '## Rules',
        '- Rule 1',
        '- Rule 2',
        '## Notes',
    ].join('\n');

    it('adds a line after the anchor line', () => {
        const edit: OptimizerEdit = { type: 'add', anchor: '- Rule 1', content: '- Rule 1.5' };
        const { result, applied } = applyEdit(skillText, edit);
        expect(applied).toBe(true);
        const lines = result.split('\n');
        const idx = lines.indexOf('- Rule 1');
        expect(lines[idx + 1]).toBe('- Rule 1.5');
    });

    it('deletes the anchor line', () => {
        const edit: OptimizerEdit = { type: 'delete', anchor: '- Rule 2' };
        const { result, applied } = applyEdit(skillText, edit);
        expect(applied).toBe(true);
        expect(result).not.toContain('- Rule 2');
        expect(result).toContain('- Rule 1');
    });

    it('replaces the anchor line', () => {
        const edit: OptimizerEdit = { type: 'replace', anchor: '- Rule 1', content: '- Improved Rule 1' };
        const { result, applied } = applyEdit(skillText, edit);
        expect(applied).toBe(true);
        expect(result).toContain('- Improved Rule 1');
        expect(result).not.toContain('- Rule 1\n');
    });

    it('returns original when anchor not found', () => {
        const edit: OptimizerEdit = { type: 'delete', anchor: 'nonexistent line' };
        const { result, applied } = applyEdit(skillText, edit);
        expect(applied).toBe(false);
        expect(result).toBe(skillText);
    });

    it('handles partial anchor match', () => {
        // anchor "Rule 1" should match "- Rule 1"
        const edit: OptimizerEdit = { type: 'delete', anchor: 'Rule 1' };
        const { result, applied } = applyEdit(skillText, edit);
        expect(applied).toBe(true);
        expect(result).not.toContain('- Rule 1');
    });
});

// ─── buildOptimizerPrompt ─────────────────────────────────────────────────────

describe('buildOptimizerPrompt', () => {
    it('contains the current skill text', () => {
        const prompt = buildOptimizerPrompt('# Skill\nDo things.', []);
        expect(prompt).toContain('# Skill');
        expect(prompt).toContain('Do things.');
    });

    it('contains rollout summaries', () => {
        const summaries = [{
            taskId: 'task-1',
            score: 0.75,
            diff: 'diff --git a/foo.ts',
            stdout: 'agent output',
        }];
        const prompt = buildOptimizerPrompt('# Skill', summaries);
        expect(prompt).toContain('task-1');
        expect(prompt).toContain('0.750');
        expect(prompt).toContain('diff --git a/foo.ts');
    });

    it('requests a JSON code block in the output', () => {
        const prompt = buildOptimizerPrompt('# Skill', []);
        expect(prompt).toMatch(/```json/);
        expect(prompt).toMatch(/"type"/);
        expect(prompt).toMatch(/"anchor"/);
    });
});
