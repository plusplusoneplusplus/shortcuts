import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSkillInstallController } from '../../../../src/server/spa/client/react/features/skills/useSkillInstallController';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

function createClient() {
    return {
        skills: {
            listBundledWorkspace: vi.fn().mockResolvedValue([]),
            scanWorkspace: vi.fn(),
            installWorkspace: vi.fn().mockResolvedValue({ installed: 1, skipped: 0, failed: 0, details: [] }),
        },
        preferences: {},
    };
}

describe('useSkillInstallController', () => {
    it('ignores a bundled-skills response from a previous workspace', async () => {
        const client = createClient();
        const oldBundled = deferred<any[]>();
        client.skills.listBundledWorkspace.mockImplementation((workspaceId: string) => (
            workspaceId === 'old' ? oldBundled.promise : Promise.resolve([{ name: 'new-bundle', path: '/new' }])
        ));
        const resolveClient = () => client as any;
        const { result, rerender } = renderHook(
            ({ workspaceId }) => useSkillInstallController({ workspaceId, resolveClient, onInstalled: vi.fn() }),
            { initialProps: { workspaceId: 'old' } },
        );

        rerender({ workspaceId: 'new' });
        await waitFor(() => expect(result.current.bundledSkills.map(skill => skill.name)).toEqual(['new-bundle']));
        await act(async () => {
            oldBundled.resolve([{ name: 'old-bundle', path: '/old' }]);
            await oldBundled.promise;
        });

        expect(result.current.bundledSkills.map(skill => skill.name)).toEqual(['new-bundle']);
    });

    it('drops a scan response after the install source changes', async () => {
        const client = createClient();
        const scan = deferred<any>();
        client.skills.scanWorkspace.mockReturnValue(scan.promise);
        const { result } = renderHook(() => useSkillInstallController({
            workspaceId: 'ws',
            resolveClient: () => client as any,
            onInstalled: vi.fn(),
        }));
        act(() => {
            result.current.selectSource('github');
            result.current.setGithubUrl('https://github.com/org/skills');
        });
        act(() => { void result.current.scan(); });
        await waitFor(() => expect(result.current.scanning).toBe(true));

        act(() => result.current.selectSource('bundled'));
        await act(async () => {
            scan.resolve({ success: true, skills: [{ name: 'late', path: '/late' }] });
            await scan.promise;
        });

        expect(result.current.scanResult).toBeNull();
        expect(result.current.selectedGithub.size).toBe(0);
        expect(result.current.scanning).toBe(false);
    });

    it('builds a typed GitHub install payload from the selected scan results', async () => {
        const client = createClient();
        const onInstalled = vi.fn();
        const notify = vi.fn();
        client.skills.scanWorkspace.mockResolvedValue({
            success: true,
            skills: [
                { name: 'one', path: '/one' },
                { name: 'two', path: '/two', alreadyExists: true },
            ],
        });
        const { result } = renderHook(() => useSkillInstallController({
            workspaceId: 'ws',
            resolveClient: () => client as any,
            onInstalled,
            notify,
        }));
        act(() => {
            result.current.selectSource('github');
            result.current.setGithubUrl('https://github.com/org/skills');
        });
        await act(async () => { await result.current.scan(); });
        act(() => result.current.toggleGithub('two', false));

        await act(async () => { await result.current.install(); });

        expect(client.skills.installWorkspace).toHaveBeenCalledWith('ws', {
            source: 'github',
            url: 'https://github.com/org/skills',
            skillsToInstall: [{ name: 'one', path: '/one' }],
        });
        expect(notify).toHaveBeenCalledWith('1 skill(s) installed successfully', 'success');
        expect(onInstalled).toHaveBeenCalledTimes(1);
    });
});
