/**
 * @vitest-environment jsdom
 *
 * Unit tests for scratchpadUtils — extractLastWrittenNotePath.
 */
import { describe, it, expect } from 'vitest';
import type { ClientConversationTurn, ClientToolCall, ClientTimelineItem } from '../../../../src/server/spa/client/react/types/dashboard';
import { extractLastWrittenNotePath } from '../../../../src/server/spa/client/react/features/chat/scratchpad/scratchpadUtils';

function makeTurn(
    role: 'user' | 'assistant',
    overrides: Partial<ClientConversationTurn> = {},
): ClientConversationTurn {
    return {
        role,
        content: '',
        timeline: [],
        ...overrides,
    };
}

function makeToolCall(toolName: string, args: unknown): ClientToolCall {
    return {
        id: `tc-${Math.random().toString(36).slice(2)}`,
        toolName,
        args,
        status: 'completed',
    };
}

function makeTimelineItem(tc: ClientToolCall): ClientTimelineItem {
    return {
        type: 'tool-complete',
        timestamp: new Date().toISOString(),
        toolCall: tc,
    };
}

describe('extractLastWrittenNotePath', () => {
    it('returns null for empty turns array', () => {
        expect(extractLastWrittenNotePath([])).toBeNull();
    });

    it('returns null when assistant turn has no timeline or toolCalls', () => {
        const turns = [makeTurn('assistant')];
        expect(extractLastWrittenNotePath(turns)).toBeNull();
    });

    it('returns path for edit_file tool call with .md path', () => {
        const tc = makeToolCall('edit_file', { path: 'notes.md' });
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBe('notes.md');
    });

    it('returns null for edit_file tool call with non-.md path', () => {
        const tc = makeToolCall('edit_file', { path: 'src/main.ts' });
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBeNull();
    });

    it('returns path for str_replace_based_edit_tool with target_file', () => {
        const tc = makeToolCall('str_replace_based_edit_tool', { target_file: 'plan.md' });
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBe('plan.md');
    });

    it('returns path for str_replace_editor with file_path', () => {
        const tc = makeToolCall('str_replace_editor', { file_path: 'notes.md' });
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBe('notes.md');
    });

    it('parses args from a JSON string', () => {
        const tc = makeToolCall('edit_file', '{"path":"notes.md"}');
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBe('notes.md');
    });

    it('only checks the last assistant turn — ignores earlier .md writes', () => {
        const earlier = makeTurn('assistant', {
            toolCalls: [makeToolCall('edit_file', { path: 'old.md' })],
        });
        const later = makeTurn('assistant', {
            toolCalls: [makeToolCall('edit_file', { path: 'src/index.ts' })],
        });
        expect(extractLastWrittenNotePath([earlier, later])).toBeNull();
    });

    it('prefers timeline tool calls over toolCalls', () => {
        const tcTimeline = makeToolCall('edit_file', { path: 'from-timeline.md' });
        const tcFallback = makeToolCall('edit_file', { path: 'from-toolcalls.md' });
        const turn = makeTurn('assistant', {
            timeline: [makeTimelineItem(tcTimeline)],
            toolCalls: [tcFallback],
        });
        expect(extractLastWrittenNotePath([turn])).toBe('from-timeline.md');
    });

    it('returns null when only user turns exist', () => {
        const turns = [makeTurn('user'), makeTurn('user')];
        expect(extractLastWrittenNotePath(turns)).toBeNull();
    });

    it('returns path for create tool call', () => {
        const tc = makeToolCall('create', { path: 'new-doc.md' });
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBe('new-doc.md');
    });

    it('returns path for apply_patch tool call', () => {
        const tc = makeToolCall('apply_patch', { path: 'patched.md' });
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBe('patched.md');
    });

    it('returns path via filename fallback', () => {
        const tc = makeToolCall('edit_file', { filename: 'fallback.md' });
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBe('fallback.md');
    });

    it('ignores tool calls with unrecognized tool names', () => {
        const tc = makeToolCall('read_file', { path: 'ignored.md' });
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBeNull();
    });

    it('returns null when args is null', () => {
        const tc = makeToolCall('edit_file', null);
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBeNull();
    });

    it('returns null when args JSON string is malformed', () => {
        const tc = makeToolCall('edit_file', '{bad json}');
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBeNull();
    });

    it('skips trailing user turn and checks prior assistant turn', () => {
        const assistantTurn = makeTurn('assistant', {
            toolCalls: [makeToolCall('edit_file', { path: 'notes.md' })],
        });
        const userTurn = makeTurn('user');
        // The function skips user turns and finds the last assistant turn
        expect(extractLastWrittenNotePath([assistantTurn, userTurn])).toBe('notes.md');
    });

    it('uses toolName from the name field when toolName is missing', () => {
        const tc: any = {
            id: 'tc-1',
            name: 'edit_file',
            args: { path: 'via-name.md' },
            status: 'completed',
        };
        delete tc.toolName;
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBe('via-name.md');
    });
});
