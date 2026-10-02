/**
 * Unit tests for the chat-target helpers shared by the Teams and WhatsApp connectors.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import {
    TOPIC_LIST_LIMIT,
    listRecentTopics,
    onTaskTerminal,
    parseListIndex,
    resolveTopic,
    resolveWorkspace,
} from '../../../src/server/messaging/chat-target';

const BOUNDED = { limit: TOPIC_LIST_LIMIT, exclude: ['conversation', 'toolCalls'] };

function topic(id: string, workspaceId?: string): AIProcess {
    return { id, metadata: workspaceId ? { workspaceId } : undefined } as unknown as AIProcess;
}

describe('parseListIndex', () => {
    it('accepts plain positive integers only', () => {
        expect(parseListIndex('1')).toBe(1);
        expect(parseListIndex('12')).toBe(12);
        expect(parseListIndex('0')).toBe(0);
        expect(parseListIndex('01')).toBe(0);
        expect(parseListIndex('2nd')).toBe(0);
        expect(parseListIndex('')).toBe(0);
    });
});

describe('resolveWorkspace', () => {
    const workspaces = [{ id: 'ws-a', name: 'Alpha' }, { id: 'WS-B', name: 'Beta' }, { id: '3' }];

    it('resolves by 1-based index, exact id, or case-insensitive name/id', () => {
        expect(resolveWorkspace(workspaces, '2')).toBe(workspaces[1]);
        expect(resolveWorkspace(workspaces, 'ws-a')).toBe(workspaces[0]);
        expect(resolveWorkspace(workspaces, 'beta')).toBe(workspaces[1]);
        expect(resolveWorkspace(workspaces, 'ws-b')).toBe(workspaces[1]);
        expect(resolveWorkspace(workspaces, 'missing')).toBeUndefined();
    });

    it('falls back to id matching when the index is out of range', () => {
        expect(resolveWorkspace([{ id: '7' }], '7')).toEqual({ id: '7' });
    });

    it('only accepts a lenient index when strictIndex is false', () => {
        expect(resolveWorkspace(workspaces, '2nd')).toBeUndefined();
        expect(resolveWorkspace(workspaces, '2nd', false)).toBe(workspaces[1]);
    });
});

describe('listRecentTopics', () => {
    it('reads a bounded, conversation-free page for one workspace and keeps only its topics', async () => {
        const getAllProcesses = vi.fn().mockResolvedValue([topic('p1', 'ws-a'), topic('p2', 'ws-b'), topic('p3')]);
        expect((await listRecentTopics({ getAllProcesses }, 'ws-a')).map(p => p.id)).toEqual(['p1']);
        expect(getAllProcesses).toHaveBeenCalledWith({ workspaceId: 'ws-a', ...BOUNDED });
    });

    it('reads a bounded page across all workspaces without filtering', async () => {
        const getAllProcesses = vi.fn().mockResolvedValue([topic('p1', 'ws-a'), topic('p2')]);
        expect((await listRecentTopics({ getAllProcesses })).map(p => p.id)).toEqual(['p1', 'p2']);
        expect(getAllProcesses).toHaveBeenCalledWith(BOUNDED);
    });
});

describe('resolveTopic', () => {
    function store() {
        return {
            getAllProcesses: vi.fn().mockResolvedValue([topic('foreign', 'ws-b'), topic('p1', 'ws-a'), topic('p2', 'ws-a')]),
            getProcess: vi.fn().mockImplementation(async (id: string) => (id === 'by-id' ? topic('by-id', 'ws-a') : undefined)),
        };
    }

    it('indexes into the same filtered list that listRecentTopics shows', async () => {
        const s = store();
        expect((await resolveTopic(s, 'ws-a', '2'))?.id).toBe('p2');
        expect(s.getProcess).not.toHaveBeenCalled();
    });

    it('falls back to a direct id lookup', async () => {
        const s = store();
        expect((await resolveTopic(s, 'ws-a', ' by-id '))?.id).toBe('by-id');
        expect(s.getAllProcesses).not.toHaveBeenCalled();
        expect(s.getProcess).toHaveBeenCalledWith('by-id', 'ws-a');
    });

    it('falls back to an id lookup when the index is out of range', async () => {
        const s = store();
        expect(await resolveTopic(s, 'ws-a', '9')).toBeUndefined();
        expect(s.getProcess).toHaveBeenCalledWith('9', 'ws-a');
    });

    it('only accepts a lenient index when strictIndex is false', async () => {
        const s = store();
        expect(await resolveTopic(s, 'ws-a', '1st')).toBeUndefined();
        expect((await resolveTopic(s, 'ws-a', '1st', false))?.id).toBe('p1');
    });
});

describe('onTaskTerminal', () => {
    it('subscribes to every terminal event and unsubscribes the same listener', () => {
        const queue = { on: vi.fn(), off: vi.fn() };
        const listener = vi.fn();
        const unsubscribe = onTaskTerminal(queue, listener);
        const events = ['taskCompleted', 'taskFailed', 'taskCancelled'];
        expect(queue.on.mock.calls).toEqual(events.map(event => [event, listener]));
        expect(queue.off).not.toHaveBeenCalled();
        unsubscribe();
        expect(queue.off.mock.calls).toEqual(events.map(event => [event, listener]));
    });
});
