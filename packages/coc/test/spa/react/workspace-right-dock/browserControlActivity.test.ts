import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    clearBrowserControlActivities, finishBrowserControlActivity, getBrowserControlActivity,
    startBrowserControlActivity, subscribeBrowserControlActivity, updateBrowserControlTab, resumeBrowserControlActivity,
} from '../../../../src/server/spa/client/react/shared/file-path/browser-control-activity';

afterEach(() => { clearBrowserControlActivities('workspace-a'); clearBrowserControlActivities('workspace-b'); });

describe('browser controlling turn ownership', () => {
    it('does not let old-turn clears or late starts erase or restore a follow-up badge', () => {
        const activity = { workspaceId: 'workspace-a', processId: 'p', tabId: 'tab-a' };
        startBrowserControlActivity({ ...activity, turnId: 'old-token' });
        finishBrowserControlActivity('workspace-a', 'p', undefined, 'old-token');
        expect(startBrowserControlActivity({ ...activity, turnId: 'new-token' })).toBe(true);
        finishBrowserControlActivity('workspace-a', 'p', undefined, 'old-token');
        expect(getBrowserControlActivity('workspace-a', 'tab-a')?.turnId).toBe('new-token');
        window.dispatchEvent(new CustomEvent('coc-local-ws-message', {
            detail: { type: 'process-updated', process: { id: 'p', workspaceId: 'workspace-a', status: 'completed' } },
        }));
        expect(getBrowserControlActivity('workspace-a', 'tab-a')?.turnId).toBe('new-token');
        expect(startBrowserControlActivity({ ...activity, turnId: 'old-token' })).toBe(false);
    });
    it.each([null, 'remote:owner:workspace-a'])('retains explicit routing owner %s between commands and tab updates', routingRef => {
        const activity = { workspaceId: 'workspace-a', processId: 'turn-a', tabId: 'tab-a', routingRef };
        startBrowserControlActivity(activity);
        startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'turn-a' });
        updateBrowserControlTab('workspace-a', 'turn-a', 'tab-b');
        expect(getBrowserControlActivity('workspace-a', 'tab-b')?.routingRef).toBe(routingRef);
    });

    it('records terminal status before the first delayed command starts', () => {
        window.dispatchEvent(new CustomEvent('coc-local-ws-message', {
            detail: { type: 'process-updated', process: { id: 'turn-a', workspaceId: 'workspace-a', status: 'completed' } },
        }));
        expect(startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'turn-a', tabId: 'tab-a' })).toBe(false);
    });

    it('isolates equal workspace/process ids by local versus remote server ownership', () => {
        const sourceBaseUrl = 'https://owner.example';
        const activity = { workspaceId: 'workspace-a', processId: 'turn-a', tabId: 'tab-a' };
        startBrowserControlActivity(activity);
        startBrowserControlActivity({ ...activity, sourceBaseUrl });
        window.dispatchEvent(new CustomEvent('coc-remote-ws-message', {
            detail: { baseUrl: sourceBaseUrl, message: { type: 'process-updated', process: { id: 'turn-a', workspaceId: 'workspace-a', status: 'completed' } } },
        }));
        expect(getBrowserControlActivity('workspace-a', 'tab-a', sourceBaseUrl)).toBeNull();
        expect(getBrowserControlActivity('workspace-a', 'tab-a')?.processId).toBe('turn-a');
        expect(startBrowserControlActivity({ ...activity, sourceBaseUrl })).toBe(false);
        clearBrowserControlActivities('workspace-a');
        expect(startBrowserControlActivity({ ...activity, sourceBaseUrl })).toBe(false);
        clearBrowserControlActivities('workspace-a', sourceBaseUrl);
    });

    it.each(['completed', 'cancelled', 'failed', 'cancelling'])('cleans up global process-updated %s without a chat or badge mounted', status => {
        const activity = { workspaceId: 'workspace-a', processId: 'turn-a', tabId: 'tab-a' };
        startBrowserControlActivity(activity);
        const update = (workspaceId: string, state: string) => window.dispatchEvent(new CustomEvent('coc-local-ws-message', {
            detail: { type: 'process-updated', process: { id: 'turn-a', workspaceId, status: state } },
        }));
        update('workspace-b', status);
        expect(getBrowserControlActivity('workspace-a', 'tab-a')?.processId).toBe('turn-a');
        update('workspace-a', status);
        expect(getBrowserControlActivity('workspace-a', 'tab-a')).toBeNull();
        expect(startBrowserControlActivity(activity)).toBe(false);
        update('workspace-b', 'running');
        expect(startBrowserControlActivity(activity)).toBe(false);
        update('workspace-a', 'running');
        expect(startBrowserControlActivity(activity)).toBe(true);
    });

    it('Stop targets the latest driver when two turns share a tab', () => {
        startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'turn-a', tabId: 'tab-a' });
        startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'turn-b', tabId: 'tab-a' });
        expect(getBrowserControlActivity('workspace-a', 'tab-a')?.processId).toBe('turn-b');
        startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'turn-a', tabId: 'tab-a' });
        expect(getBrowserControlActivity('workspace-a', 'tab-a')?.processId).toBe('turn-a');
        finishBrowserControlActivity('workspace-a', 'turn-a');
        expect(getBrowserControlActivity('workspace-a', 'tab-a')?.processId).toBe('turn-b');
    });

    it('retains the badge between commands and isolates workspace and selected tab', () => {
        startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'turn-a', tabId: 'owner|tab-a' });
        expect(getBrowserControlActivity('workspace-b', 'owner|tab-a')).toBeNull();
        expect(getBrowserControlActivity('workspace-a', 'owner|tab-b')).toBeNull();
        startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'turn-a' });
        expect(getBrowserControlActivity('workspace-a', 'owner|tab-a')?.processId).toBe('turn-a');
        updateBrowserControlTab('workspace-a', 'turn-a', 'owner|tab-b');
        expect(getBrowserControlActivity('workspace-a', 'owner|tab-a')).toBeNull();
        expect(getBrowserControlActivity('workspace-a', 'owner|tab-b')?.processId).toBe('turn-a');
    });

    it('does not resurrect a finished turn from a late command response', () => {
        startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'turn-a' });
        finishBrowserControlActivity('workspace-a', 'turn-a');
        updateBrowserControlTab('workspace-a', 'turn-a', 'owner|tab-a');
        expect(getBrowserControlActivity('workspace-a', 'owner|tab-a')).toBeNull();
    });

    it('rejects a late command start until an owning process resumes', () => {
        finishBrowserControlActivity('workspace-a', 'turn-a');
        const activity = { workspaceId: 'workspace-a', processId: 'turn-a', tabId: 'tab-a' };
        expect(startBrowserControlActivity(activity)).toBe(false);
        resumeBrowserControlActivity('workspace-b', 'turn-a');
        expect(startBrowserControlActivity(activity)).toBe(false);
        expect(getBrowserControlActivity('workspace-a', 'tab-a')).toBeNull();
        resumeBrowserControlActivity('workspace-a', 'turn-a');
        expect(startBrowserControlActivity(activity)).toBe(true);
        expect(getBrowserControlActivity('workspace-a', 'tab-a')?.processId).toBe('turn-a');
    });

    it('disconnect clears only its workspace and unsubscribes observers', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeBrowserControlActivity(listener);
        startBrowserControlActivity({ workspaceId: 'workspace-a', processId: 'turn-a', tabId: 'tab-a' });
        startBrowserControlActivity({ workspaceId: 'workspace-b', processId: 'turn-b', tabId: 'tab-b' });
        clearBrowserControlActivities('workspace-a');
        expect(getBrowserControlActivity('workspace-b', 'tab-b')?.processId).toBe('turn-b');
        expect(listener).toHaveBeenCalledTimes(3);
        unsubscribe();
        clearBrowserControlActivities('workspace-b');
        expect(listener).toHaveBeenCalledTimes(3);
    });
});
