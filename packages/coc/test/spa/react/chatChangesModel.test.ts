/**
 * Tests for chatChangesModel — deriving the whole-chat diff context that gates
 * the unified panel's "Changes" entry (AC-01).
 *
 * Covers the DoD cases: no chat / no edits, pending and failed edits, a
 * completed edit, edits spread over several turns, repeated edits and a later
 * reversion, a file whose diff text cannot be rebuilt, deletion records, and the
 * two identity rules — one tool appearing in both `toolCalls` and `timeline` is
 * replayed once, while the same id reused in a different turn stays distinct.
 *
 * Fixtures are cross-platform: every case that carries a path has a Linux/macOS
 * form and a Windows form, including a chat that records the same file both
 * ways.
 */
import { describe, it, expect } from 'vitest';
import {
    buildChatChangesContext,
    chatHasChanges,
    collectChatToolRecords,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/chatChangesModel';
import type {
    ClientConversationTurn,
    ClientToolCall,
} from '../../../src/server/spa/client/react/types/dashboard';

const SOURCE = { ownerWorkspaceId: 'repo-a', chatId: 'chat-1' };

function call(over: Partial<ClientToolCall> & { toolName: string }): ClientToolCall {
    return { id: 't1', args: {}, status: 'completed', ...over } as ClientToolCall;
}

function turn(calls: ClientToolCall[], inTimeline = false): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        toolCalls: calls,
        timeline: inTimeline
            ? calls.map(c => ({ type: 'tool-complete' as const, timestamp: '', toolCall: c }))
            : [],
    };
}

function editCall(id: string, path: string, oldStr: string, newStr: string, status = 'completed'): ClientToolCall {
    return call({ id, toolName: 'edit', status: status as ClientToolCall['status'], args: { path, old_str: oldStr, new_str: newStr } });
}

