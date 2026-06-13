import { describe, expect, it } from 'vitest';
import {
    parseClaudeTranscript,
    parseCodexRollout,
} from '../../src/server/native-copilot-sessions/cli-session-parsers';

function line(value: unknown): string {
    return JSON.stringify(value);
}

describe('parseClaudeTranscript', () => {
    it('reconstructs user, assistant, thinking, image, and completed tool turns', () => {
        const raw = [
            line({
                type: 'user',
                timestamp: '2026-06-13T10:00:00.000Z',
                sessionId: 'claude-session',
                cwd: '/repo',
                gitBranch: 'main',
                message: {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Inspect this screenshot' },
                        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
                    ],
                },
            }),
            line({
                type: 'assistant',
                timestamp: '2026-06-13T10:00:01.000Z',
                sessionId: 'claude-session',
                cwd: '/repo',
                message: {
                    role: 'assistant',
                    model: 'claude-sonnet-4-6',
                    content: [
                        { type: 'thinking', thinking: 'Need to inspect files first.' },
                        { type: 'text', text: 'I will check the repository.' },
                        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
                    ],
                },
            }),
            line({
                type: 'user',
                timestamp: '2026-06-13T10:00:02.000Z',
                sessionId: 'claude-session',
                cwd: '/repo',
                message: {
                    role: 'user',
                    content: [
                        { type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'package.json' }] },
                    ],
                },
            }),
        ].join('\n');

        const turns = parseClaudeTranscript(raw);

        expect(turns).not.toBeNull();
        expect(turns).toHaveLength(2);
        expect(turns![0]).toMatchObject({
            role: 'user',
            content: 'Inspect this screenshot',
            images: ['data:image/png;base64,abc123'],
            turnIndex: 0,
        });
        expect(turns![1].role).toBe('assistant');
        expect(turns![1].model).toBe('claude-sonnet-4-6');
        expect(turns![1].thinking).toContain('inspect files');
        expect(turns![1].content).toBe('I will check the repository.');
        expect(turns![1].toolCalls?.[0]).toMatchObject({
            id: 'tool-1',
            toolName: 'Bash',
            args: { command: 'ls' },
            result: 'package.json',
            status: 'completed',
        });
        expect(turns![1].timeline.map(item => item.type)).toEqual(['content', 'tool-start', 'tool-complete']);
    });

    it('marks correlated tool_result errors as failed', () => {
        const raw = [
            line({
                type: 'assistant',
                timestamp: '2026-06-13T10:00:01.000Z',
                message: {
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: 'tool-err', name: 'Read', input: { file_path: 'missing' } }],
                },
            }),
            line({
                type: 'user',
                timestamp: '2026-06-13T10:00:02.000Z',
                message: {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'tool-err', is_error: true, content: 'not found' }],
                },
            }),
        ].join('\n');

        const turns = parseClaudeTranscript(raw);

        expect(turns).not.toBeNull();
        expect(turns![0].toolCalls?.[0]).toMatchObject({
            status: 'failed',
            error: 'not found',
        });
        expect(turns![0].timeline.map(item => item.type)).toEqual(['tool-start', 'tool-failed']);
    });

    it('skips malformed and missing-correlation lines while preserving partial content', () => {
        const raw = [
            '{bad json',
            line({
                type: 'user',
                timestamp: '2026-06-13T10:00:00.000Z',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'late' }] },
            }),
            line({
                type: 'assistant',
                timestamp: '2026-06-13T10:00:01.000Z',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Still usable.' }] },
            }),
        ].join('\n');

        const turns = parseClaudeTranscript(raw);

        expect(turns).not.toBeNull();
        expect(turns).toHaveLength(1);
        expect(turns![0].content).toBe('Still usable.');
        expect(turns![0].toolCalls).toBeUndefined();
    });

    it('returns null for logs without usable turns', () => {
        expect(parseClaudeTranscript('not-json\n{"type":"summary","sessionId":"s"}')).toBeNull();
    });
});

