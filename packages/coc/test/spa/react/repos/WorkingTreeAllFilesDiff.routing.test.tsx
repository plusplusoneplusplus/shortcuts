import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { useEffect } from 'react';

const h = vi.hoisted(() => {
    const make = () => ({ git: { getWorkingTreeChanges: vi.fn(), getWorkingTreeFileDiff: vi.fn().mockResolvedValue({ diff: '' }),
        getWorkingTreeFileContent: vi.fn().mockResolvedValue({
            binary: false, tooLarge: false, base: { content: 'needle', exists: true }, head: { content: 'needle', exists: true },
        }) } });
    return { local: make(), first: make(), second: make() };
});
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => h.local,
    getCocClientFor: (url: string) => url === 'https://first.test' ? h.first : h.second,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useDiffContentSearchEnabled', () => ({
    useDiffContentSearchEnabled: () => true,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff', async () => {
    const { useCocClient } = await import('../../../../src/server/spa/client/react/repos/cloneRouting');
    return { WorkingTreeFileDiff: (props: any) => {
        const client = useCocClient(props.workspaceId);
        useEffect(() => { void client.git.getWorkingTreeFileDiff(props.workspaceId, props.filePath, { stage: props.stage }); }, [client, props.filePath, props.stage]);
        return <div data-testid="owned-pane">{props.filePath}</div>;
    } };
});
import { WorkingTreeAllFilesDiff } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeAllFilesDiff';
import { registerCloneBaseUrls, setActiveCloneForRouting } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
const first = buildRemoteCloneKey('first', 'member');
const second = buildRemoteCloneKey('second', 'member');
const change = (name: string) => ({ filePath: `/repo/${name}`, repositoryRoot: '/repo', repositoryName: 'repo', stage: 'staged', status: 'M' });
const props = { workspaceId: 'member', onFileSelect: vi.fn() };
beforeEach(() => {
    vi.clearAllMocks();
    for (const [key, client] of Object.entries(h)) client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change(`${key}.ts`)] });
    registerCloneBaseUrls([
        { workspaceId: 'member', serverId: 'first', baseUrl: 'https://first.test' },
        { workspaceId: 'member', serverId: 'second', baseUrl: 'https://second.test' },
    ]);
    setActiveCloneForRouting(second);
});

describe('working review concrete owner routing', () => {
    it('pins repo-group member reads and descendants to the supplied owner despite an active collision', async () => {
        render(<WorkingTreeAllFilesDiff {...props} attachmentDestinationId={first} />);
        expect((await screen.findByTestId('owned-pane')).textContent).toBe('/repo/first.ts');
        expect(h.first.git.getWorkingTreeChanges).toHaveBeenCalledWith('member');
        await waitFor(() => expect(h.first.git.getWorkingTreeFileDiff).toHaveBeenCalledWith('member', '/repo/first.ts', { stage: 'staged' }));
        expect(h.local.git.getWorkingTreeChanges).not.toHaveBeenCalled();
        expect(h.second.git.getWorkingTreeChanges).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
        fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'needle' } });
        await screen.findByText('Searched 1 of 1 files');
        expect(h.first.git.getWorkingTreeFileContent).toHaveBeenCalledWith('member', '/repo/first.ts', 'staged');
        expect(h.local.git.getWorkingTreeFileContent).not.toHaveBeenCalled();
        expect(h.second.git.getWorkingTreeFileContent).not.toHaveBeenCalled();
    });
    it('explicit local owners stay on page origin despite a remote workspace with the same id', async () => {
        render(<WorkingTreeAllFilesDiff {...props} attachmentDestinationId="member" />);
        expect((await screen.findByTestId('owned-pane')).textContent).toBe('/repo/local.ts');
        expect(h.local.git.getWorkingTreeChanges).toHaveBeenCalledWith('member');
        expect(h.second.git.getWorkingTreeChanges).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
        fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'needle' } });
        await screen.findByText('Searched 1 of 1 files');
        expect(h.local.git.getWorkingTreeFileContent).toHaveBeenCalledWith('member', '/repo/local.ts', 'staged');
        expect(h.second.git.getWorkingTreeFileContent).not.toHaveBeenCalled();
    });
    it('revokes delayed reads across owner changes and refuses unavailable remote owners', async () => {
        let finish!: (value: any) => void;
        h.first.git.getWorkingTreeChanges.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const view = render(<WorkingTreeAllFilesDiff {...props} attachmentDestinationId={first} />);
        view.rerender(<WorkingTreeAllFilesDiff {...props} attachmentDestinationId={second} />);
        await screen.findByTestId('owned-pane');
        await act(async () => { finish({ changes: [change('late-first.ts')] }); });
        expect(screen.getByTestId('owned-pane').textContent).toBe('/repo/second.ts');
        await act(async () => { registerCloneBaseUrls([]); });
        expect(screen.getByRole('alert').textContent).toContain('owner is unavailable');
        expect(h.local.git.getWorkingTreeChanges).not.toHaveBeenCalled();
    });
});
