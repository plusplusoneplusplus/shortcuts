import { describe, it, expect } from 'vitest';
import {
    getToolGroupCategory,
    getCategoryLabel,
    getToolGroupStatus,
    groupConsecutiveToolChunks,
    isSingleLineHtml,
} from '../../../src/server/spa/client/react/processes/toolGroupUtils';

// ---------------------------------------------------------------------------
// getToolGroupCategory
// ---------------------------------------------------------------------------

describe('getToolGroupCategory', () => {
    it('returns read for view, glob, grep', () => {
        expect(getToolGroupCategory('view')).toBe('read');
        expect(getToolGroupCategory('glob')).toBe('read');
        expect(getToolGroupCategory('grep')).toBe('read');
    });

    it('returns write for edit, create', () => {
        expect(getToolGroupCategory('edit')).toBe('write');
        expect(getToolGroupCategory('create')).toBe('write');
    });

    it('returns shell for powershell, shell', () => {
        expect(getToolGroupCategory('powershell')).toBe('shell');
        expect(getToolGroupCategory('shell')).toBe('shell');
    });

    it('returns null for task, skill, unknown, empty string', () => {
        expect(getToolGroupCategory('task')).toBeNull();
        expect(getToolGroupCategory('skill')).toBeNull();
        expect(getToolGroupCategory('unknown')).toBeNull();
        expect(getToolGroupCategory('')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getCategoryLabel
// ---------------------------------------------------------------------------

describe('getCategoryLabel', () => {
    it('single tool type', () => {
        expect(getCategoryLabel('read', { view: 3 })).toBe('3 read operations (view×3)');
    });

    it('mixed tools, stable alphabetical sort', () => {
        expect(getCategoryLabel('read', { view: 3, glob: 1 })).toBe('4 read operations (glob×1, view×3)');
    });

    it('shell category noun', () => {
        expect(getCategoryLabel('shell', { powershell: 2 })).toBe('2 shell operations (powershell×2)');
    });

    it('empty counts', () => {
        expect(getCategoryLabel('write', {})).toBe('0 write operations');
    });
});

// ---------------------------------------------------------------------------
// getToolGroupStatus
// ---------------------------------------------------------------------------

describe('getToolGroupStatus', () => {
    it('all succeeded → ✅ with no summary', () => {
        const result = getToolGroupStatus(['completed', 'completed', 'completed']);
        expect(result.icon).toBe('✅');
        expect(result.summary).toBeNull();
    });

    it('all failed → ❌ with no summary', () => {
        const result = getToolGroupStatus(['failed', 'failed']);
        expect(result.icon).toBe('❌');
        expect(result.summary).toBeNull();
    });

    it('partial failure (some failed, some succeeded) → ❓ with counts', () => {
        const result = getToolGroupStatus(['completed', 'failed', 'completed', 'completed']);
        expect(result.icon).toBe('❓');
        expect(result.summary).toBe('1 failed, 3 succeeded');
    });

    it('partial failure large group', () => {
        const statuses = Array(14).fill('completed');
        statuses.push('failed');
        const result = getToolGroupStatus(statuses);
        expect(result.icon).toBe('❓');
        expect(result.summary).toBe('1 failed, 14 succeeded');
    });

    it('still running → 🔄 with no summary', () => {
        const result = getToolGroupStatus(['completed', 'running']);
        expect(result.icon).toBe('🔄');
        expect(result.summary).toBeNull();
    });

    it('empty array → 🔄 with no summary', () => {
        const result = getToolGroupStatus([]);
        expect(result.icon).toBe('🔄');
        expect(result.summary).toBeNull();
    });

    it('mixed failed and running (no succeeded) → ❌', () => {
        const result = getToolGroupStatus(['failed', 'running']);
        expect(result.icon).toBe('❌');
        expect(result.summary).toBeNull();
    });

    it('undefined statuses treated as non-completed/non-failed', () => {
        const result = getToolGroupStatus([undefined, undefined]);
        expect(result.icon).toBe('🔄');
        expect(result.summary).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockTool {
    toolName: string;
    status?: string;
    startTime?: string;
    endTime?: string;
}

function makeChunk(toolId: string, parentToolId?: string) {
    return { kind: 'tool' as const, key: `k-${toolId}`, toolId, parentToolId };
}

function makeContentChunk(key: string) {
    return { kind: 'content' as const, key, html: 'text' };
}

function makeMap(entries: [string, MockTool][]): Map<string, MockTool> {
    return new Map(entries);
}

// ---------------------------------------------------------------------------
// groupConsecutiveToolChunks — no grouping
// ---------------------------------------------------------------------------

describe('groupConsecutiveToolChunks — no grouping', () => {
    it('empty array returns []', () => {
        expect(groupConsecutiveToolChunks([], new Map(), new Set())).toEqual([]);
    });

    it('single tool chunk is unchanged', () => {
        const chunk = makeChunk('t1');
        const result = groupConsecutiveToolChunks(
            [chunk],
            makeMap([['t1', { toolName: 'view', status: 'completed' }]]),
            new Set()
        );
        expect(result).toEqual([chunk]);
    });

    it('two chunks of different categories are unchanged', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'edit' }],
            ]),
            new Set()
        );
        expect(result).toEqual([c1, c2]);
    });

    it('two read chunks where one tool is a parent (in parentToolIds) — no group', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
            ]),
            new Set(['t2'])
        );
        expect(result).toEqual([c1, c2]);
    });

    it('two chunks where tool name is unmapped (task) — no group', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'task' }],
                ['t2', { toolName: 'task' }],
            ]),
            new Set()
        );
        expect(result).toEqual([c1, c2]);
    });

    it('two read chunks with different parentToolId — no group (cross-task boundary)', () => {
        const c1 = makeChunk('t1', 'p1');
        const c2 = makeChunk('t2', 'p2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
            ]),
            new Set()
        );
        expect(result).toEqual([c1, c2]);
    });
});