describe('parseCodexRollout', () => {
    it('reconstructs user, assistant, reasoning, and completed tool turns', () => {
        const raw = [
            line({
                timestamp: '2026-06-13T11:00:00.000Z',
                type: 'session_meta',
                payload: { id: 'codex-session', cwd: '/repo', timestamp: '2026-06-13T11:00:00.000Z' },
            }),
            line({
                timestamp: '2026-06-13T11:00:01.000Z',
                type: 'turn_context',
                payload: { turn_id: '0', cwd: '/repo', model: 'gpt-5.1-codex' },
            }),
            line({
                timestamp: '2026-06-13T11:00:02.000Z',
                type: 'response_item',
                payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Please inspect' }] },
            }),
            line({
                timestamp: '2026-06-13T11:00:03.000Z',
                type: 'response_item',
                payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Need shell output.' }] },
            }),
            line({
                timestamp: '2026-06-13T11:00:04.000Z',
                type: 'response_item',
                payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I will run ls.' }] },
            }),
            line({
                timestamp: '2026-06-13T11:00:05.000Z',
                type: 'response_item',
                payload: { type: 'function_call', call_id: 'call-1', name: 'shell', arguments: '{"cmd":"ls"}' },
            }),
            line({
                timestamp: '2026-06-13T11:00:06.000Z',
                type: 'response_item',
                payload: { type: 'function_call_output', call_id: 'call-1', output: 'src' },
            }),
        ].join('\n');

        const turns = parseCodexRollout(raw);

        expect(turns).not.toBeNull();
        expect(turns).toHaveLength(3);
        expect(turns![0]).toMatchObject({ role: 'user', content: 'Please inspect', turnIndex: 0 });
        expect(turns![1]).toMatchObject({ role: 'assistant', thinking: 'Need shell output.', model: 'gpt-5.1-codex' });
        expect(turns![2].content).toBe('I will run ls.');
        expect(turns![2].toolCalls?.[0]).toMatchObject({
            id: 'call-1',
            toolName: 'shell',
            args: { cmd: 'ls' },
            result: 'src',
            status: 'completed',
        });
        expect(turns![2].timeline.map(item => item.type)).toEqual(['content', 'tool-start', 'tool-complete']);
    });

    it('captures base64 user images when Codex stores image blocks inline', () => {
        const raw = line({
            timestamp: '2026-06-13T11:00:02.000Z',
            type: 'response_item',
            payload: {
                type: 'message',
                role: 'user',
                content: [
                    { type: 'input_text', text: 'see this' },
                    { type: 'input_image', source: { media_type: 'image/jpeg', data: 'xyz' } },
                ],
            },
        });

        const turns = parseCodexRollout(raw);

        expect(turns).not.toBeNull();
        expect(turns![0].images).toEqual(['data:image/jpeg;base64,xyz']);
    });

    it('captures Codex user_message event image metadata without duplicating the user turn', () => {
        const raw = [
            line({
                timestamp: '2026-06-13T11:00:02.000Z',
                type: 'response_item',
                payload: {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: 'inspect this screenshot' }],
                },
            }),
            line({
                timestamp: '2026-06-13T11:00:02.100Z',
                type: 'event_msg',
                payload: {
                    type: 'user_message',
                    message: 'inspect this screenshot',
                    images: ['data:image/png;base64,abc'],
                    local_images: ['/tmp/codex-attach/image.png'],
                    text_elements: [],
                },
            }),
        ].join('\n');

        const turns = parseCodexRollout(raw);

        expect(turns).not.toBeNull();
        expect(turns).toHaveLength(1);
        expect(turns![0].images).toEqual(['data:image/png;base64,abc']);
        expect(turns![0].content).toContain('inspect this screenshot');
        expect(turns![0].content).toContain('Attached local image: `/tmp/codex-attach/image.png`');
    });

    it('marks failed function_call_output records as failed', () => {
        const raw = [
            line({
                timestamp: '2026-06-13T11:00:05.000Z',
                type: 'response_item',
                payload: { type: 'function_call', call_id: 'call-fail', name: 'apply_patch', arguments: { patch: 'x' } },
            }),
            line({
                timestamp: '2026-06-13T11:00:06.000Z',
                type: 'response_item',
                payload: { type: 'function_call_output', call_id: 'call-fail', output: 'no match', status: 'failed' },
            }),
        ].join('\n');

        const turns = parseCodexRollout(raw);

        expect(turns).not.toBeNull();
        expect(turns![0].toolCalls?.[0]).toMatchObject({
            status: 'failed',
            error: 'no match',
        });
        expect(turns![0].timeline.map(item => item.type)).toEqual(['tool-start', 'tool-failed']);
    });

    it('skips malformed and missing-correlation lines while preserving partial content', () => {
        const raw = [
            'not-json',
            line({
                timestamp: '2026-06-13T11:00:06.000Z',
                type: 'response_item',
                payload: { type: 'function_call_output', call_id: 'missing', output: 'late' },
            }),
            line({
                timestamp: '2026-06-13T11:00:07.000Z',
                type: 'response_item',
                payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Recovered.' }] },
            }),
        ].join('\n');

        const turns = parseCodexRollout(raw);

        expect(turns).not.toBeNull();
        expect(turns).toHaveLength(1);
        expect(turns![0].content).toBe('Recovered.');
        expect(turns![0].toolCalls).toBeUndefined();
    });

    it('returns null for logs without usable response items', () => {
        expect(parseCodexRollout('bad\n{"type":"session_meta","payload":{"id":"s"}}')).toBeNull();
    });
});
