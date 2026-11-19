import { describe, expect, it } from 'vitest';
import type { MessageSteeringPayload, SteeringBoundary } from '@plusplusoneplusplus/coc-client';
import {
    applyAcceptedSteering,
    insertSteeringBoundary,
    reconcileSteering,
} from '../../../../src/server/spa/client/react/features/chat/conversation/reconcileSteering';
import { projectSteeringSections } from '../../../../src/server/spa/client/react/features/chat/conversation/steeringSections';
import type {
    ClientConversationTurn,
    ClientTimelineItem,
} from '../../../../src/server/spa/client/react/types/dashboard';

const timestamp = '2026-01-01T00:00:00.000Z';

function content(text: string): ClientTimelineItem {
    return { type: 'content', content: text, timestamp };
}

function user(optimisticId = 'steer-a', turnIndex = 2): ClientConversationTurn {
    return { role: 'user', optimisticId, turnIndex, content: optimisticId, timestamp, timeline: [] };
}

function assistant(
    timeline: ClientTimelineItem[] = [content('Before. After.')],
    overrides: Partial<ClientConversationTurn> = {},
): ClientConversationTurn {
    return {
        role: 'assistant',
        content: timeline.filter(item => item.type === 'content').map(item => item.content ?? '').join(''),
        turnIndex: 1,
        streaming: true,
        provider: 'codex',
        segmentId: 'segment-a',
        timeline,
        ...overrides,
    };
}

function ack(
    optimisticId = 'steer-a',
    contentOffset = 'Before. '.length,
    timelineIndex = 1,
    turnIndex = 2,
    eventOffset = 0,
): MessageSteeringPayload & { boundary: SteeringBoundary } {
    return {
        turnIndex,
        optimisticId,
        boundary: { steeringId: optimisticId, contentOffset, timelineIndex, eventOffset, timestamp },
    };
}

function events(turn: ClientConversationTurn): string[] {
    return turn.timeline.map(item => item.type === 'content' ? item.content ?? ''
        : item.type === 'steering' ? `steer:${item.steeringId}` : `${item.type}:${item.toolCall?.id}`);
}

function response(turns: ClientConversationTurn[], turnIndex = 1): ClientConversationTurn {
    return turns.find(turn => turn.role === 'assistant' && turn.turnIndex === turnIndex)!;
}

function tool(type: 'tool-start' | 'tool-complete'): ClientTimelineItem {
    return {
        type,
        timestamp,
        toolCall: {
            id: 'tool-a', toolName: 'bash', args: { command: 'echo result' },
            status: type === 'tool-start' ? 'running' : 'completed',
            ...(type === 'tool-complete' ? { result: 'Tool result.' } : {}),
        },
    };
}

