import { describe, expect, it } from 'vitest';
import { projectSteeringSections } from '../../../../src/server/spa/client/react/features/chat/conversation/steeringSections';
import type {
    ClientConversationTurn,
    ClientTimelineItem,
    ClientToolCall,
} from '../../../../src/server/spa/client/react/types/dashboard';

const timestamp = '2026-01-01T00:00:00.000Z';

function content(text: string): ClientTimelineItem {
    return { type: 'content', content: text, timestamp };
}

function marker(steeringId: string): ClientTimelineItem {
    return { type: 'steering', steeringId, timestamp };
}

function user(optimisticId: string, turnIndex = 2): ClientConversationTurn {
    return { role: 'user', optimisticId, turnIndex, content: optimisticId, timestamp, timeline: [] };
}

function assistant(
    timeline: ClientTimelineItem[],
    overrides: Partial<ClientConversationTurn> = {},
): ClientConversationTurn {
    return {
        role: 'assistant',
        turnIndex: 1,
        content: timeline.filter(item => item.type === 'content').map(item => item.content).join(''),
        timestamp,
        timeline,
        provider: 'codex',
        segmentId: 'segment-a',
        ...overrides,
    };
}

function tool(
    type: 'tool-start' | 'tool-complete' | 'tool-failed',
    id: string,
    overrides: Partial<ClientToolCall> = {},
): ClientTimelineItem {
    return {
        type,
        timestamp,
        toolCall: {
            id,
            toolName: 'bash',
            args: {},
            status: type === 'tool-start' ? 'running' : type === 'tool-failed' ? 'failed' : 'completed',
            startTime: timestamp,
            ...overrides,
        },
    };
}

