import { describe, expect, it, vi } from 'vitest';
import {
    createSessionContextDragPayload,
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
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
});
