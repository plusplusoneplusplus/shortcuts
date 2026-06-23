/**
 * Tests for EnqueueDialog remote-workspace support — the Workspace dropdown
 * surfacing remote-server workspaces (from ReposContext), labeling them with
 * their server, disabling offline ones, and routing the submit to the remote
 * CoC server via getCocClientForWorkspace.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { MinimizedDialogsProvider } from '../../../src/server/spa/client/react/contexts/MinimizedDialogsContext';
import { EnqueueDialog } from '../../../src/server/spa/client/react/queue/EnqueueDialog';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

// Controllable repos + routing spies, shared between the mocks and the tests.
const { reposRef, enqueueSpy, recordSkillUsageSpy, getClientSpy } = vi.hoisted(() => {
    const enqueueSpy = vi.fn(() => Promise.resolve({ task: { id: 'remote-task-1' } }));
    const recordSkillUsageSpy = vi.fn(() => Promise.resolve({}));
    const getClientSpy = vi.fn(() => ({
        queue: { enqueue: enqueueSpy },
        preferences: { recordSkillUsage: recordSkillUsageSpy },
    }));
    return { reposRef: { current: [] as any[] }, enqueueSpy, recordSkillUsageSpy, getClientSpy };
});

vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => {
    const ctx = () => ({
        repos: reposRef.current,
        loading: false,
        fetchRepos: vi.fn(),
        unseenCounts: {},
        refreshUnseenCounts: vi.fn(),
    });
    return { useRepos: ctx, useReposOptional: ctx };
});

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/server/spa/client/react/repos/cloneRegistry')>();
    return {
        ...actual,
        getCocClientForWorkspace: getClientSpy,
        // Folder + skill fetches resolve to empty so neither dropdown grows; the tests
        // here exercise only the workspace dropdown + submit routing.
        requestForWorkspace: vi.fn(() => Promise.resolve({})),
    };
});

function makeRemoteWorkspace(overrides: Partial<any> = {}): any {
    const baseUrl = overrides.baseUrl ?? 'http://127.0.0.1:4000';
    return {
        id: overrides.id ?? 'remote-ws-1',
        name: overrides.name ?? 'shortcuts',
        rootPath: overrides.rootPath ?? '/remote/home/shortcuts',
        isGitRepo: true,
        baseUrl,
        remote: {
            baseUrl,
            serverId: overrides.serverId ?? 'srv-1',
            serverLabel: overrides.serverLabel ?? 'my-laptop',
            offline: overrides.offline ?? false,
            connection: overrides.offline ? 'offline' : 'online',
            queue: 'idle',
        },
    };
}

function Wrap({ children, workspaces = [] }: { children: ReactNode; workspaces?: any[] }) {
    return (
        <AppProvider>
            <QueueProvider>
                <MinimizedDialogsProvider>
                    <WorkspaceSetter workspaces={workspaces} />
                    {children}
                </MinimizedDialogsProvider>
            </QueueProvider>
        </AppProvider>
    );
}

function WorkspaceSetter({ workspaces }: { workspaces: any[] }) {
    const { dispatch } = useApp();
    useEffect(() => {
        if (workspaces.length > 0) {
            dispatch({ type: 'WORKSPACES_LOADED', workspaces });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function DialogOpener({ workspaceId }: { workspaceId?: string | null }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', workspaceId });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

describe('EnqueueDialog — remote workspaces', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        reposRef.current = [];
        fetchSpy = vi.fn((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
        global.fetch = fetchSpy as any;
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    it('shows a remote workspace option labeled with its server', async () => {
        reposRef.current = [{ workspace: makeRemoteWorkspace({ name: 'shortcuts', serverLabel: 'my-laptop' }) }];

        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const wsSelect = await screen.findByTestId('workspace-select') as HTMLSelectElement;
        const labels = Array.from(wsSelect.options).map(o => o.textContent);
        expect(labels).toContain('shortcuts [my-laptop]');
    });

    it('lists both local and remote workspaces together', async () => {
        reposRef.current = [{ workspace: makeRemoteWorkspace({ id: 'remote-ws-1', name: 'shortcuts', serverLabel: 'my-laptop' }) }];

        render(
            <Wrap workspaces={[{ id: 'local-1', name: 'local-shortcuts' }]}>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const wsSelect = await screen.findByTestId('workspace-select') as HTMLSelectElement;
        const values = Array.from(wsSelect.options).map(o => o.value);
        expect(values).toContain('local-1');
        expect(values).toContain('remote-ws-1');
        const labels = Array.from(wsSelect.options).map(o => o.textContent);
        expect(labels).toContain('local-shortcuts');
        expect(labels).toContain('shortcuts [my-laptop]');
    });

    it('renders an offline remote workspace as disabled with an (offline) label', async () => {
        reposRef.current = [{ workspace: makeRemoteWorkspace({ id: 'remote-off', name: 'shortcuts', serverLabel: 'my-laptop', offline: true }) }];

        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const wsSelect = await screen.findByTestId('workspace-select') as HTMLSelectElement;
        const offlineOption = Array.from(wsSelect.options).find(o => o.value === 'remote-off');
        expect(offlineOption).toBeTruthy();
        expect(offlineOption!.disabled).toBe(true);
        expect(offlineOption!.textContent).toBe('shortcuts [my-laptop] (offline)');
    });

    it('routes submit to the remote server via getCocClientForWorkspace and uses the remote rootPath', async () => {
        reposRef.current = [{ workspace: makeRemoteWorkspace({ id: 'remote-ws-1', rootPath: '/remote/home/shortcuts' }) }];

        render(
            <Wrap>
                <DialogOpener workspaceId="remote-ws-1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Run on remote';
        fireEvent.input(textarea);

        fireEvent.click(screen.getByText('Enqueue'));

        await waitFor(() => expect(enqueueSpy).toHaveBeenCalled());
        // Routing check: the client was resolved for the remote workspace id.
        expect(getClientSpy).toHaveBeenCalledWith('remote-ws-1');
        const body = enqueueSpy.mock.calls[0][0] as any;
        expect(body.payload.workspaceId).toBe('remote-ws-1');
        expect(body.payload.workingDirectory).toBe('/remote/home/shortcuts');
        expect(body.payload.prompt).toBe('Run on remote');
    });
});
