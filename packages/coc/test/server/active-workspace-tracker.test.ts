import { describe, expect, it } from 'vitest';
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
});