describe('buildChatChangesContext', () => {
    it('returns null with no turns at all', () => {
        expect(buildChatChangesContext(null, SOURCE)).toBeNull();
        expect(buildChatChangesContext(undefined, SOURCE)).toBeNull();
        expect(buildChatChangesContext([], SOURCE)).toBeNull();
    });

    it('returns null for a chat that only read and ran commands', () => {
        const turns = [turn([
            call({ id: 'a', toolName: 'view', args: { path: 'src/a.ts' } }),
            call({ id: 'b', toolName: 'bash', args: { command: 'npm test' } }),
        ])];
        expect(buildChatChangesContext(turns, SOURCE)).toBeNull();
        expect(chatHasChanges(turns, SOURCE)).toBe(false);
    });

    it('ignores pending, running and failed edits', () => {
        for (const status of ['pending', 'running', 'failed']) {
            const turns = [turn([editCall('a', 'src/a.ts', 'one', 'two', status)])];
            expect(chatHasChanges(turns, SOURCE)).toBe(false);
        }
    });

    it('reports a completed edit, tagged with the owning clone', () => {
        const turns = [turn([editCall('a', 'src/a.ts', 'one', 'two')])];
        const ctx = buildChatChangesContext(turns, SOURCE);
        expect(ctx?.files.map(f => f.path)).toEqual(['src/a.ts']);
        expect(ctx?.workspaceId).toBe('repo-a');
        expect(ctx?.commits).toEqual([]);
        expect(chatHasChanges(turns, SOURCE)).toBe(true);
    });

    it('counts a record with no status — restored history carries none', () => {
        const untyped = { id: 'a', toolName: 'create', args: { path: 'src/new.ts', file_text: 'hi\n' } } as ClientToolCall;
        expect(chatHasChanges([turn([untyped])], SOURCE)).toBe(true);
    });

    it('includes files from every turn of the chat', () => {
        const turns = [
            turn([editCall('a', 'src/a.ts', 'one', 'two')]),
            { role: 'user' as const, content: 'now b', timeline: [] },
            turn([editCall('b', 'src/b.ts', 'three', 'four')]),
        ];
        const ctx = buildChatChangesContext(turns, SOURCE);
        expect(ctx?.files.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('keeps repeated edits and a later reversion as chronological steps on one file', () => {
        const turns = [
            turn([editCall('a', 'src/a.ts', 'one', 'two')]),
            turn([editCall('b', 'src/a.ts', 'two', 'three')]),
            turn([editCall('c', 'src/a.ts', 'three', 'one')]),
        ];
        const ctx = buildChatChangesContext(turns, SOURCE);
        expect(ctx?.files).toHaveLength(1);
        expect(ctx?.toolCalls).toHaveLength(3);
        expect(ctx?.toolCalls.map(t => (t.args as { new_str: string }).new_str)).toEqual(['two', 'three', 'one']);
    });

    it('still reports a file whose diff text cannot be rebuilt', () => {
        // A Codex-style structured change: a path and a kind, no line content.
        const turns = [turn([call({
            id: 'a',
            toolName: 'apply_patch',
            args: { changes: [{ path: 'src/opaque.ts', kind: 'update' }] },
        })])];
        const ctx = buildChatChangesContext(turns, SOURCE);
        expect(ctx?.files.map(f => f.path)).toContain('src/opaque.ts');
    });

    it('reports a completed edit recorded with a Windows path form', () => {
        const turns = [turn([editCall('a', 'src\\a.ts', 'one', 'two')])];
        const ctx = buildChatChangesContext(turns, SOURCE);
        // The path is canonicalized to forward slashes, which is the form every
        // downstream matcher (diff reconstruction, deletion detection) uses.
        expect(ctx?.files.map(f => f.path)).toEqual(['src/a.ts']);
        // The raw tool args are handed through untouched — reconstruction
        // normalizes both sides itself.
        expect((ctx?.toolCalls[0].args as { path: string }).path).toBe('src\\a.ts');
        expect(chatHasChanges(turns, SOURCE)).toBe(true);
    });

    it('reports a create recorded with a Windows path form', () => {
        const turns = [turn([call({
            id: 'a',
            toolName: 'create',
            args: { path: 'src\\win\\new.ts', file_text: 'hi\n' },
        })])];
        const ctx = buildChatChangesContext(turns, SOURCE);
        expect(ctx?.files.map(f => f.path)).toEqual(['src/win/new.ts']);
        expect(ctx?.files[0].isCreate).toBe(true);
    });

    it('keeps one file one file when a chat records both path forms', () => {
        // A chat can genuinely see both: a Windows-native tool reports
        // `src\a.ts`, a later repo-relative one reports `src/a.ts`. They are the
        // same file, so they collapse into a single entry whose stats add up.
        const turns = [
            turn([editCall('a', 'src\\a.ts', 'one', 'two')]),
            turn([editCall('b', 'src/a.ts', 'two', 'three')]),
        ];
        const ctx = buildChatChangesContext(turns, SOURCE);
        expect(ctx?.files.map(f => f.path)).toEqual(['src/a.ts']);
        expect(ctx?.toolCalls).toHaveLength(2);
        expect(ctx?.files[0].netInsertions).toBe(2);
    });

    it('marks a file a later shell command removed as deleted', () => {
        const turns = [
            turn([call({ id: 'a', toolName: 'create', args: { path: 'src/tmp.ts', file_text: 'x\n' } })]),
            turn([call({ id: 'b', toolName: 'bash', args: { command: 'rm src/tmp.ts' } })]),
        ];
        const ctx = buildChatChangesContext(turns, SOURCE);
        expect(ctx?.files.find(f => f.path === 'src/tmp.ts')?.isDeleted).toBe(true);
    });

    it('marks a Windows-path file removed by Remove-Item as deleted', () => {
        const turns = [
            turn([call({ id: 'a', toolName: 'create', args: { path: 'src\\tmp.ts', file_text: 'x\n' } })]),
            turn([call({ id: 'b', toolName: 'powershell', args: { command: 'Remove-Item -Force src\\tmp.ts' } })]),
        ];
        const ctx = buildChatChangesContext(turns, SOURCE);
        expect(ctx?.files.map(f => f.path)).toEqual(['src/tmp.ts']);
        expect(ctx?.files[0].isDeleted).toBe(true);
    });

    it('marks a Windows-path file removed by del as deleted', () => {
        const turns = [
            turn([call({ id: 'a', toolName: 'create', args: { path: 'src\\tmp.ts', file_text: 'x\n' } })]),
            turn([call({ id: 'b', toolName: 'shell', args: { command: 'del /f src\\tmp.ts' } })]),
        ];
        expect(buildChatChangesContext(turns, SOURCE)?.files[0].isDeleted).toBe(true);
    });

    it('matches a Windows delete command against a POSIX-recorded file, and back', () => {
        // The two forms cross: the file is tracked as POSIX and deleted with a
        // backslash path, or tracked with a backslash path and deleted as POSIX.
        const crossed = [
            turn([call({ id: 'a', toolName: 'create', args: { path: 'src/tmp.ts', file_text: 'x\n' } })]),
            turn([call({ id: 'b', toolName: 'powershell', args: { command: 'Remove-Item src\\tmp.ts' } })]),
        ];
        expect(buildChatChangesContext(crossed, SOURCE)?.files[0].isDeleted).toBe(true);

        const reversed = [
            turn([call({ id: 'a', toolName: 'create', args: { path: 'src\\tmp.ts', file_text: 'x\n' } })]),
            turn([call({ id: 'b', toolName: 'bash', args: { command: 'rm -f src/tmp.ts' } })]),
        ];
        expect(buildChatChangesContext(reversed, SOURCE)?.files[0].isDeleted).toBe(true);
    });
});

describe('collectChatToolRecords', () => {
    it('counts one tool appearing in both toolCalls and timeline once', () => {
        const records = collectChatToolRecords([turn([editCall('a', 'src/a.ts', 'one', 'two')], true)]);
        expect(records).toHaveLength(1);
    });

    it('keeps a reused tool id in a different turn as a distinct edit', () => {
        const turns = [
            turn([editCall('dup', 'src/a.ts', 'one', 'two')]),
            turn([editCall('dup', 'src/a.ts', 'two', 'three')]),
        ];
        expect(collectChatToolRecords(turns)).toHaveLength(2);
        expect(buildChatChangesContext(turns, SOURCE)?.toolCalls).toHaveLength(2);
    });

    it('takes an id-less record from toolCalls only, so the timeline copy cannot double it', () => {
        const anonymous = { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'one', new_str: 'two' }, status: 'completed' } as ClientToolCall;
        const records = collectChatToolRecords([turn([anonymous], true)]);
        expect(records).toHaveLength(1);
    });

    it('preserves turn order, then timeline order within a turn', () => {
        const first = turn([editCall('a', 'src/a.ts', 'one', 'two')]);
        const second = turn([editCall('b', 'src/b.ts', 'x', 'y'), editCall('c', 'src/c.ts', 'x', 'y')]);
        expect(collectChatToolRecords([first, second]).map(r => r.id)).toEqual(['a', 'b', 'c']);
    });
});