// ---------------------------------------------------------------------------
// groupConsecutiveToolChunks — grouping
// ---------------------------------------------------------------------------

describe('groupConsecutiveToolChunks — grouping', () => {
    it('two consecutive view chunks → one tool-group with category read and toolIds length 2', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'view', status: 'completed' }],
                ['t2', { toolName: 'view', status: 'completed' }],
            ]),
            new Set()
        );
        expect(result).toHaveLength(1);
        expect(result[0].kind).toBe('tool-group');
        const g = result[0] as any;
        expect(g.category).toBe('read');
        expect(g.toolIds).toHaveLength(2);
    });

    it('three consecutive glob chunks → one group with toolIds length 3', () => {
        const chunks = ['t1', 't2', 't3'].map(id => makeChunk(id));
        const result = groupConsecutiveToolChunks(
            chunks,
            makeMap([
                ['t1', { toolName: 'glob' }],
                ['t2', { toolName: 'glob' }],
                ['t3', { toolName: 'glob' }],
            ]),
            new Set()
        );
        expect(result).toHaveLength(1);
        expect((result[0] as any).toolIds).toHaveLength(3);
    });

    it('mixed run: view, view, edit, edit → two groups', () => {
        const chunks = ['t1', 't2', 't3', 't4'].map(id => makeChunk(id));
        const result = groupConsecutiveToolChunks(
            chunks,
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
                ['t3', { toolName: 'edit' }],
                ['t4', { toolName: 'edit' }],
            ]),
            new Set()
        );
        expect(result).toHaveLength(2);
        expect((result[0] as any).category).toBe('read');
        expect((result[1] as any).category).toBe('write');
    });

    it('content chunk breaks a run: view, content, view → two separate view chunks', () => {
        const c1 = makeChunk('t1');
        const content = makeContentChunk('c1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, content, c2],
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
            ]),
            new Set()
        );
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual(c1);
        expect(result[1]).toEqual(content);
        expect(result[2]).toEqual(c2);
    });

    it('group startTime = min, endTime = max when all tools have ended', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'view', startTime: '2024-01-01T00:00:01.000Z', endTime: '2024-01-01T00:00:03.000Z' }],
                ['t2', { toolName: 'view', startTime: '2024-01-01T00:00:02.000Z', endTime: '2024-01-01T00:00:05.000Z' }],
            ]),
            new Set()
        );
        const g = result[0] as any;
        expect(g.startTime).toBe(new Date('2024-01-01T00:00:01.000Z').getTime());
        expect(g.endTime).toBe(new Date('2024-01-01T00:00:05.000Z').getTime());
    });

    it('endTime is undefined when any tool has no endTime', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'view', startTime: '2024-01-01T00:00:01.000Z', endTime: '2024-01-01T00:00:03.000Z' }],
                ['t2', { toolName: 'view', startTime: '2024-01-01T00:00:02.000Z' }],
            ]),
            new Set()
        );
        const g = result[0] as any;
        expect(g.endTime).toBeUndefined();
    });

    it('allSucceeded true when all tools have status completed', () => {
        const chunks = ['t1', 't2'].map(id => makeChunk(id));
        const result = groupConsecutiveToolChunks(
            chunks,
            makeMap([
                ['t1', { toolName: 'view', status: 'completed' }],
                ['t2', { toolName: 'view', status: 'completed' }],
            ]),
            new Set()
        );
        expect((result[0] as any).allSucceeded).toBe(true);
    });

    it('allSucceeded false when any tool has failed status', () => {
        const chunks = ['t1', 't2'].map(id => makeChunk(id));
        const result = groupConsecutiveToolChunks(
            chunks,
            makeMap([
                ['t1', { toolName: 'view', status: 'completed' }],
                ['t2', { toolName: 'view', status: 'failed' }],
            ]),
            new Set()
        );
        expect((result[0] as any).allSucceeded).toBe(false);
    });

    it('allSucceeded false when tool is still running', () => {
        const chunks = ['t1', 't2'].map(id => makeChunk(id));
        const result = groupConsecutiveToolChunks(
            chunks,
            makeMap([
                ['t1', { toolName: 'view', status: 'completed' }],
                ['t2', { toolName: 'view', status: 'running' }],
            ]),
            new Set()
        );
        expect((result[0] as any).allSucceeded).toBe(false);
    });

    it('group key starts with "group-"', () => {
        const chunks = ['t1', 't2'].map(id => makeChunk(id));
        const result = groupConsecutiveToolChunks(
            chunks,
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
            ]),
            new Set()
        );
        expect((result[0] as any).key).toMatch(/^group-/);
    });

    it('non-grouped chunks before and after a group are preserved', () => {
        const before = makeChunk('b1');
        const g1 = makeChunk('t1');
        const g2 = makeChunk('t2');
        const after = makeChunk('a1');
        const result = groupConsecutiveToolChunks(
            [before, g1, g2, after],
            makeMap([
                ['b1', { toolName: 'task' }],
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
                ['a1', { toolName: 'task' }],
            ]),
            new Set()
        );
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual(before);
        expect(result[1].kind).toBe('tool-group');
        expect(result[2]).toEqual(after);
    });
});

