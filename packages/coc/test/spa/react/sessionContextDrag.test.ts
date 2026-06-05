import { describe, expect, it, vi } from 'vitest';
import {
    createRalphSessionContextDragPayload,
    createSessionContextDragPayload,
    RALPH_SESSION_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_MIME,
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
    writeRalphSessionContextDragData,
    writeSessionContextDragData,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';

describe('sessionContextDrag', () => {
    it.each(['queued', 'running', 'completed', 'failed', 'cancelled'] as const)('builds a safe payload for %s sessions', (status) => {
        const payload = createSessionContextDragPayload({
            id: 'proc-1',
            workspaceId: 'ws-1',
            status,
            customTitle: 'Investigate regression',
            lastActivityAt: '2026-01-01T12:00:00Z',
        }, { activeWorkspaceId: 'ws-1', idSource: 'process' });

        expect(payload).toEqual({
            kind: SESSION_CONTEXT_DRAG_KIND,
            version: 1,
            sourceWorkspaceId: 'ws-1',
            sourceProcessId: 'proc-1',
            title: 'Investigate regression',
            status,
            lastActivityAt: '2026-01-01T12:00:00.000Z',
        });
    });

    it('uses queue process IDs for queued tasks without a persisted process ID', () => {
        const payload = createSessionContextDragPayload({
            id: 'task-1',
            repoId: 'ws-1',
            status: 'queued',
            displayName: 'Queued chat',
            createdAt: 1767272400000,
        }, { activeWorkspaceId: 'ws-1', idSource: 'queue-task' });

        expect(payload?.sourceProcessId).toBe('queue_task-1');
        expect(payload?.lastActivityAt).toBe('2026-01-01T13:00:00.000Z');
    });

    it('never uses last message preview content as payload display metadata', () => {
        const payload = createSessionContextDragPayload({
            id: 'proc-1',
            workspaceId: 'ws-1',
            status: 'completed',
            lastMessagePreview: 'Assistant turn with sensitive transcript content',
            promptPreview: 'Original prompt preview',
            startTime: '2026-01-01T00:00:00Z',
        }, { activeWorkspaceId: 'ws-1', idSource: 'process' });

        expect(payload?.title).toBe('Original prompt preview');
        expect(JSON.stringify(payload)).not.toContain('Assistant turn with sensitive transcript content');
    });

    it('falls back to process ID instead of last message preview when no safe title metadata exists', () => {
        const payload = createSessionContextDragPayload({
            id: 'proc-1',
            workspaceId: 'ws-1',
            status: 'completed',
            lastMessagePreview: 'Assistant turn with sensitive transcript content',
            startTime: '2026-01-01T00:00:00Z',
        }, { activeWorkspaceId: 'ws-1', idSource: 'process' });

        expect(payload?.title).toBe('proc-1');
        expect(JSON.stringify(payload)).not.toContain('Assistant turn with sensitive transcript content');
    });

    it('blocks cross-workspace sources', () => {
        expect(createSessionContextDragPayload({
            id: 'proc-1',
            workspaceId: 'ws-other',
            status: 'completed',
            startTime: '2026-01-01T00:00:00Z',
        }, { activeWorkspaceId: 'ws-1', idSource: 'process' })).toBeNull();
    });

    it('does not use path-like workspace identifiers or leak local paths from titles', () => {
        const payload = createSessionContextDragPayload({
            id: 'proc-1',
            repoId: '/home/example/repo',
            status: 'completed',
            promptPreview: 'Debug /home/example/repo/src/app.ts and C:\\Users\\example\\secret.txt',
            startTime: '2026-01-01T00:00:00Z',
        }, { activeWorkspaceId: 'ws-1', idSource: 'process' });

        expect(payload?.sourceWorkspaceId).toBe('ws-1');
        expect(payload?.title).toBe('Debug [path] and [path]');
        expect(JSON.stringify(payload)).not.toContain('/home/example');
        expect(JSON.stringify(payload)).not.toContain('C:\\Users');
    });

    it('writes the custom MIME payload and safe text fallback', () => {
        const payload = createSessionContextDragPayload({
            id: 'proc-1',
            workspaceId: 'ws-1',
            status: 'completed',
            title: 'Source chat',
            startTime: '2026-01-01T00:00:00Z',
        }, { activeWorkspaceId: 'ws-1', idSource: 'process' })!;
        const dataTransfer = { setData: vi.fn(), effectAllowed: 'move' as DataTransfer['effectAllowed'] };

        writeSessionContextDragData(dataTransfer, payload);

        expect(dataTransfer.effectAllowed).toBe('copy');
        expect(dataTransfer.setData).toHaveBeenCalledWith(SESSION_CONTEXT_DRAG_MIME, JSON.stringify(payload));
        expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'CoC session context: Source chat [completed] proc-1');
    });

    it('builds a pointer-only payload for Ralph session groups', () => {
        const payload = createRalphSessionContextDragPayload({
            kind: 'ralph-session',
            sessionId: 'ralph-session-1',
            phase: 'executing',
            latestTimestamp: '2026-01-01T12:00:00Z',
            grillingProcess: {
                id: 'grill-proc',
                workspaceId: 'ws-1',
                status: 'completed',
                promptPreview: 'Implement /home/example/repo/src/app.ts',
            },
            iterations: [
                { id: 'iter-1', workspaceId: 'ws-1', status: 'completed' },
                { processId: 'iter-2-process', workspaceId: 'ws-1', status: 'running' },
            ],
        }, { activeWorkspaceId: 'ws-1' });

        expect(payload).toEqual({
            kind: RALPH_SESSION_CONTEXT_DRAG_KIND,
            version: 1,
            sourceWorkspaceId: 'ws-1',
            sourceRalphSessionId: 'ralph-session-1',
            title: 'Implement [path]',
            displayLabel: 'Implement [path] - 2 iter',
            phase: 'executing',
            status: 'running',
            lastActivityAt: '2026-01-01T12:00:00.000Z',
            childProcessIds: ['grill-proc', 'iter-1', 'iter-2-process'],
            processCount: 3,
            iterationCount: 2,
        });
        expect(JSON.stringify(payload)).not.toContain('/home/example');
    });

    it('preserves Ralph group child process ordering from grilling through iterations', () => {
        const payload = createRalphSessionContextDragPayload({
            sessionId: 'ralph-session-1',
            phase: 'complete',
            latestTimestamp: 1767272400000,
            grillingProcess: { id: 'grill-proc', repoId: 'ws-1', status: 'completed' },
            iterations: [
                { id: 'iter-1', repoId: 'ws-1', status: 'completed' },
                { id: 'iter-2', repoId: 'ws-1', status: 'completed' },
            ],
        });

        expect(payload?.childProcessIds).toEqual(['grill-proc', 'iter-1', 'iter-2']);
        expect(payload?.status).toBe('completed');
        expect(payload?.lastActivityAt).toBe('2026-01-01T13:00:00.000Z');
    });

    it('builds a payload for failed Ralph session groups', () => {
        const payload = createRalphSessionContextDragPayload({
            sessionId: 'ralph-session-failed',
            phase: 'failed',
            latestTimestamp: '2026-01-01T00:00:00Z',
            iterations: [
                { id: 'iter-1', workspaceId: 'ws-1', status: 'failed' },
            ],
        }, { activeWorkspaceId: 'ws-1' });

        expect(payload).toMatchObject({
            sourceRalphSessionId: 'ralph-session-failed',
            phase: 'failed',
            status: 'failed',
            childProcessIds: ['iter-1'],
            processCount: 1,
            iterationCount: 1,
        });
    });

    it.each([
        ['missing session id', { phase: 'executing', latestTimestamp: '2026-01-01T00:00:00Z', iterations: [{ id: 'iter-1', status: 'running' }] }],
        ['missing child process ids', { sessionId: 'ralph-session-1', phase: 'executing', latestTimestamp: '2026-01-01T00:00:00Z', iterations: [] }],
        ['invalid phase', { sessionId: 'ralph-session-1', phase: 'unknown', latestTimestamp: '2026-01-01T00:00:00Z', iterations: [{ id: 'iter-1', status: 'running' }] }],
        ['invalid timestamp', { sessionId: 'ralph-session-1', phase: 'executing', latestTimestamp: 'not-a-date', iterations: [{ id: 'iter-1', status: 'running' }] }],
        ['path-like child id', { sessionId: 'ralph-session-1', phase: 'executing', latestTimestamp: '2026-01-01T00:00:00Z', iterations: [{ id: '/tmp/iter-1', status: 'running' }] }],
    ])('rejects Ralph group payloads with %s', (_label, source) => {
        expect(createRalphSessionContextDragPayload(source, { activeWorkspaceId: 'ws-1' })).toBeNull();
    });

    it('blocks Ralph group cross-workspace sources', () => {
        expect(createRalphSessionContextDragPayload({
            sessionId: 'ralph-session-1',
            phase: 'executing',
            latestTimestamp: '2026-01-01T00:00:00Z',
            iterations: [{ id: 'iter-1', workspaceId: 'ws-other', status: 'running' }],
        }, { activeWorkspaceId: 'ws-1' })).toBeNull();
    });

    it('writes the Ralph group MIME payload and safe text fallback', () => {
        const payload = createRalphSessionContextDragPayload({
            sessionId: 'ralph-session-1',
            phase: 'complete',
            latestTimestamp: '2026-01-01T00:00:00Z',
            iterations: [{ id: 'iter-1', workspaceId: 'ws-1', status: 'completed' }],
        }, { activeWorkspaceId: 'ws-1' })!;
        const dataTransfer = { setData: vi.fn(), effectAllowed: 'move' as DataTransfer['effectAllowed'] };

        writeRalphSessionContextDragData(dataTransfer, payload);

        expect(dataTransfer.effectAllowed).toBe('copy');
        expect(dataTransfer.setData).toHaveBeenCalledWith(RALPH_SESSION_CONTEXT_DRAG_MIME, JSON.stringify(payload));
        expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'CoC Ralph session context: Ralph Session - 1 iter [complete/completed] ralph-session-1');
        expect(dataTransfer.setData).not.toHaveBeenCalledWith(SESSION_CONTEXT_DRAG_MIME, expect.any(String));
    });
});
