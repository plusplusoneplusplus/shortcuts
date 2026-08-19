/**
 * The per-provider parser modules must stay interchangeable with the historic
 * `cli-session-parsers` barrel, and a Codex envelope must never be reconstructed
 * by the Claude parser (or the reverse). These fixtures freeze that boundary so
 * a change to one CLI's parser cannot silently alter the other's output.
 */

import { describe, expect, it } from 'vitest';
import { parseClaudeTranscript, parseCodexRollout } from '../../src/server/native-copilot-sessions/cli-session-parsers';
import { parseClaudeTranscript as parseClaudeDirect } from '../../src/server/native-copilot-sessions/parsers/claude-transcript-parser';
import { parseCodexRollout as parseCodexDirect } from '../../src/server/native-copilot-sessions/parsers/codex-rollout-parser';

const CLAUDE_FIXTURE = [
    { type: 'user', timestamp: '2026-06-13T10:00:00.000Z', message: { role: 'user', content: 'Fix the billing bug' } },
    {
        type: 'assistant',
        timestamp: '2026-06-13T10:00:01.000Z',
        message: {
            role: 'assistant',
            model: 'claude-opus-5',
            content: [
                { type: 'thinking', thinking: 'Check the invoice path first.' },
                { type: 'text', text: 'Reading the invoice module.' },
                { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'invoice.ts' } },
            ],
        },
    },
    {
        type: 'user',
        timestamp: '2026-06-13T10:00:02.000Z',
        message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'file contents' }] }],
        },
    },
].map(record => JSON.stringify(record)).join('\n');

const CODEX_FIXTURE = [
    { type: 'session_meta', timestamp: '2026-06-13T10:00:00.000Z', payload: { id: 'codex-1', cwd: '/repo', git: { branch: 'main' } } },
    { type: 'turn_context', payload: { model: 'gpt-5.5' } },
    { type: 'event_msg', timestamp: '2026-06-13T10:00:01.000Z', payload: { type: 'user_message', message: 'Fix the billing bug' } },
    {
        type: 'response_item',
        timestamp: '2026-06-13T10:00:02.000Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Reading the invoice module.' }] },
    },
    {
        type: 'response_item',
        timestamp: '2026-06-13T10:00:03.000Z',
        payload: { type: 'function_call', call_id: 'call-1', name: 'shell', arguments: '{"cmd":"ls"}' },
    },
    {
        type: 'response_item',
        timestamp: '2026-06-13T10:00:04.000Z',
        payload: { type: 'function_call_output', call_id: 'call-1', output: 'invoice.ts' },
    },
].map(record => JSON.stringify(record)).join('\n');

describe('parser module split', () => {
    it('serves the Claude parser identically through the barrel and the module', () => {
        expect(parseClaudeTranscript(CLAUDE_FIXTURE)).toEqual(parseClaudeDirect(CLAUDE_FIXTURE));
    });

    it('serves the Codex parser identically through the barrel and the module', () => {
        expect(parseCodexRollout(CODEX_FIXTURE)).toEqual(parseCodexDirect(CODEX_FIXTURE));
    });

    it('reconstructs the frozen Claude fixture', () => {
        const turns = parseClaudeTranscript(CLAUDE_FIXTURE);
        expect(turns).not.toBeNull();
        expect(turns!.map(turn => turn.role)).toEqual(['user', 'assistant']);
        expect(turns![0].content).toBe('Fix the billing bug');
        expect(turns![1].model).toBe('claude-opus-5');
        expect(turns![1].thinking).toBe('Check the invoice path first.');
        expect(turns![1].toolCalls?.[0]).toMatchObject({
            id: 'tool-1',
            toolName: 'Read',
            status: 'completed',
            result: 'file contents',
        });
        expect(turns!.map(turn => turn.turnIndex)).toEqual([0, 1]);
    });

    it('reconstructs the frozen Codex fixture', () => {
        const turns = parseCodexRollout(CODEX_FIXTURE);
        expect(turns).not.toBeNull();
        expect(turns!.map(turn => turn.role)).toEqual(['user', 'assistant']);
        expect(turns![0].content).toBe('Fix the billing bug');
        expect(turns![1].model).toBe('gpt-5.5');
        expect(turns![1].content).toBe('Reading the invoice module.');
        expect(turns![1].toolCalls?.[0]).toMatchObject({
            id: 'call-1',
            toolName: 'shell',
            status: 'completed',
            result: 'invoice.ts',
            args: { cmd: 'ls' },
        });
    });

    it('keeps each provider parser blind to the other envelope', () => {
        // A Codex rollout has no Claude `type: 'user' | 'assistant'` records and
        // a Claude transcript has no Codex `payload` envelope, so neither parser
        // can produce turns from the other's fixture.
        expect(parseClaudeTranscript(CODEX_FIXTURE)).toBeNull();
        expect(parseCodexRollout(CLAUDE_FIXTURE)).toBeNull();
    });

    it('tolerates malformed and partially-written lines', () => {
        const damaged = `${CLAUDE_FIXTURE}\n{"type":"assistant","message":`;
        expect(parseClaudeTranscript(damaged)).toEqual(parseClaudeTranscript(CLAUDE_FIXTURE));
        expect(parseCodexRollout('not json\n')).toBeNull();
    });
});
