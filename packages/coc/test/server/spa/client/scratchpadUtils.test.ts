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
        // The last assistant turn has no .md write, so we fall back to the earlier turn
        expect(extractLastWrittenNotePath([earlier, later])).toBe('old.md');
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

    it('returns path for write_file tool call', () => {
        const tc = makeToolCall('write_file', { path: 'written.md' });
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBe('written.md');
    });

    it('returns path for create_file tool call', () => {
        const tc = makeToolCall('create_file', { path: 'created.md' });
        const turns = [makeTurn('assistant', { toolCalls: [tc] })];
        expect(extractLastWrittenNotePath(turns)).toBe('created.md');
    });

    it('finds .md path written in an earlier turn when the last assistant turn has no .md write', () => {
        const earlier = makeTurn('assistant', {
            toolCalls: [makeToolCall('edit_file', { path: 'earlier-notes.md' })],
        });
        const laterNoMd = makeTurn('assistant', {
            toolCalls: [makeToolCall('edit_file', { path: 'src/util.ts' })],
        });
        expect(extractLastWrittenNotePath([earlier, laterNoMd])).toBe('earlier-notes.md');
    });

    it('returns the most recent .md path across multiple turns with .md writes', () => {
        const turn1 = makeTurn('assistant', {
            toolCalls: [makeToolCall('edit_file', { path: 'first.md' })],
        });
        const turn2 = makeTurn('assistant', {
            toolCalls: [makeToolCall('edit_file', { path: 'second.md' })],
        });
        // turn2 is examined first (newest); its .md path wins
        expect(extractLastWrittenNotePath([turn1, turn2])).toBe('second.md');
    });

    it('still returns null when no assistant turn across all turns has a .md write', () => {
        const t1 = makeTurn('assistant', { toolCalls: [makeToolCall('edit_file', { path: 'a.ts' })] });
        const t2 = makeTurn('assistant', { toolCalls: [makeToolCall('create', { path: 'b.json' })] });
        expect(extractLastWrittenNotePath([t1, t2])).toBeNull();
    });

    // Claude Code emits PascalCase tool names (Write/Edit/MultiEdit) with a
    // `file_path` arg. These must normalize to canonical create/edit so the
    // scratchpad auto-opens for Claude sessions too.
    describe('Claude Code tool names (Write / Edit / MultiEdit, file_path arg)', () => {
        it('returns path for a Write tool call with file_path', () => {
            const tc = makeToolCall('Write', { file_path: 'claude-write.md' });
            const turns = [makeTurn('assistant', { toolCalls: [tc] })];
            expect(extractLastWrittenNotePath(turns)).toBe('claude-write.md');
        });

        it('returns path for an Edit tool call with file_path', () => {
            const tc = makeToolCall('Edit', { file_path: 'claude-edit.md' });
            const turns = [makeTurn('assistant', { toolCalls: [tc] })];
            expect(extractLastWrittenNotePath(turns)).toBe('claude-edit.md');
        });

        it('returns path for a MultiEdit tool call with file_path', () => {
            const tc = makeToolCall('MultiEdit', { file_path: 'claude-multiedit.md' });
            const turns = [makeTurn('assistant', { toolCalls: [tc] })];
            expect(extractLastWrittenNotePath(turns)).toBe('claude-multiedit.md');
        });

        it('returns path for a Write call from the name field (persisted shape)', () => {
            const tc: any = {
                id: 'tc-write',
                name: 'Write',
                args: { file_path: 'via-name.md' },
                status: 'completed',
            };
            delete tc.toolName;
            const turns = [makeTurn('assistant', { toolCalls: [tc] })];
            expect(extractLastWrittenNotePath(turns)).toBe('via-name.md');
        });

        it('still ignores the Read tool (normalizes to a non-write tool)', () => {
            const tc = makeToolCall('Read', { file_path: 'read-only.md' });
            const turns = [makeTurn('assistant', { toolCalls: [tc] })];
            expect(extractLastWrittenNotePath(turns)).toBeNull();
        });
    });
});