describe('projectSteeringSections', () => {
    it('retains the final-only SDK response and fallback tools when no text chunks were streamed', () => {
        const fallbackTool = tool('tool-complete', 'fallback').toolCall!;
        const response = assistant([marker('steer-a')], {
            content: 'Final response.', toolCalls: [fallbackTool],
        });
        const sections = projectSteeringSections([response, user('steer-a')]);
        expect(sections.map(section => section.turn.content)).toEqual(['steer-a', 'Final response.']);
        expect(sections[1].turn.toolCalls).toEqual([fallbackTool]);
    });

    it('preserves ordinary turns, including legacy content without timeline events', () => {
        const turns = [user('prompt', 0), assistant([], { content: 'Legacy answer.' })];
        const sections = projectSteeringSections(turns);

        expect(sections.map(section => section.turn)).toEqual(turns);
        sections.forEach((section, index) => {
            expect(section.turn).toBe(turns[index]);
            expect(section.logicalTurn).toBe(turns[index]);
        });
        expect(projectSteeringSections([])).toEqual([]);
    });

    it.each([
        ['optimistic', {}],
        ['unaccepted', { steered: false }],
        ['queued', { steered: false, optimisticId: 'queued-message' }],
        ['steered flag without acceptance marker', { steered: true }],
    ])('does not split for a %s user without an accepted marker', (_label, overrides) => {
        const response = assistant([content('Before. '), content('After.')], { streaming: true });
        const followUp = { ...user('message'), ...overrides };
        const sections = projectSteeringSections([response, followUp]);

        expect(sections).toHaveLength(2);
        expect(sections[0].turn).toBe(response);
        expect(sections[1].turn).toBe(followUp);
        expect(sections[0].turn.content).toBe('Before. After.');
    });

    it.each([1, 4])('splits the canonical assistant at index %i without inventing logical turns', turnIndex => {
        const accepted = user('steer-a');
        const response = assistant([content('Before. '), marker('steer-a'), content('After.')], { turnIndex });
        const turns = [response, accepted].sort((a, b) => a.turnIndex! - b.turnIndex!);
        const sections = projectSteeringSections(turns);

        expect(sections.map(section => [section.turn.role, section.turn.content])).toEqual([
            ['assistant', 'Before. '],
            ['user', 'steer-a'],
            ['assistant', 'After.'],
        ]);
        const responses = sections.filter(section => section.turn.role === 'assistant');
        responses.forEach(section => {
            expect(section.logicalTurn).toBe(response);
            expect(section.turn.turnIndex).toBe(turnIndex);
            expect(section.turn.provider).toBe('codex');
            expect(section.turn.segmentId).toBe('segment-a');
        });
        expect(sections[1].logicalTurn).toBe(accepted);
        expect(sections[1].turn).toMatchObject({ optimisticId: 'steer-a', steered: true, turnIndex: 2 });
        expect(accepted.steered).toBeUndefined();
    });

    it('correlates multiple users by marker id, not input order, timestamps or the steered flag', () => {
        const first = user('steer-a', 3);
        const second = user('steer-b', 2);
        const unrelated = user('not-accepted', 4);
        const response = assistant([
            content('First. '), marker('steer-a'), content('Second. '), marker('steer-b'), content('Third.'),
        ]);
        const sections = projectSteeringSections([response, second, unrelated, first]);

        expect(sections.map(section => section.turn.content)).toEqual([
            'First. ', 'steer-a', 'Second. ', 'steer-b', 'Third.', 'not-accepted',
        ]);
        expect(sections.filter(section => section.turn.steered).map(section => section.logicalTurn))
            .toEqual([first, second]);
        expect(new Set(sections.map(section => section.key)).size).toBe(sections.length);
    });

    it('treats duplicate acceptance markers as idempotent without losing adjacent content', () => {
        const response = assistant([
            content('Before. '), marker('steer-a'), marker('steer-a'),
            content('Middle. '), marker('steer-a'), content('After.'),
        ]);
        const sections = projectSteeringSections([response, user('steer-a')]);

        expect(sections.map(section => section.turn.content)).toEqual(['Before. ', 'steer-a', 'Middle. After.']);
        expect(sections.flatMap(section => section.turn.timeline).some(item => item.type === 'steering')).toBe(false);
        expect(sections.filter(section => section.turn.role === 'assistant')
            .map(section => section.turn.content).join('')).toBe(response.content);
    });

    it.each(['tool-complete', 'tool-failed'] as const)(
        'keeps a late %s with its tool-start in the pre-steer section',
        completionType => {
            const start = tool('tool-start', 'tool-a');
            const completion = tool(completionType, 'tool-a', {
                result: completionType === 'tool-complete' ? 'Finished output.' : undefined,
                error: completionType === 'tool-failed' ? 'Tool failed.' : undefined,
                endTime: timestamp,
            });
            const before = content('Before. ');
            const after = content('After.');
            const response = assistant([before, start, marker('steer-a'), after, completion]);
            const sections = projectSteeringSections([response, user('steer-a')]);

            expect(sections[0].turn.timeline).toEqual([before, start, completion]);
            expect(sections[2].turn.timeline).toEqual([after]);
            expect(sections.flatMap(section => section.turn.timeline)).toHaveLength(4);
            expect(sections[0].turn.timeline[2]).toBe(completion);
            expect(sections[0].logicalTurn.timeline).toBe(response.timeline);
        },
    );

    it('keeps independently started tools in their own section across multiple steers', () => {
        const firstStart = tool('tool-start', 'tool-a');
        const secondStart = tool('tool-start', 'tool-b');
        const firstComplete = tool('tool-complete', 'tool-a');
        const secondComplete = tool('tool-complete', 'tool-b');
        const response = assistant([
            firstStart, marker('steer-a'), secondStart, marker('steer-b'),
            content('Final answer.'), firstComplete, secondComplete,
        ]);
        const sections = projectSteeringSections([response, user('steer-a'), user('steer-b', 3)]);
        const responses = sections.filter(section => section.turn.role === 'assistant');

        expect(responses.map(section => section.turn.timeline)).toEqual([
            [firstStart, firstComplete],
            [secondStart, secondComplete],
            [content('Final answer.')],
        ]);
    });

    it.each(['task', 'read_agent'])(
        'keeps nested %s content and child lifecycles with the starting section',
        toolName => {
            const start = tool('tool-start', 'parent', { toolName });
            const nestedContent = content('Nested task output. ');
            const childStart = tool('tool-start', 'child', { parentToolCallId: 'parent' });
            const complete = tool('tool-complete', 'parent', { toolName, result: 'Task result.' });
            const childComplete = tool('tool-complete', 'child', { parentToolCallId: 'parent', result: 'Child result.' });
            const after = content('Parent assistant continuation.');
            const response = assistant([
                start, marker('steer-a'), nestedContent, childStart, complete, after, childComplete,
            ]);
            const sections = projectSteeringSections([response, user('steer-a')]);

            expect(sections[0].turn.timeline).toEqual([start, nestedContent, childStart, complete, childComplete]);
            expect(sections[0].turn.content).toBe('Nested task output. ');
            expect(sections[2].turn.timeline).toEqual([after]);
            expect(sections[2].turn.content).toBe('Parent assistant continuation.');
        },
    );

    it('retains the enclosing task association after a nested task completes', () => {
        const outerStart = tool('tool-start', 'outer', { toolName: 'task' });
        const innerStart = tool('tool-start', 'inner', { toolName: 'task', parentToolCallId: 'outer' });
        const innerComplete = tool('tool-complete', 'inner', { toolName: 'task', parentToolCallId: 'outer' });
        const outerContent = content('Outer task still running. ');
        const outerComplete = tool('tool-complete', 'outer', { toolName: 'task' });
        const continuation = content('Main continuation.');
        const response = assistant([
            outerStart, innerStart, marker('steer-a'), innerComplete, outerContent, outerComplete, continuation,
        ]);
        const sections = projectSteeringSections([response, user('steer-a')]);

        expect(sections[0].turn.timeline).toEqual([outerStart, innerStart, innerComplete, outerContent, outerComplete]);
        expect(sections[2].turn.timeline).toEqual([continuation]);
    });

    it('assigns streaming and response-level completion metadata only to the final section', () => {
        const response = assistant([content('Before. '), marker('steer-a'), content('After.')], {
            streaming: true,
            interrupted: true,
            interruptionReason: 'Connection closed.',
            isError: true,
            tokenUsage: {
                inputTokens: 10, outputTokens: 20, totalTokens: 30,
                cacheReadTokens: 0, cacheWriteTokens: 0, turnCount: 1,
            },
            costTimeMs: 1200,
        });
        const sections = projectSteeringSections([response, user('steer-a')]);
        const before = sections[0].turn;
        const after = sections[2].turn;

        expect(before.streaming).toBe(false);
        expect(before.interrupted).toBe(false);
        expect(before.isError).toBe(false);
        expect(before.tokenUsage).toBeUndefined();
        expect(before.costTimeMs).toBeUndefined();
        expect(after).toMatchObject({
            streaming: true, interrupted: true, isError: true,
            tokenUsage: response.tokenUsage, costTimeMs: 1200,
        });
        expect(sections[0].logicalTurn).toBe(response);
        expect(sections[2].logicalTurn).toBe(response);
    });

    it('keeps consecutive steering users and the empty streaming tail without phantom empty responses', () => {
        const response = assistant([marker('steer-a'), marker('steer-b')], { streaming: true });
        const sections = projectSteeringSections([response, user('steer-a'), user('steer-b', 3)]);

        expect(sections.map(section => [section.turn.role, section.turn.content])).toEqual([
            ['user', 'steer-a'], ['user', 'steer-b'], ['assistant', ''],
        ]);
        expect(sections[2].turn.streaming).toBe(true);
        expect(sections[2].logicalTurn).toBe(response);
        expect(new Set(sections.map(section => section.key)).size).toBe(sections.length);
    });

    it('preserves the full canonical answer when a steering user is outside the loaded history page', () => {
        const response = assistant([
            content('Before unloaded steer. '), marker('not-loaded'), content('After unloaded steer.'),
        ]);
        const sections = projectSteeringSections([response]);

        expect(sections).toHaveLength(1);
        expect(sections[0].turn).toBe(response);
        expect(sections[0].logicalTurn.content).toBe('Before unloaded steer. After unloaded steer.');
        expect(sections[0].turn.timeline).toEqual(response.timeline);
    });

    it('does not lose content around unmatched markers when another steer is loaded', () => {
        const before = content('Before unloaded steer. ');
        const middle = content('Before loaded steer. ');
        const after = content('After loaded steer.');
        const response = assistant([before, marker('not-loaded'), middle, marker('steer-a'), after]);
        const sections = projectSteeringSections([response, user('steer-a')]);

        expect(sections.map(section => section.turn.content)).toEqual([
            'Before unloaded steer. Before loaded steer. ', 'steer-a', 'After loaded steer.',
        ]);
        expect(sections.filter(section => section.turn.role === 'assistant')
            .flatMap(section => section.turn.timeline)).toEqual([before, middle, after]);
    });

    it('leaves a loaded user visible when its acceptance marker is missing', () => {
        const response = assistant([content('Complete answer.')]);
        const followUp = { ...user('steer-a'), steered: true };
        const sections = projectSteeringSections([response, followUp]);

        expect(sections.map(section => section.turn)).toEqual([response, followUp]);
        expect(sections[0].turn.content).toBe('Complete answer.');
    });

    it('conserves content and events across live snapshots, final transcript ordering and JSON reload', () => {
        const accepted = user('steer-a');
        const before = content('Before. ');
        const start = tool('tool-start', 'tool-a');
        const response = assistant([before, start, marker('steer-a'), content('After.')], { streaming: true });
        const initialSnapshot = JSON.stringify([response, accepted]);
        const live = projectSteeringSections([response, accepted]);
        const complete = tool('tool-complete', 'tool-a', { result: 'Complete tool output.', endTime: timestamp });
        const finalResponse = assistant([...response.timeline, complete, content(' Final.')], {
            turnIndex: 3, streaming: false, toolCalls: [complete.toolCall!],
        });
        const persisted = [accepted, finalResponse];
        const reloaded = projectSteeringSections(JSON.parse(JSON.stringify(persisted)));
        const final = projectSteeringSections(persisted);

        expect(JSON.stringify([response, accepted])).toBe(initialSnapshot);
        expect(live.map(section => section.turn.content)).toEqual(['Before. ', 'steer-a', 'After.']);
        expect(final.map(section => section.turn.content)).toEqual(['Before. ', 'steer-a', 'After. Final.']);
        expect(reloaded).toEqual(final);
        const responses = reloaded.filter(section => section.turn.role === 'assistant');
        expect(responses.map(section => section.turn.content).join('')).toBe(finalResponse.content);
        const projectedEvents = responses.flatMap(section => section.turn.timeline);
        const expectedEvents = finalResponse.timeline.filter(item => item.type !== 'steering');
        expect(projectedEvents).toHaveLength(expectedEvents.length);
        expectedEvents.forEach(event => expect(projectedEvents.filter(item =>
            JSON.stringify(item) === JSON.stringify(event))).toHaveLength(1));
        expect(responses.map(section => section.logicalTurn)).toEqual([finalResponse, finalResponse]);
        expect(responses.every(section => section.turn.turnIndex === 3 && section.turn.provider === 'codex')).toBe(true);
    });
});
