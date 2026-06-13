/**
 * Tests for the read-only native Copilot CLI session-state parser.
 *
 * Fixtures are synthetic `events.jsonl` logs written to a temp directory whose
 * shapes mirror the real `~/.copilot/session-state/<id>/events.jsonl` schema.
 * These tests never read real local user data from ~/.copilot.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    parseNativeSessionState,
    reconstructTurns,
} from '../../src/server/native-copilot-sessions/session-state-parser';

// ── Fixture helpers ──────────────────────────────────────────────────────────

/** Build one `events.jsonl` line from a type + data payload. */
function event(type: string, data: unknown, timestamp = '2026-06-11T15:18:14.371Z'): string {
    return JSON.stringify({ type, id: `${type}-id`, parentId: null, timestamp, data });
}

/** A faithful multi-turn session log: user → assistant(text+thinking+tools). */
function richSessionJsonl(): string {
    return [
        event('session.start', { sessionId: 'fixture' }),
        event('system.message', { role: 'system', content: 'You are the GitHub Copilot CLI.' }),
        event('user.message', {
            content: "can you check the session-store.db see what's inside?",
            transformedContent: '<current_datetime>2026-06-11T15:18:14Z</current_datetime>\n\ncan you check...',
            attachments: [],
            interactionId: '53d9b218-74fa-4dd9-b58e-49d8aecd561d',
        }),
        event('assistant.message', {
            messageId: 'ab9b4456',
            model: 'gpt-5.5',
            content: "I'll inspect the SQLite database structure.",
            reasoningText: 'I need to read the schema before dumping any rows.',
            toolRequests: [
                { toolCallId: 'call_bash1', name: 'bash', arguments: { command: 'ls' }, type: 'function' },
            ],
            turnId: '0',
        }),
        event('tool.execution_start', {
            toolCallId: 'call_bash1',
            toolName: 'bash',
            arguments: { command: 'sqlite3 session-store.db .schema' },
            model: 'gpt-5.5',
            turnId: '0',
        }),
        event('tool.execution_complete', {
            toolCallId: 'call_bash1',
            model: 'gpt-5.5',
            success: true,
            result: { content: 'ok', detailedContent: 'sessions table: 1630 rows\nturns table: 2297 rows' },
            toolTelemetry: {},
        }),
        // A second model turn that runs a tool which fails.
        event('assistant.message', {
            messageId: 'cc12',
            model: 'gpt-5.5',
            content: 'Now editing the file.',
            turnId: '1',
        }),
        event('tool.execution_start', {
            toolCallId: 'call_edit1',
            toolName: 'edit',
            arguments: { path: 'a.ts', old_str: 'x', new_str: 'y' },
            turnId: '1',
        }),
        event('tool.execution_complete', {
            toolCallId: 'call_edit1',
            success: false,
            error: { message: 'No match found', code: 'failure' },
            toolTelemetry: {},
        }),
        event('skill.invoked', { name: 'impl', path: '/skills/impl/SKILL.md', source: 'user' }),
        event('session.shutdown', {}),
    ].join('\n');
}

