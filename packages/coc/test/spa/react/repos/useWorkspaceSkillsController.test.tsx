import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceSkillsController } from '../../../../src/server/spa/client/react/features/skills/useWorkspaceSkillsController';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createClient() {
    return {
        skills: {
            listWorkspace: vi.fn().mockResolvedValue([]),
            getWorkspaceConfig: vi.fn().mockResolvedValue({ disabledSkills: [], extraSkillFolders: [] }),
            updateWorkspaceConfig: vi.fn().mockResolvedValue({}),
            detailGlobal: vi.fn().mockResolvedValue({ skill: null }),
            detailWorkspace: vi.fn().mockResolvedValue({ skill: null }),
            deleteWorkspace: vi.fn().mockResolvedValue(undefined),
            readWorkspaceSkillFile: vi.fn(),
            getWorkspacePath: vi.fn(),
        },
        preferences: {
            getRepo: vi.fn().mockResolvedValue({}),
            patchRepo: vi.fn().mockResolvedValue({}),
        },
    };
}

describe('useWorkspaceSkillsController', () => {
    beforeEach(() => vi.clearAllMocks());

    it('loads list, config, and linked-repo preferences through the injected workspace client', async () => {
        const client = createClient();
        client.skills.listWorkspace.mockResolvedValue([{ name: 'impl' }]);
        client.skills.getWorkspaceConfig.mockResolvedValue({ disabledSkills: ['impl'], extraSkillFolders: ['/shared'] });
        client.preferences.getRepo.mockResolvedValue({ linkedRepoIds: ['repo-b'] });
        const resolveClient = vi.fn(() => client as any);
        const { result } = renderHook(() => useWorkspaceSkillsController({
            workspaceId: 'ws-a',
            resolveClient,
            loadLinkedRepoPreferences: true,
        }));

        await waitFor(() => expect(result.current.skillsLoading).toBe(false));

        expect(result.current.skills.map(skill => skill.name)).toEqual(['impl']);
        expect(result.current.disabledSkills).toEqual(['impl']);
        expect(result.current.extraSkillFolders).toEqual(['/shared']);
        expect(result.current.linkedRepoIds).toEqual(['repo-b']);
        expect(client.skills.listWorkspace).toHaveBeenCalledWith('ws-a');
        expect(client.preferences.getRepo).toHaveBeenCalledWith('ws-a');
    });

    it('ignores late list and config responses after a workspace switch', async () => {
        const client = createClient();
        const oldList = deferred<any[]>();
        const oldConfig = deferred<{ disabledSkills: string[]; extraSkillFolders: string[] }>();
        client.skills.listWorkspace.mockImplementation((workspaceId: string) => (
            workspaceId === 'old' ? oldList.promise : Promise.resolve([{ name: 'new-skill' }])
        ));
        client.skills.getWorkspaceConfig.mockImplementation((workspaceId: string) => (
            workspaceId === 'old'
                ? oldConfig.promise
                : Promise.resolve({ disabledSkills: ['new-skill'], extraSkillFolders: ['/new'] })
        ));
        const resolveClient = () => client as any;
        const { result, rerender } = renderHook(
            ({ workspaceId }) => useWorkspaceSkillsController({ workspaceId, resolveClient }),
            { initialProps: { workspaceId: 'old' } },
        );

        rerender({ workspaceId: 'new' });
        await waitFor(() => expect(result.current.skills.map(skill => skill.name)).toEqual(['new-skill']));

        await act(async () => {
            oldList.resolve([{ name: 'old-skill' }]);
            oldConfig.resolve({ disabledSkills: [], extraSkillFolders: ['/old'] });
            await Promise.all([oldList.promise, oldConfig.promise]);
        });

        expect(result.current.skills.map(skill => skill.name)).toEqual(['new-skill']);
        expect(result.current.extraSkillFolders).toEqual(['/new']);
    });

    it('ignores a late detail response after the card closes', async () => {
        const client = createClient();
        client.skills.listWorkspace.mockResolvedValue([{ name: 'impl', version: '1.0.0' }]);
        const detail = deferred<{ skill: { name: string; version: string } }>();
        client.skills.detailWorkspace.mockReturnValue(detail.promise);
        const { result } = renderHook(() => useWorkspaceSkillsController({
            workspaceId: 'ws-a',
            resolveClient: () => client as any,
        }));
        await waitFor(() => expect(result.current.skillsLoading).toBe(false));

        act(() => { void result.current.expandSkill('impl'); });
        await waitFor(() => expect(result.current.expandedSkill).toBe('impl'));
        await act(async () => { await result.current.expandSkill('impl'); });
        detail.resolve({ skill: { name: 'impl', version: '9.9.9' } });
        await act(async () => { await detail.promise; });

        expect(result.current.expandedSkill).toBeNull();
        expect(result.current.skillDetail).toBeNull();
        expect(result.current.detailLoading).toBe(false);
    });

    it('routes managed-global detail correctly and uses listed detail for read-only sources', async () => {
        const client = createClient();
        client.skills.listWorkspace.mockResolvedValue([
            { name: 'global', source: 'global' },
            { name: 'shared', source: 'linked-repo', promptBody: 'Shared body' },
        ]);
        client.skills.detailGlobal.mockResolvedValue({ skill: { name: 'global', source: 'global', promptBody: 'Global body' } });
        const { result } = renderHook(() => useWorkspaceSkillsController({
            workspaceId: 'ws-a',
            resolveClient: () => client as any,
        }));
        await waitFor(() => expect(result.current.skillsLoading).toBe(false));

        await act(async () => { await result.current.expandSkill('global'); });
        expect(client.skills.detailGlobal).toHaveBeenCalledWith('global');
        expect(client.skills.detailWorkspace).not.toHaveBeenCalled();
        expect(result.current.skillDetail?.promptBody).toBe('Global body');

        await act(async () => { await result.current.expandSkill('shared'); });
        expect(client.skills.detailWorkspace).not.toHaveBeenCalled();
        expect(result.current.skillDetail?.promptBody).toBe('Shared body');
    });

    it('rolls an optimistic toggle back and reports the mutation error', async () => {
        const client = createClient();
        const notify = vi.fn();
        client.skills.listWorkspace.mockResolvedValue([{ name: 'impl' }]);
        client.skills.updateWorkspaceConfig.mockRejectedValue(new Error('save failed'));
        const { result } = renderHook(() => useWorkspaceSkillsController({
            workspaceId: 'ws-a',
            resolveClient: () => client as any,
            notify,
        }));
        await waitFor(() => expect(result.current.skillsLoading).toBe(false));

        await act(async () => { await result.current.toggleSkill('impl', false); });

        expect(result.current.disabledSkills).toEqual([]);
        expect(result.current.skillToggleSaving).toBe(false);
        expect(notify).toHaveBeenCalledWith('save failed', 'error');
    });

    it('keeps existing skill data visible when a config refresh fails', async () => {
        const client = createClient();
        client.skills.listWorkspace.mockResolvedValue([{ name: 'impl' }]);
        client.skills.getWorkspaceConfig.mockRejectedValue(new Error('config unavailable'));
        const { result } = renderHook(() => useWorkspaceSkillsController({
            workspaceId: 'ws-a',
            resolveClient: () => client as any,
        }));

        await waitFor(() => expect(result.current.skillsLoading).toBe(false));

        expect(result.current.skills.map(skill => skill.name)).toEqual(['impl']);
        expect(result.current.skillsError).toBe('config unavailable');
    });

    it('removes the configured root when the listed skill uses a nested candidate folder', async () => {
        const client = createClient();
        client.skills.listWorkspace.mockResolvedValue([
            { name: 'shared', source: 'extra-folder', folderPath: '/shared/.github/skills' },
        ]);
        client.skills.getWorkspaceConfig.mockResolvedValue({ disabledSkills: [], extraSkillFolders: ['/shared'] });
        const { result } = renderHook(() => useWorkspaceSkillsController({
            workspaceId: 'ws-a',
            resolveClient: () => client as any,
        }));
        await waitFor(() => expect(result.current.skillsLoading).toBe(false));

        await act(async () => { await result.current.removeExtraSkillFolder('/shared/.github/skills'); });

        expect(client.skills.updateWorkspaceConfig).toHaveBeenCalledWith('ws-a', {
            disabledSkills: [],
            extraSkillFolders: [],
        });
    });

    it('rolls linked-folder and preference state back when linking fails', async () => {
        const client = createClient();
        const notify = vi.fn();
        client.skills.getWorkspacePath.mockResolvedValue({ path: '/repo-b/.github/skills', skillCount: 2, accessible: true });
        client.preferences.patchRepo.mockRejectedValue(new Error('preference save failed'));
        const { result } = renderHook(() => useWorkspaceSkillsController({
            workspaceId: 'ws-a',
            resolveClient: () => client as any,
            repos: [{ workspace: { id: 'repo-b', name: 'Repo B', rootPath: '/repo-b' } } as any],
            loadLinkedRepoPreferences: true,
            notify,
        }));
        await waitFor(() => expect(result.current.skillsLoading).toBe(false));

        let linked = true;
        await act(async () => { linked = await result.current.linkRepo({ id: 'repo-b', name: 'Repo B', rootPath: '/repo-b' }); });

        expect(linked).toBe(false);
        expect(result.current.extraSkillFolders).toEqual([]);
        expect(result.current.linkedRepoIds).toEqual([]);
        expect(notify).toHaveBeenCalledWith('preference save failed', 'error');
    });
});