describe('reconcileSteering', () => {
    it.each(['HTTP then SSE', 'SSE then HTTP'])('%s reconciles once by optimistic id', order => {
        const optimistic = user('steer-a', 8);
        const initial = [assistant(), optimistic];
        const before = JSON.stringify(initial);
        const http = ack();
        const sse = {
            ...ack(),
            userTurn: {
                role: 'user' as const, turnIndex: 2, optimisticId: 'steer-a',
                content: optimistic.content, timestamp, provider: 'codex', segmentId: 'segment-a',
            },
        };
        const acknowledgements = order === 'HTTP then SSE' ? [http, sse] : [sse, http];
        const once = reconcileSteering(initial, acknowledgements[0], 1);
        const twice = reconcileSteering(once, acknowledgements[1], 1);
        const repeated = reconcileSteering(twice, acknowledgements[1], 1);

        expect(JSON.stringify(initial)).toBe(before);
        expect(twice.filter(turn => turn.role === 'user')).toHaveLength(1);
        expect(twice.find(turn => turn.role === 'user')).toMatchObject({
            optimisticId: 'steer-a', turnIndex: 2, steered: true, content: 'steer-a',
            provider: 'codex', segmentId: 'segment-a',
        });
        expect(events(response(twice))).toEqual(['Before. ', 'steer:steer-a', 'After.']);
        expect(response(twice).content).toBe('Before. After.');
        expect(repeated).toEqual(twice);
        expect(projectSteeringSections(twice).map(section => section.turn.content))
            .toEqual(['Before. ', 'steer-a', 'After.']);
    });

    it('upserts an externally accepted user that has no local optimistic turn', () => {
        const payload = {
            ...ack('external-steer'),
            userTurn: {
                role: 'user' as const,
                content: 'External direction.',
                timestamp: new Date(timestamp),
                turnIndex: 2,
                provider: 'codex',
                segmentId: 'segment-a',
                images: ['data:image/png;base64,AA=='],
            },
        };
        const result = reconcileSteering([assistant()], payload, 1);
        const accepted = result.find(turn => turn.role === 'user');

        expect(accepted).toMatchObject({
            content: 'External direction.', timestamp, turnIndex: 2, optimisticId: 'external-steer',
            steered: true, provider: 'codex', segmentId: 'segment-a',
            images: payload.userTurn.images,
        });
        expect(events(response(result))).toEqual(['Before. ', 'steer:external-steer', 'After.']);
        expect(reconcileSteering(result, payload, 1)).toEqual(result);
    });

    it('upserts a canonical user into the server index while retaining a different optimistic user at that index', () => {
        const other = user('other-message', 2);
        const pending = user('steer-a', 9);
        const result = reconcileSteering([assistant(), other, pending], ack(), 1);

        expect(result.filter(turn => turn.role === 'user')).toHaveLength(2);
        expect(result.find(turn => turn.optimisticId === 'other-message')).toBe(other);
        expect(result.find(turn => turn.optimisticId === 'steer-a')).toMatchObject({
            turnIndex: 2, steered: true,
        });
        expect(projectSteeringSections(result).map(section => section.turn.content))
            .toEqual(['Before. ', 'steer-a', 'After.', 'other-message']);
    });

    it('does not replace another optimistic user when an external accepted user has the same local index', () => {
        const other = user('other-message');
        const payload = {
            ...ack('external-steer'),
            userTurn: { role: 'user' as const, content: 'External steer.', timestamp, turnIndex: 2 },
        };
        const result = reconcileSteering([assistant(), other], payload, 1);

        expect(result.filter(turn => turn.role === 'user')).toHaveLength(2);
        expect(result.find(turn => turn.optimisticId === 'other-message')).toBe(other);
        expect(result.find(turn => turn.optimisticId === 'external-steer')?.content).toBe('External steer.');
    });

    it('does not duplicate an already loaded uncorrelated canonical user at the accepted index', () => {
        const canonical = { ...user(), optimisticId: undefined };
        const optimistic = user('steer-a', 9);
        const result = reconcileSteering([assistant(), canonical, optimistic], ack(), 1);

        expect(result.filter(turn => turn.role === 'user')).toHaveLength(1);
        expect(result.find(turn => turn.role === 'user')).toMatchObject({
            optimisticId: 'steer-a', turnIndex: 2, content: 'steer-a',
        });
    });

    it('does not split pending, failed or queued messages without an accepted boundary', () => {
        const original = assistant();
        const users = [user('pending', 2), user('failed', 3), user('queued', 4)];
        const initial = [original, ...users];
        const result = users.reduce((turns, turn) => reconcileSteering(turns, {
            turnIndex: turn.turnIndex!, optimisticId: turn.optimisticId,
        }, 1), initial);

        expect(response(result)).toBe(original);
        expect(result.flatMap(turn => turn.timeline).filter(item => item.type === 'steering')).toEqual([]);
        expect(projectSteeringSections(result).map(section => section.turn.content))
            .toEqual(['Before. After.', 'pending', 'failed', 'queued']);
    });

    it('cuts content that arrived before the ACK at the exact UTF-16 offset', () => {
        const prefix = 'A😀B ';
        const original = assistant([content('A😀'), content('B '), content('already arrived.')]);
        const result = reconcileSteering([original, user()], ack('steer-a', prefix.length), 1);

        expect(prefix.length).toBe(5);
        expect(events(response(result))).toEqual([prefix, 'steer:steer-a', 'already arrived.']);
        expect(response(result).content).toBe('A😀B already arrived.');
        expect(events(original)).toEqual(['A😀', 'B ', 'already arrived.']);
    });

    it('preserves both tool events and results when cutting a later merged content item', () => {
        const start = tool('tool-start');
        const complete = tool('tool-complete');
        const original = assistant([content('Intro. '), start, complete, content('Before. '), content('After.')]);
        const result = reconcileSteering(
            [original, user()], ack('steer-a', 'Intro. Before. '.length, 4, 2, 2), 1,
        );
        const reconciled = response(result);

        expect(events(reconciled)).toEqual([
            'Intro. ', 'tool-start:tool-a', 'tool-complete:tool-a', 'Before. ', 'steer:steer-a', 'After.',
        ]);
        expect(reconciled.timeline.filter(item => item.toolCall)).toEqual([start, complete]);
        expect(reconciled.timeline[1]).toBe(start);
        expect(reconciled.timeline[2].toolCall?.result).toBe('Tool result.');
        expect(reconciled.content).toBe(original.content);
    });

    it.each([
        ['chronological', false],
        ['reverse', true],
    ])('orders multiple accepted steers independently of %s ACK arrival', (_label, reverse) => {
        const first = ack('steer-a', 2, 1, 2);
        const second = ack('steer-b', 4, 3, 3);
        const payloads = reverse ? [second, first] : [first, second];
        const initial = [assistant([content('abcdef')]), user('steer-a'), user('steer-b', 3)];
        const result = payloads.reduce((turns, payload) => reconcileSteering(turns, payload, 1), initial);

        expect(events(response(result))).toEqual(['ab', 'steer:steer-a', 'cd', 'steer:steer-b', 'ef']);
        expect(projectSteeringSections(result).map(section => section.turn.content))
            .toEqual(['ab', 'steer-a', 'cd', 'steer-b', 'ef']);
        expect(response(result).content).toBe('abcdef');
    });

    it.each([
        ['before', 1, 0, ['abc', 'steer:steer-a', 'tool-start:tool-a', 'def']],
        ['after', 2, 1, ['abc', 'tool-start:tool-a', 'steer:steer-a', 'def']],
    ] as const)('uses eventOffset to place a same-offset marker %s a tool', (_label, timelineIndex, eventOffset, expected) => {
        const original = assistant([content('abc'), tool('tool-start'), content('def')]);
        const result = reconcileSteering([original, user()], ack('steer-a', 3, timelineIndex, 2, eventOffset), 1);

        expect(events(response(result))).toEqual(expected);
        expect(response(result).content).toBe('abcdef');
    });

    it('uses timelineIndex as a fallback when a boundary omits eventOffset', () => {
        const payload = ack('steer-a', 3, 2);
        delete payload.boundary.eventOffset;
        const original = assistant([content('abc'), tool('tool-start'), content('def')]);
        const result = reconcileSteering([original, user()], payload, 1);

        expect(events(response(result))).toEqual(['abc', 'tool-start:tool-a', 'steer:steer-a', 'def']);
    });

    it('keeps same-offset steers on opposite sides of a tool when ACKs arrive out of order', () => {
        const initial = [
            assistant([content('abc'), tool('tool-start'), content('def')]),
            user('steer-a'), user('steer-b', 3),
        ];
        const later = reconcileSteering(initial, ack('steer-b', 3, 3, 3, 1), 1);
        const result = reconcileSteering(later, ack('steer-a', 3, 1, 2), 1);

        expect(events(response(result))).toEqual([
            'abc', 'steer:steer-a', 'tool-start:tool-a', 'steer:steer-b', 'def',
        ]);
        expect(response(result).timeline.filter(item => item.type === 'tool-start')).toHaveLength(1);
    });

    it('targets the explicit logical response without marking historical or unrelated streaming assistants', () => {
        const old = assistant([content('Historical.')], { turnIndex: 0, streaming: false });
        const current = assistant();
        const other = assistant([content('Unrelated.')], { turnIndex: 4 });
        const result = reconcileSteering([old, current, other, user()], ack(), 1);

        expect(response(result, 0)).toBe(old);
        expect(response(result, 4)).toBe(other);
        expect(events(response(result))).toEqual(['Before. ', 'steer:steer-a', 'After.']);
    });

    it('does not duplicate users, markers or full content after a canonical snapshot refresh', () => {
        const payload = ack();
        const reconciled = reconcileSteering([assistant(), user()], payload, 1);
        const refreshed = JSON.parse(JSON.stringify(reconciled)) as ClientConversationTurn[];
        const refreshedResponse = response(refreshed);
        refreshedResponse.streaming = false;
        const result = reconcileSteering(reconcileSteering(refreshed, payload, 1), payload, 1);

        expect(result).toEqual(refreshed);
        expect(result.filter(turn => turn.role === 'user')).toHaveLength(1);
        expect(events(response(result))).toEqual(['Before. ', 'steer:steer-a', 'After.']);
        expect(projectSteeringSections(result).filter(section => section.turn.role === 'assistant')
            .map(section => section.turn.content).join('')).toBe('Before. After.');
        expect(insertSteeringBoundary(refreshedResponse, payload.boundary)).toBe(refreshedResponse);
    });
});

