import { describe, it, expect } from 'vitest';
import {
    getToolGroupCategory,
    getCategoryLabel,
    getToolGroupStatus,
    groupConsecutiveToolChunks,
    isSingleLineHtml,
    filterWhisperChunks,
} from '../../../src/server/spa/client/react/processes/toolGroupUtils';
import type { WhisperGroupChunk } from '../../../src/server/spa/client/react/processes/toolGroupUtils';

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

    it('returns shell for powershell, shell, bash', () => {
        expect(getToolGroupCategory('powershell')).toBe('shell');
        expect(getToolGroupCategory('shell')).toBe('shell');
        // bash is used on Linux/macOS — regression: was previously returning null
        expect(getToolGroupCategory('bash')).toBe('shell');
    });

    it('returns null for task, skill, unknown, empty string', () => {
        expect(getToolGroupCategory('task')).toBeNull();
        expect(getToolGroupCategory('skill')).toBeNull();
        expect(getToolGroupCategory('unknown')).toBeNull();
        expect(getToolGroupCategory('')).toBeNull();
    });

    it('returns agent for read_agent with agent_id in args', () => {
        expect(getToolGroupCategory('read_agent', { agent_id: 'my-agent' })).toBe('agent');
    });

    it('returns null for read_agent without agent_id', () => {
        expect(getToolGroupCategory('read_agent', {})).toBeNull();
        expect(getToolGroupCategory('read_agent')).toBeNull();
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

    it('agent category with agentId', () => {
        expect(getCategoryLabel('agent', { read_agent: 3 }, 'my-agent')).toBe('3 polls → my-agent');
    });

    it('agent category without agentId falls back to unknown', () => {
        expect(getCategoryLabel('agent', { read_agent: 1 })).toBe('1 poll → unknown');
    });

    it('agent category singular poll', () => {
        expect(getCategoryLabel('agent', { read_agent: 1 }, 'x')).toBe('1 poll → x');
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
    args?: Record<string, unknown>;
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

// groupConsecutiveToolChunks — orderedItems
// ────────────────────────────────────────────────────────────────────

describe('groupConsecutiveToolChunks — orderedItems', () => {
    it('orderedItems preserves interleaved order of tools and content', () => {
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
        expect(g.orderedItems).toEqual([
            { type: 'tool', toolId: 't1' },
            { type: 'tool', toolId: 't2' },
            { type: 'content', key: 'c1', html: 'text' },
            { type: 'tool', toolId: 't3' },
            { type: 'tool', toolId: 't4' },
        ]);
    });

    it('orderedItems with multiple content items in correct positions', () => {
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
        expect(g.orderedItems).toEqual([
            { type: 'tool', toolId: 't1' },
            { type: 'content', key: 'c1', html: 'text' },
            { type: 'tool', toolId: 't2' },
            { type: 'content', key: 'c2', html: 'text' },
            { type: 'tool', toolId: 't3' },
        ]);
    });

    it('orderedItems contains only tools when no content is absorbed', () => {
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
        expect(g.orderedItems).toEqual([
            { type: 'tool', toolId: 't1' },
            { type: 'tool', toolId: 't2' },
        ]);
    });
});

// ---------------------------------------------------------------------------
// groupConsecutiveToolChunks — agent (read_agent) grouping
// ---------------------------------------------------------------------------

describe('groupConsecutiveToolChunks — agent grouping', () => {
    it('two consecutive read_agent with same agent_id → grouped', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'read_agent', args: { agent_id: 'my-agent' } }],
                ['t2', { toolName: 'read_agent', args: { agent_id: 'my-agent' } }],
            ]),
            new Set()
        );
        expect(result).toHaveLength(1);
        const g = result[0] as any;
        expect(g.kind).toBe('tool-group');
        expect(g.category).toBe('agent');
        expect(g.toolIds).toEqual(['t1', 't2']);
        expect(g.agentId).toBe('my-agent');
    });

    it('three consecutive polls, same agent_id → single group of 3', () => {
        const chunks = ['t1', 't2', 't3'].map(id => makeChunk(id));
        const result = groupConsecutiveToolChunks(
            chunks,
            makeMap([
                ['t1', { toolName: 'read_agent', args: { agent_id: 'a1' } }],
                ['t2', { toolName: 'read_agent', args: { agent_id: 'a1' } }],
                ['t3', { toolName: 'read_agent', args: { agent_id: 'a1' } }],
            ]),
            new Set()
        );
        expect(result).toHaveLength(1);
        const g = result[0] as any;
        expect(g.toolIds).toHaveLength(3);
        expect(g.agentId).toBe('a1');
    });

    it('two read_agent with different agent_id → NOT grouped', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'read_agent', args: { agent_id: 'a1' } }],
                ['t2', { toolName: 'read_agent', args: { agent_id: 'a2' } }],
            ]),
            new Set()
        );
        expect(result).toEqual([c1, c2]);
    });

    it('read_agent followed by non-read_agent → NOT grouped', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'read_agent', args: { agent_id: 'a1' } }],
                ['t2', { toolName: 'view' }],
            ]),
            new Set()
        );
        expect(result).toEqual([c1, c2]);
    });

    it('single read_agent → emitted as-is (no group)', () => {
        const c1 = makeChunk('t1');
        const result = groupConsecutiveToolChunks(
            [c1],
            makeMap([
                ['t1', { toolName: 'read_agent', args: { agent_id: 'a1' } }],
            ]),
            new Set()
        );
        expect(result).toEqual([c1]);
    });

    it('read_agent without agent_id → not groupable', () => {
        const c1 = makeChunk('t1');
        const c2 = makeChunk('t2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'read_agent', args: {} }],
                ['t2', { toolName: 'read_agent', args: {} }],
            ]),
            new Set()
        );
        expect(result).toEqual([c1, c2]);
    });

    it('agent group preserves parentToolId boundary', () => {
        const c1 = makeChunk('t1', 'p1');
        const c2 = makeChunk('t2', 'p2');
        const result = groupConsecutiveToolChunks(
            [c1, c2],
            makeMap([
                ['t1', { toolName: 'read_agent', args: { agent_id: 'a1' } }],
                ['t2', { toolName: 'read_agent', args: { agent_id: 'a1' } }],
            ]),
            new Set()
        );
        expect(result).toEqual([c1, c2]);
    });

    it('agent group has no agentId for non-agent categories', () => {
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
        expect((result[0] as any).agentId).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// filterWhisperChunks
// ---------------------------------------------------------------------------

describe('filterWhisperChunks', () => {
    it('returns [] for empty input', () => {
        expect(filterWhisperChunks([], new Map())).toEqual([]);
    });

    it('keeps only last content chunk and task_complete, collapses the rest', () => {
        const chunks = [
            { kind: 'content', key: 'c1', html: '<p>Let me check...</p>' },
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c2', html: '<p>Found it.</p>' },
            { kind: 'tool', key: 'k-t3', toolId: 't3' },
            { kind: 'content', key: 'c3', html: '<p>I fixed the bug.</p>' },
            { kind: 'tool', key: 'k-tc', toolId: 'tc' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'grep', status: 'completed' }],
            ['t2', { toolName: 'view', status: 'completed' }],
            ['t3', { toolName: 'edit', status: 'completed' }],
            ['tc', { toolName: 'task_complete', status: 'completed' }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        // Should be: [whisper-group, last-content (c3), task_complete (tc)]
        expect(result).toHaveLength(3);
        expect(result[0].kind).toBe('whisper-group');
        expect(result[1].kind).toBe('content');
        expect((result[1] as any).key).toBe('c3');
        expect(result[2].kind).toBe('tool');
        expect((result[2] as any).toolId).toBe('tc');
    });

    it('whisper summary counts tool calls and messages correctly', () => {
        const chunks = [
            { kind: 'content', key: 'c1', html: '<p>msg1</p>' },
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'content', key: 'c2', html: '<p>msg2</p>' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c3', html: '<p>Final message.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'view', status: 'completed', startTime: '2024-01-01T00:00:01Z', endTime: '2024-01-01T00:00:02Z' }],
            ['t2', { toolName: 'grep', status: 'completed', startTime: '2024-01-01T00:00:03Z', endTime: '2024-01-01T00:00:05Z' }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        expect(result).toHaveLength(2); // whisper-group + last content
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.kind).toBe('whisper-group');
        expect(wg.summary.toolCallCount).toBe(2);
        expect(wg.summary.messageCount).toBe(2); // c1, c2 (c3 is tail)
        expect(wg.summary.startTime).toBe(new Date('2024-01-01T00:00:01Z').getTime());
        expect(wg.summary.endTime).toBe(new Date('2024-01-01T00:00:05Z').getTime());
    });

    it('no whisper group when only tail items exist (content + task_complete)', () => {
        const chunks = [
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
            { kind: 'tool', key: 'k-tc', toolId: 'tc' },
        ];
        const toolById = makeMap([
            ['tc', { toolName: 'task_complete', status: 'completed' }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        // Both are tail items → no whisper group
        expect(result).toHaveLength(2);
        expect(result[0].kind).toBe('content');
        expect(result[1].kind).toBe('tool');
    });

    it('only task_complete with no content — shows only task_complete', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'tool', key: 'k-tc', toolId: 'tc' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'view', status: 'completed' }],
            ['t2', { toolName: 'edit', status: 'completed' }],
            ['tc', { toolName: 'task_complete', status: 'completed' }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        expect(result).toHaveLength(2); // whisper-group + task_complete
        expect(result[0].kind).toBe('whisper-group');
        expect(result[1].kind).toBe('tool');
        expect((result[1] as any).toolId).toBe('tc');
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.toolCallCount).toBe(2);
        expect(wg.summary.messageCount).toBe(0);
    });

    it('endTime is undefined when some tools are still running', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c1', html: '<p>Working...</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'view', status: 'completed', startTime: '2024-01-01T00:00:01Z', endTime: '2024-01-01T00:00:02Z' }],
            ['t2', { toolName: 'view', status: 'running', startTime: '2024-01-01T00:00:03Z' }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.endTime).toBeUndefined();
    });

    it('preceding chunks includes tool-group chunks and counts their tools', () => {
        const chunks = [
            {
                kind: 'tool-group', key: 'group-1', category: 'read',
                toolIds: ['t1', 't2', 't3'],
                contentItems: [], orderedItems: [],
                startTime: 1000, endTime: 3000, allSucceeded: true,
            },
            { kind: 'content', key: 'c1', html: '<p>Result.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'view', status: 'completed', startTime: '2024-01-01T00:00:01Z', endTime: '2024-01-01T00:00:02Z' }],
            ['t2', { toolName: 'view', status: 'completed', startTime: '2024-01-01T00:00:02Z', endTime: '2024-01-01T00:00:03Z' }],
            ['t3', { toolName: 'view', status: 'completed', startTime: '2024-01-01T00:00:03Z', endTime: '2024-01-01T00:00:04Z' }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        expect(result).toHaveLength(2); // whisper-group + content
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.toolCallCount).toBe(3);
        expect(wg.summary.messageCount).toBe(0);
    });

    it('single content chunk only → no whisper group, returned as-is', () => {
        const chunks = [
            { kind: 'content', key: 'c1', html: '<p>Just text.</p>' },
        ];
        const result = filterWhisperChunks(chunks, new Map());
        expect(result).toHaveLength(1);
        expect(result[0].kind).toBe('content');
    });

    it('preserves preceding chunks inside whisper group for drill-down', () => {
        const chunks = [
            { kind: 'content', key: 'c1', html: '<p>Let me check...</p>' },
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'content', key: 'c2', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'grep', status: 'completed' }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        expect(result).toHaveLength(2); // whisper-group + last content
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.precedingChunks).toHaveLength(2); // c1 + t1
        expect(wg.precedingChunks[0].kind).toBe('content');
        expect(wg.precedingChunks[1].kind).toBe('tool');
    });

    it('commitCount is set when shell tool results contain git commit output', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'view', status: 'completed' }],
            ['t2', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "feat: stuff"' },
                result: '[main abc1234] feat: stuff\n 1 file changed, 5 insertions(+)',
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commitCount).toBe(1);
    });

    it('commitCount is omitted when no commits are detected', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'view', status: 'completed' }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commitCount).toBeUndefined();
    });

    it('commitCount deduplicates by short hash', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "feat: a"' },
                result: '[main abc1234] feat: a\n 1 file changed, 1 insertion(+)',
            }],
            ['t2', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit --amend' },
                result: '[main abc1234] feat: a\n 1 file changed, 1 insertion(+)',
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commitCount).toBe(1);
    });

    it('commitCount counts multiple distinct commits', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "feat: first"' },
                result: '[main abc1234] feat: first\n 1 file changed, 5 insertions(+)',
            }],
            ['t2', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "feat: second"' },
                result: '[main def5678] feat: second\n 2 files changed, 10 insertions(+)',
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commitCount).toBe(2);
    });

    it('commitCount includes commits from tools inside tool-group chunks', () => {
        const chunks = [
            {
                kind: 'tool-group', key: 'group-1', category: 'shell',
                toolIds: ['t1', 't2'],
                contentItems: [], orderedItems: [],
                startTime: 1000, endTime: 3000, allSucceeded: true,
            },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'powershell',
                status: 'completed',
                startTime: '2024-01-01T00:00:01Z',
                endTime: '2024-01-01T00:00:02Z',
                args: { command: 'git commit -m "feat: a"' },
                result: '[main aaa1111] feat: a\n 1 file changed, 1 insertion(+)',
            }],
            ['t2', {
                toolName: 'powershell',
                status: 'completed',
                startTime: '2024-01-01T00:00:02Z',
                endTime: '2024-01-01T00:00:03Z',
                args: { command: 'git commit -m "fix: b"' },
                result: '[main bbb2222] fix: b\n 1 file changed, 2 insertions(+)',
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commitCount).toBe(2);
    });

    it('fixupCommitCount separates fixup commits from regular commits', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'tool', key: 'k-t3', toolId: 't3' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "feat: add auth"' },
                result: '[main abc1111] feat: add auth\n 5 files changed, 42 insertions(+)',
            }],
            ['t2', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit --fixup abc1111' },
                result: '[main abc2222] fixup! feat: add auth\n 1 file changed, 1 insertion(+)',
            }],
            ['t3', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "docs: readme"' },
                result: '[main abc3333] docs: readme\n 1 file changed, 3 insertions(+)',
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commitCount).toBe(2);
        expect(wg.summary.fixupCommitCount).toBe(1);
    });

    it('fixupCommitCount is omitted when no fixup commits', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "feat: stuff"' },
                result: '[main abc1234] feat: stuff\n 1 file changed, 5 insertions(+)',
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commitCount).toBe(1);
        expect(wg.summary.fixupCommitCount).toBeUndefined();
    });

    it('only fixup commits → commitCount omitted, fixupCommitCount set', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit --fixup abc0000' },
                result: '[main fff1234] fixup! original msg\n 1 file changed, 1 insertion(+)',
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commitCount).toBeUndefined();
        expect(wg.summary.fixupCommitCount).toBe(1);
    });

    it('skillCount counts unique skill invocations', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'tool', key: 'k-t3', toolId: 't3' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'skill', status: 'completed', args: { skill: 'impl' } }],
            ['t2', { toolName: 'skill', status: 'completed', args: { skill: 'code-review' } }],
            ['t3', { toolName: 'skill', status: 'completed', args: { skill: 'impl' } }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.skillCount).toBe(2);
        expect(wg.summary.skillNames).toEqual(['code-review', 'impl']);
    });

    it('skillCount is omitted when no skill tool calls exist', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'view', status: 'completed' }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.skillCount).toBeUndefined();
        expect(wg.summary.skillNames).toBeUndefined();
    });

    it('skillCount works with args.name and args.skill_name variants', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'skill', status: 'completed', args: { name: 'draft' } }],
            ['t2', { toolName: 'skill', status: 'completed', args: { skill_name: 'test-gap-analysis' } }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.skillCount).toBe(2);
        expect(wg.summary.skillNames).toEqual(['draft', 'test-gap-analysis']);
    });

    it('skillCount from skills inside tool-group chunks', () => {
        const chunks = [
            {
                kind: 'tool-group', key: 'group-1', category: 'read',
                toolIds: ['t1', 't2'],
                contentItems: [], orderedItems: [],
                startTime: 1000, endTime: 3000, allSucceeded: true,
            },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'skill', status: 'completed', startTime: '2024-01-01T00:00:01Z', endTime: '2024-01-01T00:00:02Z', args: { skill: 'impl' } }],
            ['t2', { toolName: 'skill', status: 'completed', startTime: '2024-01-01T00:00:02Z', endTime: '2024-01-01T00:00:03Z', args: { skill: 'go-deep' } }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.skillCount).toBe(2);
        expect(wg.summary.skillNames).toEqual(['go-deep', 'impl']);
    });

    it('combined: commits, fixups, and skills in one summary', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'tool', key: 'k-t3', toolId: 't3' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "feat: auth"' },
                result: '[main aaa1111] feat: auth\n 3 files changed, 20 insertions(+)',
            }],
            ['t2', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit --fixup aaa1111' },
                result: '[main bbb2222] fixup! feat: auth\n 1 file changed, 1 insertion(+)',
            }],
            ['t3', { toolName: 'skill', status: 'completed', args: { skill: 'impl' } }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commitCount).toBe(1);
        expect(wg.summary.fixupCommitCount).toBe(1);
        expect(wg.summary.skillCount).toBe(1);
        expect(wg.summary.skillNames).toEqual(['impl']);
    });

    it('commits array contains full DetectedCommit objects for regular commits', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "feat: first"' },
                result: '[main abc1234] feat: first\n 1 file changed, 5 insertions(+)',
            }],
            ['t2', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "feat: second"' },
                result: '[main def5678] feat: second\n 2 files changed, 10 insertions(+)',
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commits).toHaveLength(2);
        expect(wg.summary.commits![0].shortHash).toBe('abc1234');
        expect(wg.summary.commits![0].subject).toBe('feat: first');
        expect(wg.summary.commits![1].shortHash).toBe('def5678');
        expect(wg.summary.commits![1].subject).toBe('feat: second');
    });

    it('fixupCommits array contains full DetectedCommit objects for fixup commits', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit -m "feat: auth"' },
                result: '[main aaa1111] feat: auth\n 3 files changed, 20 insertions(+)',
            }],
            ['t2', {
                toolName: 'powershell',
                status: 'completed',
                args: { command: 'git commit --fixup aaa1111' },
                result: '[main bbb2222] fixup! feat: auth\n 1 file changed, 1 insertion(+)',
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commits).toHaveLength(1);
        expect(wg.summary.commits![0].shortHash).toBe('aaa1111');
        expect(wg.summary.fixupCommits).toHaveLength(1);
        expect(wg.summary.fixupCommits![0].shortHash).toBe('bbb2222');
        expect(wg.summary.fixupCommits![0].isFixup).toBe(true);
    });

    it('commits and fixupCommits are omitted when no commits detected', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'view', status: 'completed' }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as WhisperGroupChunk;
        expect(wg.summary.commits).toBeUndefined();
        expect(wg.summary.fixupCommits).toBeUndefined();
    });
});