describe('parseNativeSessionState', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-session-state-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeSession(sessionId: string, jsonl: string): void {
        const dir = path.join(tmpDir, sessionId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'events.jsonl'), jsonl);
    }

    it('reconstructs rich turns with a tool call carrying name, args, and result', () => {
        writeSession('sess-rich', richSessionJsonl());
        const turns = parseNativeSessionState('sess-rich', { sessionStateDir: tmpDir });

        expect(turns).not.toBeNull();
        const conversation = turns!;
        // user, assistant(turn 0), assistant(turn 1)
        expect(conversation).toHaveLength(3);

        const [user, assistant0, assistant1] = conversation;
        expect(user.role).toBe('user');
        expect(user.content).toBe("can you check the session-store.db see what's inside?");
        expect(user.turnIndex).toBe(0);

        // AC-01 DoD: ≥1 tool call with name + args + result.
        expect(assistant0.role).toBe('assistant');
        expect(assistant0.model).toBe('gpt-5.5');
        expect(assistant0.thinking).toContain('read the schema');
        const tool = assistant0.toolCalls ?? [];
        expect(tool).toHaveLength(1);
        expect(tool[0].toolName).toBe('bash');
        expect(tool[0].args).toEqual({ command: 'sqlite3 session-store.db .schema' });
        expect(tool[0].result).toContain('sessions table: 1630 rows');
        expect(tool[0].status).toBe('completed');

        // Timeline interleaves content + tool start/complete.
        expect(assistant0.timeline.map(t => t.type)).toEqual(['content', 'tool-start', 'tool-complete']);

        // Failed tool surfaces the error and a failed status.
        const failedTool = (assistant1.toolCalls ?? [])[0];
        expect(failedTool.toolName).toBe('edit');
        expect(failedTool.status).toBe('failed');
        expect(failedTool.error).toBe('No match found');
        expect(failedTool.result).toBeUndefined();
        expect(assistant1.timeline.map(t => t.type)).toEqual(['content', 'tool-start', 'tool-failed']);
        expect(assistant1.skillNames).toEqual(['impl']);
    });

    it('captures base64 image attachments on a user turn as data URLs', () => {
        const jsonl = event('user.message', {
            content: 'see this screenshot',
            attachments: [{ mimeType: 'image/png', data: 'iVBORw0KGgoAAAANS' }],
        });
        writeSession('sess-img', jsonl);
        const turns = parseNativeSessionState('sess-img', { sessionStateDir: tmpDir });
        expect(turns).not.toBeNull();
        expect(turns![0].images).toEqual(['data:image/png;base64,iVBORw0KGgoAAAANS']);
    });

    it('returns null when the session-state directory is missing', () => {
        expect(parseNativeSessionState('does-not-exist', { sessionStateDir: tmpDir })).toBeNull();
    });

    it('returns null when events.jsonl is entirely malformed', () => {
        writeSession('sess-bad', 'not json\n{also not\nbroken}');
        expect(parseNativeSessionState('sess-bad', { sessionStateDir: tmpDir })).toBeNull();
    });

    it('returns null for an empty events.jsonl', () => {
        writeSession('sess-empty', '');
        expect(parseNativeSessionState('sess-empty', { sessionStateDir: tmpDir })).toBeNull();
    });

    it('skips individual malformed lines but keeps usable turns', () => {
        const jsonl = [
            'this line is corrupt',
            event('user.message', { content: 'hello' }),
            '{ broken json',
        ].join('\n');
        writeSession('sess-partial', jsonl);
        const turns = parseNativeSessionState('sess-partial', { sessionStateDir: tmpDir });
        expect(turns).not.toBeNull();
        expect(turns).toHaveLength(1);
        expect(turns![0].content).toBe('hello');
    });

    it('rejects unsafe session ids (path traversal) without reading the filesystem', () => {
        expect(parseNativeSessionState('../escape', { sessionStateDir: tmpDir })).toBeNull();
        expect(parseNativeSessionState('a/b', { sessionStateDir: tmpDir })).toBeNull();
        expect(parseNativeSessionState('', { sessionStateDir: tmpDir })).toBeNull();
    });
});

describe('reconstructTurns', () => {
    it('synthesizes an assistant turn when a tool runs before any message', () => {
        const jsonl = [
            event('tool.execution_start', { toolCallId: 'c1', toolName: 'bash', arguments: { command: 'ls' } }),
            event('tool.execution_complete', { toolCallId: 'c1', success: true, result: { content: 'done' } }),
        ].join('\n');
        const turns = reconstructTurns(jsonl);
        expect(turns).not.toBeNull();
        expect(turns).toHaveLength(1);
        expect(turns![0].role).toBe('assistant');
        expect(turns![0].toolCalls?.[0].result).toBe('done');
    });

    it('coalesces consecutive assistant messages sharing a turnId', () => {
        const jsonl = [
            event('assistant.message', { content: 'part one', model: 'gpt-5.5', turnId: '0' }),
            event('assistant.message', { content: 'part two', turnId: '0' }),
        ].join('\n');
        const turns = reconstructTurns(jsonl);
        expect(turns).toHaveLength(1);
        expect(turns![0].content).toBe('part one\n\npart two');
    });
});