// ---------------------------------------------------------------------------
// isSingleLineHtml
// ---------------------------------------------------------------------------

describe('isSingleLineHtml', () => {
    it('returns true for a single paragraph', () => {
        expect(isSingleLineHtml('<p>Let me explore the theme config.</p>')).toBe(true);
    });

    it('returns true for plain text', () => {
        expect(isSingleLineHtml('Hello world')).toBe(true);
    });

    it('returns true for text with inline tags', () => {
        expect(isSingleLineHtml('<p>Check the <strong>bold</strong> text.</p>')).toBe(true);
    });

    it('returns false for multi-line text', () => {
        expect(isSingleLineHtml('<p>Line 1</p>\n<p>Line 2</p>')).toBe(false);
    });

    it('returns false for text with embedded newlines', () => {
        expect(isSingleLineHtml('Line one\nLine two')).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isSingleLineHtml(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isSingleLineHtml('')).toBe(false);
    });

    it('returns false for whitespace-only HTML', () => {
        expect(isSingleLineHtml('<p>  </p>')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// groupConsecutiveToolChunks — groupSingleLineMessages
// ---------------------------------------------------------------------------

describe('groupConsecutiveToolChunks — groupSingleLineMessages', () => {
    it('absorbs single-line content between same-category tools', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const content = makeContentChunk('c1');
        const c3 = makeChunk('t3');
        const c4 = makeChunk('t4');

        const result = groupConsecutiveToolChunks(
            [c1, c2, content, c3, c4],
            makeMap([
                ['t1', { toolName: 'view', status: 'completed' }],
                ['t2', { toolName: 'view', status: 'completed' }],
                ['t3', { toolName: 'view', status: 'completed' }],
                ['t4', { toolName: 'view', status: 'completed' }],
            ]),
            new Set(),
            { groupSingleLineMessages: true }
        );

        expect(result).toHaveLength(1);
        const g = result[0] as any;
        expect(g.kind).toBe('tool-group');
        expect(g.toolIds).toHaveLength(4);
        expect(g.contentItems).toHaveLength(1);
        expect(g.contentItems[0].key).toBe('c1');
    });

    it('does not absorb content when option is false (default)', () => {
        const c1 = makeChunk('t1');
        const content = makeContentChunk('c1');
        const c2 = makeChunk('t2');

        const result = groupConsecutiveToolChunks(
            [c1, content, c2],
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
            ]),
            new Set()
        );

        expect(result).toHaveLength(3);
    });

    it('does not absorb multi-line content', () => {
        const c1 = makeChunk('t1');
        const multiLine = { kind: 'content' as const, key: 'ml', html: '<p>Line 1</p>\n<p>Line 2</p>' };
        const c2 = makeChunk('t2');

        const result = groupConsecutiveToolChunks(
            [c1, multiLine, c2],
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
            ]),
            new Set(),
            { groupSingleLineMessages: true }
        );

        expect(result).toHaveLength(3);
    });

    it('does not absorb trailing content with no following tool', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const content = makeContentChunk('c1');

        const result = groupConsecutiveToolChunks(
            [c1, c2, content],
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
            ]),
            new Set(),
            { groupSingleLineMessages: true }
        );

        expect(result).toHaveLength(2);
        expect(result[0].kind).toBe('tool-group');
        expect(result[1]).toEqual(content);
    });

    it('does not absorb content between different category tools', () => {
        const c1 = makeChunk('t1');
        const content = makeContentChunk('c1');
        const c2 = makeChunk('t2');

        const result = groupConsecutiveToolChunks(
            [c1, content, c2],
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'edit' }],
            ]),
            new Set(),
            { groupSingleLineMessages: true }
        );

        expect(result).toHaveLength(3);
    });

    it('absorbs multiple single-line content chunks between tools', () => {
        const c1 = makeChunk('t1');
        const content1 = makeContentChunk('c1');
        const c2 = makeChunk('t2');
        const content2 = makeContentChunk('c2');
        const c3 = makeChunk('t3');

        const result = groupConsecutiveToolChunks(
            [c1, content1, c2, content2, c3],
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
                ['t3', { toolName: 'view' }],
            ]),
            new Set(),
            { groupSingleLineMessages: true }
        );

        expect(result).toHaveLength(1);
        const g = result[0] as any;
        expect(g.toolIds).toHaveLength(3);
        expect(g.contentItems).toHaveLength(2);
    });

    it('contentItems is empty when no content is absorbed', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');

        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'view', status: 'completed' }],
                ['t2', { toolName: 'view', status: 'completed' }],
            ]),
            new Set(),
            { groupSingleLineMessages: true }
        );

        expect(result).toHaveLength(1);
        const g = result[0] as any;
        expect(g.contentItems).toEqual([]);
    });

    it('does not absorb content when following tool has different parentToolId', () => {
        const c1 = makeChunk('t1', 'p1');
        const content = makeContentChunk('c1');
        const c2 = makeChunk('t2', 'p2');

        const result = groupConsecutiveToolChunks(
            [c1, content, c2],
            makeMap([
                ['t1', { toolName: 'view' }],
                ['t2', { toolName: 'view' }],
            ]),
            new Set(),
            { groupSingleLineMessages: true }
        );

        expect(result).toHaveLength(3);
    });
});
