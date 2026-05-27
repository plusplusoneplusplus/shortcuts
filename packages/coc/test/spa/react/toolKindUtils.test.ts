/**
 * Pure tests for tool-kind classification + metric extraction.
 */

import { describe, it, expect } from 'vitest';
import {
    getToolKindInfo,
    KIND_PILL_CLASSES,
    getToolMetric,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolKindUtils';
import { normalizeToolName } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolNormalization';

describe('normalizeToolName — Claude provider aliases', () => {
    it('normalizes PascalCase "Skill" (Claude Code SDK) to lowercase "skill"', () => {
        expect(normalizeToolName('Skill')).toBe('skill');
    });

    it('passes through already-lowercase "skill" unchanged', () => {
        expect(normalizeToolName('skill')).toBe('skill');
    });
});

describe('getToolKindInfo', () => {
    it.each([
        ['view',         { label: 'Read',   cls: 'read'  }],
        ['read',         { label: 'Read',   cls: 'read'  }],
        ['grep',         { label: 'Grep',   cls: 'grep'  }],
        ['glob',         { label: 'Glob',   cls: 'glob'  }],
        ['edit',         { label: 'Edit',   cls: 'edit'  }],
        ['edit_file',    { label: 'Edit',   cls: 'edit'  }],
        ['apply_patch',  { label: 'Patch',  cls: 'edit'  }],
        ['file_change',  { label: 'Patch',  cls: 'edit'  }],
        ['create',       { label: 'Write',  cls: 'write' }],
        ['write_file',   { label: 'Write',  cls: 'write' }],
        ['bash',         { label: 'Bash',   cls: 'shell' }],
        ['shell',        { label: 'Shell',  cls: 'shell' }],
        ['command_execution', { label: 'Shell', cls: 'shell' }],
        ['powershell',   { label: 'PS',     cls: 'shell' }],
        ['sql',          { label: 'SQL',    cls: 'sql'   }],
        ['task',         { label: 'Agent',  cls: 'agent' }],
        ['read_agent',   { label: 'Poll',   cls: 'agent' }],
        ['task_complete',{ label: 'Done',   cls: 'task'  }],
        // skill tool — both casing variants
        ['skill',        { label: 'Skill',  cls: 'other' }],
        ['Skill',        { label: 'Skill',  cls: 'other' }],
    ])('classifies %s as %j', (toolName, expected) => {
        expect(getToolKindInfo(toolName as string)).toEqual(expected);
    });

    it('falls back to truncated label + other class for unknown tools', () => {
        const info = getToolKindInfo('something_super_long_unknown');
        expect(info.cls).toBe('other');
        expect(info.label.length).toBeLessThanOrEqual(8);
    });
});

describe('KIND_PILL_CLASSES', () => {
    it('exposes a class for every ToolKindClass', () => {
        const expected = ['read', 'grep', 'glob', 'edit', 'write', 'shell', 'sql', 'agent', 'task', 'other'];
        for (const k of expected) {
            expect(KIND_PILL_CLASSES[k as keyof typeof KIND_PILL_CLASSES]).toBeTruthy();
        }
    });

    it('uses light + dark pairs (each value contains a "dark:" segment)', () => {
        for (const v of Object.values(KIND_PILL_CLASSES)) {
            expect(v).toContain('dark:');
        }
    });
});

describe('getToolMetric', () => {
    it('returns line count for view/read tools', () => {
        const m = getToolMetric('view', { path: '/x' }, 'a\nb\nc', undefined);
        expect(m).toEqual({ kind: 'plain', text: '3 lines' });
    });

    it('returns hits count for grep tools', () => {
        const m = getToolMetric('grep', { pattern: 'x' }, 'a.ts:1: x\nb.ts:2: x', undefined);
        expect(m).toEqual({ kind: 'plain', text: '2 hits' });
    });

    it('returns files count for glob tools', () => {
        const m = getToolMetric('glob', { pattern: '*.ts' }, 'a.ts\nb.ts\nc.ts', undefined);
        expect(m).toEqual({ kind: 'plain', text: '3 files' });
    });

    it('returns +N −M diff for edit tools', () => {
        const m = getToolMetric('edit', { path: '/x.ts', old_str: 'a\nb', new_str: 'a\nb\nc\nd' }, '', undefined);
        expect(m).toEqual({ kind: 'diff', insertions: 4, deletions: 2 });
    });

    it('returns +N for create tools (no deletions)', () => {
        const m = getToolMetric('create', { path: '/x.ts', file_text: 'a\nb\nc' }, '', undefined);
        expect(m).toEqual({ kind: 'diff', insertions: 3, deletions: 0 });
    });

    it('returns line count for shell/bash/powershell when result is non-empty', () => {
        expect(getToolMetric('bash', { command: 'ls' }, 'a\nb', undefined)).toEqual({ kind: 'plain', text: '2 lines' });
        expect(getToolMetric('shell', { command: 'ls' }, 'a\nb\nc', undefined)).toEqual({ kind: 'plain', text: '3 lines' });
        expect(getToolMetric('powershell', { command: 'ls' }, 'a', undefined)).toEqual({ kind: 'plain', text: '1 line' });
    });

    it('formats large counts with k suffix', () => {
        const text = 'line\n'.repeat(2350);
        const m = getToolMetric('view', { path: '/x' }, text, undefined);
        expect(m?.kind).toBe('plain');
        expect(m?.text).toMatch(/^2(\.[0-9])?k lines$/);
    });

    it('returns null when there is no usable data', () => {
        expect(getToolMetric('view', { path: '/x' }, '', undefined)).toBeNull();
        expect(getToolMetric('grep', { pattern: 'x' }, '', undefined)).toBeNull();
        expect(getToolMetric('task', { description: 'x' }, '', undefined)).toBeNull();
    });

    it('reports "error" plain text when an error string is present', () => {
        const m = getToolMetric('view', { path: '/x' }, 'irrelevant', 'something failed');
        expect(m).toEqual({ kind: 'plain', text: 'error' });
    });

    it('uses singular line/hit/file labels when count is 1', () => {
        expect(getToolMetric('view', { path: '/x' }, 'one', undefined)).toEqual({ kind: 'plain', text: '1 line' });
        expect(getToolMetric('grep', { pattern: 'x' }, 'a.ts:1: x', undefined)).toEqual({ kind: 'plain', text: '1 hit' });
        expect(getToolMetric('glob', { pattern: '*.ts' }, 'a.ts', undefined)).toEqual({ kind: 'plain', text: '1 file' });
    });
});
