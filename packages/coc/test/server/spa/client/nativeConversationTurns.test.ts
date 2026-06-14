/**
 * Unit tests for the native-session → SPA chat-turn mapping that lets the
 * read-only detail view reuse `ConversationTurnBubble` without a fork.
 */
import { describe, it, expect } from 'vitest';
import type { ReconstructedConversationTurn } from '@plusplusoneplusplus/coc-client';
import {
    thinkingToMarkdown,
    toClientConversationTurn,
    toClientConversationTurns,
} from '../../../../src/server/spa/client/react/features/native-copilot-sessions/nativeConversationTurns';

describe('thinkingToMarkdown', () => {
    it('renders reasoning as a blockquote with a trailing block separator', () => {
        const md = thinkingToMarkdown('line one\n\nline three');
        expect(md.startsWith('> 🧠 **Reasoning**\n>\n')).toBe(true);
        expect(md).toContain('> line one');
        // Blank source lines become bare `>` so the blockquote stays contiguous.
        expect(md).toContain('\n>\n');
        expect(md).toContain('> line three');
        // Trailing blank line keeps reasoning a separate markdown block.
        expect(md.endsWith('\n\n')).toBe(true);
    });
});

describe('toClientConversationTurn', () => {
    it('passes a user turn through with content, images, and timestamp', () => {
        const turn: ReconstructedConversationTurn = {
            role: 'user',
            content: 'hello',
            timestamp: '2026-06-11T00:00:00.000Z',
            turnIndex: 0,
            timeline: [],
            images: ['data:image/png;base64,AAAA'],
        };
        const mapped = toClientConversationTurn(turn);
        expect(mapped.role).toBe('user');
        expect(mapped.content).toBe('hello');
        expect(mapped.images).toEqual(['data:image/png;base64,AAAA']);
        expect(mapped.timestamp).toBe('2026-06-11T00:00:00.000Z');
        expect(mapped.turnIndex).toBe(0);
        expect(mapped.timeline).toEqual([]);
    });

    it('maps an assistant turn with tool calls and timeline, preserving tool fields', () => {
        const turn: ReconstructedConversationTurn = {
            role: 'assistant',
            content: 'answer',
            turnIndex: 1,
            model: 'gpt-5.5',
            toolCalls: [
                { id: 't1', toolName: 'shell', args: { command: 'ls' }, result: 'file.txt', status: 'completed', startTime: 's', endTime: 'e' },
            ],
            timeline: [
                { type: 'content', timestamp: 'a', content: 'answer' },
                { type: 'tool-complete', timestamp: 'b', toolCall: { id: 't1', toolName: 'shell', args: { command: 'ls' }, result: 'file.txt', status: 'completed' } },
            ],
        };
        const mapped = toClientConversationTurn(turn);
        expect(mapped.model).toBe('gpt-5.5');
        expect(mapped.toolCalls).toHaveLength(1);
        expect(mapped.toolCalls![0]).toMatchObject({ id: 't1', toolName: 'shell', result: 'file.txt', status: 'completed', startTime: 's', endTime: 'e' });
        expect(mapped.timeline.map(i => i.type)).toEqual(['content', 'tool-complete']);
        expect(mapped.timeline[1].toolCall?.toolName).toBe('shell');
    });

    it('folds assistant reasoning into the front of the timeline and into content', () => {
        const turn: ReconstructedConversationTurn = {
            role: 'assistant',
            content: 'final answer',
            turnIndex: 2,
            thinking: 'step by step',
            timeline: [{ type: 'content', timestamp: 'a', content: 'final answer' }],
        };
        const mapped = toClientConversationTurn(turn);
        // Reasoning becomes the first timeline content item so it renders first.
        expect(mapped.timeline[0].type).toBe('content');
        expect(mapped.timeline[0].content).toContain('🧠 **Reasoning**');
        expect(mapped.timeline[0].content).toContain('> step by step');
        expect(mapped.timeline).toHaveLength(2);
        // Folded into content too (copy/raw fidelity + empty-timeline fallback).
        expect(mapped.content.startsWith('> 🧠 **Reasoning**')).toBe(true);
        expect(mapped.content).toContain('final answer');
        // No dedicated thinking field on the SPA turn shape.
        expect('thinking' in mapped).toBe(false);
    });

    it('folds reasoning even when the assistant turn has no timeline or content', () => {
        const turn: ReconstructedConversationTurn = {
            role: 'assistant',
            content: '',
            turnIndex: 3,
            thinking: 'only thinking',
            timeline: [],
        };
        const mapped = toClientConversationTurn(turn);
        expect(mapped.timeline).toHaveLength(1);
        expect(mapped.timeline[0].content).toContain('only thinking');
        expect(mapped.content).toContain('only thinking');
    });

    it('does not fold reasoning for a user turn', () => {
        const turn = {
            role: 'user',
            content: 'q',
            timeline: [],
            thinking: 'should be ignored',
        } as ReconstructedConversationTurn;
        const mapped = toClientConversationTurn(turn);
        expect(mapped.content).toBe('q');
        expect(mapped.timeline).toEqual([]);
    });

    it('omits empty optional collections', () => {
        const turn: ReconstructedConversationTurn = { role: 'assistant', content: 'x', timeline: [], toolCalls: [], images: [], skillNames: [] };
        const mapped = toClientConversationTurn(turn);
        expect(mapped.toolCalls).toBeUndefined();
        expect(mapped.images).toBeUndefined();
        expect(mapped.skillNames).toBeUndefined();
        expect(mapped.isError).toBeUndefined();
    });

    it('marks error turns and carries skill names', () => {
        const turn: ReconstructedConversationTurn = {
            role: 'assistant',
            content: 'boom',
            timeline: [],
            isError: true,
            skillNames: ['impl'],
        };
        const mapped = toClientConversationTurn(turn);
        expect(mapped.isError).toBe(true);
        expect(mapped.skillNames).toEqual(['impl']);
    });
});

describe('toClientConversationTurns', () => {
    it('maps an ordered conversation', () => {
        const conversation: ReconstructedConversationTurn[] = [
            { role: 'user', content: 'q', timeline: [], turnIndex: 0 },
            { role: 'assistant', content: 'a', timeline: [], turnIndex: 1 },
        ];
        const mapped = toClientConversationTurns(conversation);
        expect(mapped.map(t => t.role)).toEqual(['user', 'assistant']);
    });

    it('returns an empty array for null/undefined input', () => {
        expect(toClientConversationTurns(undefined)).toEqual([]);
        expect(toClientConversationTurns(null)).toEqual([]);
    });
});
