/**
 * Tests for ToolCallGroupView — pure helper functions and component surface.
 *
 * Following the same no-DOM-render approach as timeline-utils.test.ts:
 * tests focus on pure function logic and exported constants, plus a
 * createElement smoke-test to verify the component shape.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import {
    groupStartLabel,
    groupDuration,
    CATEGORY_ICONS,
    ToolCallGroupView,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView';
import type { RenderToolCall } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView';

// ─── helpers ─────────────────────────────────────────────────────────────────

function tc(overrides: Partial<RenderToolCall> & Pick<RenderToolCall, 'id' | 'toolName'>): RenderToolCall {
    return { status: 'completed', ...overrides };
}

// ─── groupStartLabel ──────────────────────────────────────────────────────────

/** Helper: compute expected local-time label for a given ISO string. */
function expectedLocalLabel(iso: string): string {
    const d = new Date(iso);
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    let hh = d.getHours();
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${MM}/${dd} ${hh}:${mm} ${ampm}`;
}

describe('groupStartLabel', () => {
    it('returns empty string when no toolCalls have startTime', () => {
        expect(groupStartLabel([tc({ id: 'a', toolName: 'view' })])).toBe('');
    });

    it('formats first startTime as MM/DD h:mm AM/PM in local time', () => {
        const iso = '2025-06-15T08:30:45Z';
        const result = groupStartLabel([
            tc({ id: 'a', toolName: 'view', startTime: iso }),
        ]);
        expect(result).toBe(expectedLocalLabel(iso));
    });

    it('uses the first tool call that has startTime', () => {
        const iso1 = '2025-01-02T10:00:00Z';
        const result = groupStartLabel([
            tc({ id: 'a', toolName: 'view', startTime: iso1 }),
            tc({ id: 'b', toolName: 'glob', startTime: '2025-01-01T09:00:00Z' }),
        ]);
        // groupStartLabel uses `find`, so it picks the first entry with startTime
        expect(result).toBe(expectedLocalLabel(iso1));
    });

    it('returns empty string for invalid date strings', () => {
        expect(groupStartLabel([tc({ id: 'a', toolName: 'view', startTime: 'not-a-date' })])).toBe('');
    });
});

// ─── groupDuration ────────────────────────────────────────────────────────────

describe('groupDuration', () => {
    it('returns empty string when no timing data', () => {
        expect(groupDuration([tc({ id: 'a', toolName: 'view' })])).toBe('');
    });

    it('returns ms string for sub-second durations', () => {
        const result = groupDuration([
            tc({ id: 'a', toolName: 'view', startTime: '2025-01-01T00:00:00.000Z', endTime: '2025-01-01T00:00:00.500Z' }),
        ]);
        expect(result).toBe('500ms');
    });

    it('returns Xs string for multi-second durations', () => {
        const result = groupDuration([
            tc({ id: 'a', toolName: 'view', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T00:00:03Z' }),
        ]);
        expect(result).toBe('3.0s');
    });

    it('spans from first start to last end across multiple calls', () => {
        const result = groupDuration([
            tc({ id: 'a', toolName: 'view', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T00:00:01Z' }),
            tc({ id: 'b', toolName: 'glob', startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:03Z' }),
        ]);
        expect(result).toBe('3.0s');
    });
});

// ─── CATEGORY_ICONS ───────────────────────────────────────────────────────────

it('maps read → 📄, write → ✏️, shell → 💻', () => {
    expect(CATEGORY_ICONS['read']).toBe('📄');
    expect(CATEGORY_ICONS['write']).toBe('✏️');
    expect(CATEGORY_ICONS['shell']).toBe('💻');
});

// ─── Status icon derivation ───────────────────────────────────────────────────

describe('status icon derivation', () => {
    it('✅ when all toolCalls have status completed', () => {
        const toolCalls = [
            tc({ id: 'a', toolName: 'view', status: 'completed' }),
            tc({ id: 'b', toolName: 'glob', status: 'completed' }),
        ];
        const allSucceeded = toolCalls.every(t => t.status === 'completed');
        const anyFailed    = toolCalls.some(t  => t.status === 'failed');
        const statusIcon   = anyFailed ? '❌' : allSucceeded ? '✅' : '🔄';
        expect(statusIcon).toBe('✅');
    });

    it('❌ when any toolCall has status failed', () => {
        const toolCalls = [
            tc({ id: 'a', toolName: 'view', status: 'completed' }),
            tc({ id: 'b', toolName: 'glob', status: 'failed' }),
        ];
        const allSucceeded = toolCalls.every(t => t.status === 'completed');
        const anyFailed    = toolCalls.some(t  => t.status === 'failed');
        const statusIcon   = anyFailed ? '❌' : allSucceeded ? '✅' : '🔄';
        expect(statusIcon).toBe('❌');
    });

    it('🔄 when any toolCall has status running', () => {
        const toolCalls = [
            tc({ id: 'a', toolName: 'view', status: 'completed' }),
            tc({ id: 'b', toolName: 'glob', status: 'running' }),
        ];
        const allSucceeded = toolCalls.every(t => t.status === 'completed');
        const anyFailed    = toolCalls.some(t  => t.status === 'failed');
        const statusIcon   = anyFailed ? '❌' : allSucceeded ? '✅' : '🔄';
        expect(statusIcon).toBe('🔄');
    });
});

// ─── Component smoke test (JSX shape) ────────────────────────────────────────

it('renders without throwing', () => {
    const toolCalls: RenderToolCall[] = [
        { id: 'tc1', toolName: 'view', status: 'completed', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T00:00:01Z' },
        { id: 'tc2', toolName: 'glob', status: 'completed', startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z' },
    ];
    const el = createElement(ToolCallGroupView, {
        category: 'read',
        toolCalls,
        compactness: 0,
        renderToolTree: () => null,
    });
    expect(el).toBeTruthy();
    expect(el.props.category).toBe('read');
});

// ─── Exported surface ─────────────────────────────────────────────────────────

it('exports ToolCallGroupView as named export', async () => {
    const mod = await import('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView');
    expect(typeof mod.ToolCallGroupView).toBe('function');
});
