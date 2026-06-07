import { describe, expect, it, vi } from 'vitest';
import { ActiveWorkspaceTracker } from '../../src/server/dashboard/active-workspace-tracker';

describe('ActiveWorkspaceTracker', () => {
    it('keeps the latest workspace per client and returns the active workspace union', () => {
        const tracker = new ActiveWorkspaceTracker();

        tracker.reportActiveWorkspace({ clientId: 'client-a', workspaceId: 'ws-one', now: 1000 });
        tracker.reportActiveWorkspace({ clientId: 'client-b', workspaceId: 'ws-two', now: 1001 });
        const snapshot = tracker.reportActiveWorkspace({ clientId: 'client-a', workspaceId: 'ws-two', now: 1002 });

        expect(snapshot.activeWorkspaceIds).toEqual(['ws-two']);
        expect(snapshot.clients).toEqual([
            { clientId: 'client-a', workspaceId: 'ws-two', lastSeenAt: 1002 },
            { clientId: 'client-b', workspaceId: 'ws-two', lastSeenAt: 1001 },
        ]);
    });

    it('prunes inactive dashboard clients using the configured recent-activity window', () => {
        const tracker = new ActiveWorkspaceTracker(1000);

        tracker.reportActiveWorkspace({ clientId: 'client-a', workspaceId: 'ws-one', now: 1000 });
        tracker.reportActiveWorkspace({ clientId: 'client-b', workspaceId: 'ws-two', now: 1500 });

        expect(tracker.getSnapshot(2000).activeWorkspaceIds).toEqual(['ws-one', 'ws-two']);
        expect(tracker.getSnapshot(2500).activeWorkspaceIds).toEqual(['ws-two']);
        expect(tracker.getSnapshot(2501).activeWorkspaceIds).toEqual([]);
    });

    it('removes a client when the dashboard reports no selected workspace', () => {
        const tracker = new ActiveWorkspaceTracker();

        tracker.reportActiveWorkspace({ clientId: 'client-a', workspaceId: 'ws-one', now: 1000 });
        const snapshot = tracker.reportActiveWorkspace({ clientId: 'client-a', workspaceId: null, now: 1001 });

        expect(snapshot).toEqual({ activeWorkspaceIds: [], clients: [] });
    });

    it('notifies listeners only when the active workspace union changes', () => {
        const tracker = new ActiveWorkspaceTracker();
        const listener = vi.fn();

        const unsubscribe = tracker.onChange(listener);
        tracker.reportActiveWorkspace({ clientId: 'client-a', workspaceId: 'ws-one', now: 1000 });
        tracker.reportActiveWorkspace({ clientId: 'client-a', workspaceId: 'ws-one', now: 1001 });
        tracker.reportActiveWorkspace({ clientId: 'client-b', workspaceId: 'ws-one', now: 1002 });
        tracker.reportActiveWorkspace({ clientId: 'client-a', workspaceId: 'ws-two', now: 1003 });
        unsubscribe();
        tracker.reportActiveWorkspace({ clientId: 'client-c', workspaceId: 'ws-three', now: 1004 });

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener.mock.calls[0][0].activeWorkspaceIds).toEqual(['ws-one']);
        expect(listener.mock.calls[0][1].activeWorkspaceIds).toEqual([]);
        expect(listener.mock.calls[1][0].activeWorkspaceIds).toEqual(['ws-one', 'ws-two']);
        expect(listener.mock.calls[1][1].activeWorkspaceIds).toEqual(['ws-one']);
    });
});