describe('applyAcceptedSteering', () => {
    it('replays an ACK that precedes the first assistant chunk', () => {
        const accepted = reconcileSteering([user()], ack('steer-a', 0, 0), 1);
        const empty = assistant([]);
        const withMarker = applyAcceptedSteering(empty, accepted);
        const withChunk = {
            ...withMarker,
            content: 'First chunk.',
            timeline: [...withMarker.timeline, content('First chunk.')],
        };
        const result = applyAcceptedSteering(withChunk, accepted);

        expect(events(withMarker)).toEqual(['steer:steer-a']);
        expect(events(result)).toEqual(['steer:steer-a', 'First chunk.']);
        expect(result.content).toBe('First chunk.');
        expect(projectSteeringSections([result, ...accepted]).map(section => section.turn.content))
            .toEqual(['steer-a', 'First chunk.']);
    });

    it('retains a pending marker until the assistant text reaches the accepted offset', () => {
        const accepted = reconcileSteering([user()], ack('steer-a', 3, 1), 1);
        const early = applyAcceptedSteering(assistant([content('ab')]), accepted);
        const caughtUp = applyAcceptedSteering(assistant([content('abcdef')]), accepted);

        expect(events(early)).toEqual(['ab']);
        expect(accepted.find(turn => turn.role === 'user')?.timeline).toEqual([
            { type: 'steering', ...ack('steer-a', 3, 1).boundary },
        ]);
        expect(events(caughtUp)).toEqual(['abc', 'steer:steer-a', 'def']);
        expect(applyAcceptedSteering(caughtUp, accepted)).toBe(caughtUp);
    });

    it('retains eventOffset when replaying a pending marker beside a tool', () => {
        const payload = ack('steer-a', 3, 2, 2, 1);
        const accepted = reconcileSteering([user()], payload, 1);
        const current = assistant([content('abc'), tool('tool-start'), content('def')]);
        const result = applyAcceptedSteering(current, accepted);

        expect(events(result)).toEqual(['abc', 'tool-start:tool-a', 'steer:steer-a', 'def']);
        expect(result.timeline.find(item => item.type === 'steering')).toMatchObject(payload.boundary);
    });

    it('replays pending boundaries in chronological order even when accepted users are stored in reverse order', () => {
        const first = reconcileSteering([user('steer-a')], ack('steer-a', 2, 1, 2), 1)[0];
        const second = reconcileSteering([user('steer-b', 3)], ack('steer-b', 4, 3, 3), 1)[0];
        const result = applyAcceptedSteering(assistant([content('abcdef')]), [second, first]);

        expect(events(result)).toEqual(['ab', 'steer:steer-a', 'cd', 'steer:steer-b', 'ef']);
        expect(result.content).toBe('abcdef');
    });

    it('does not replay a prior accepted user boundary into the next logical response', () => {
        const old = reconcileSteering([assistant(), user()], ack(), 1);
        const nextUser = user('next-prompt', 3);
        const next = assistant([content('Next logical answer.')], { turnIndex: 4 });

        expect(applyAcceptedSteering(next, [...old, nextUser])).toBe(next);
        expect(events(next)).toEqual(['Next logical answer.']);
    });

    it('does not replay an old boundary already present in another canonical response', () => {
        const old = reconcileSteering([assistant(), user()], ack(), 1);
        const candidate = assistant([content('Another response.')], { turnIndex: 1 });
        const oldWithDifferentIndex = { ...response(old), turnIndex: 0 };
        const accepted = old.find(turn => turn.role === 'user')!;

        expect(applyAcceptedSteering(candidate, [oldWithDifferentIndex, accepted])).toBe(candidate);
        expect(events(candidate)).toEqual(['Another response.']);
    });

    it('ignores optimistic or unaccepted users even if they contain a matching pending marker', () => {
        const unaccepted = {
            ...user(),
            timeline: [{ type: 'steering' as const, ...ack().boundary }],
        };
        const current = assistant();

        expect(applyAcceptedSteering(current, [unaccepted])).toBe(current);
    });
});
