// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillInfo } from '@plusplusoneplusplus/coc-client';
import { AdminSkillSelect } from '../../../../src/server/spa/client/react/admin/AdminSkillSelect';

const mocks = vi.hoisted(() => ({
    workspaces: vi.fn(), list: vi.fn(), workspaceConfig: vi.fn(), globalConfig: vi.fn(),
}));
const server = { client: { workspaces: { list: mocks.workspaces }, skills: {
    listWorkspace: mocks.list, getWorkspaceConfig: mocks.workspaceConfig, getGlobalConfig: mocks.globalConfig,
} } };
let owner = server;
vi.mock('../../../../src/server/spa/client/react/admin/adminTarget', () => ({
    useAdminServer: () => owner,
}));

function props(workspaceId = 'alpha', value = '') {
    return { workspaceId, value, onChange: vi.fn(), label: 'Dispatcher skill', 'data-testid': 'skill' };
}

describe('Admin dispatcher skill selection', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        owner = server;
        mocks.workspaces.mockResolvedValue({ workspaces: [
            { id: 'alpha', rootPath: 'fixture-alpha' }, { id: 'beta', rootPath: 'fixture-beta' },
        ] });
        mocks.list.mockResolvedValue([{ name: 'dispatcher' }]);
        mocks.workspaceConfig.mockResolvedValue({ disabledSkills: [] });
        mocks.globalConfig.mockResolvedValue({ globalDisabledSkills: [] });
    });

    it('requires an explicit execution workspace without reading a default workspace', () => {
        render(<AdminSkillSelect {...props('')} />);
        expect(screen.getByTestId('skill')).toHaveProperty('disabled', true);
        expect(screen.getByRole('option').textContent).toContain('execution workspace first');
        expect(mocks.workspaces).not.toHaveBeenCalled();
    });

    it('lists enabled skills from ordinary workspace sources and reports the selected name', async () => {
        mocks.list.mockResolvedValue([
            { name: 'z-repo', source: 'repo' }, { name: 'a-global', source: 'global' },
            { name: 'extra', source: 'global-extra-folder' }, { name: 'workspace-disabled' },
            { name: 'global-disabled' },
        ]);
        mocks.workspaceConfig.mockResolvedValue({ disabledSkills: ['workspace-disabled'] });
        mocks.globalConfig.mockResolvedValue({ globalDisabledSkills: ['global-disabled'] });
        const p = props();
        render(<AdminSkillSelect {...p} />);
        await waitFor(() => expect(screen.getByTestId('skill')).toHaveProperty('disabled', false));
        expect(mocks.list).toHaveBeenCalledWith('alpha');
        expect(mocks.workspaceConfig).toHaveBeenCalledWith('alpha');
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
            'Select a dispatcher skill', 'a-global', 'extra', 'z-repo',
        ]);
        fireEvent.change(screen.getByTestId('skill'), { target: { value: 'extra' } });
        expect(p.onChange).toHaveBeenCalledWith('extra');
    });

    it.each(['removed', 'virtual', 'empty-root'])('rejects a %s workspace before reading its skills', async kind => {
        mocks.workspaces.mockResolvedValue({ workspaces: kind === 'removed' ? [] : [
            { id: 'alpha', rootPath: kind === 'empty-root' ? '' : 'fixture-root', virtual: kind === 'virtual' },
        ] });
        render(<AdminSkillSelect {...props()} />);
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Check the execution workspace'));
        expect(mocks.list).not.toHaveBeenCalled();
        expect(screen.getByTestId('skill')).toHaveProperty('disabled', true);
    });

    it('loads inherited repo-group skills using the group workspace and disabled-name policy', async () => {
        mocks.workspaces.mockResolvedValue({ workspaces: [
            { id: 'group-team', rootPath: 'fixture-group', virtual: true },
        ] });
        mocks.list.mockResolvedValue([{ name: 'dispatcher' }, { name: 'disabled' }]);
        mocks.workspaceConfig.mockResolvedValue({ disabledSkills: ['disabled'] });
        render(<AdminSkillSelect {...props('group-team')} />);
        await waitFor(() => expect(screen.getByTestId('skill')).toHaveProperty('disabled', false));
        expect(mocks.list).toHaveBeenCalledWith('group-team');
        expect(mocks.workspaceConfig).toHaveBeenCalledWith('group-team');
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
            'Select a dispatcher skill', 'dispatcher',
        ]);
    });

    it('preserves a missing or disabled saved name without choosing a substitute', async () => {
        const p = props('alpha', 'missing');
        render(<AdminSkillSelect {...p} />);
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('missing or disabled'));
        expect(screen.getByTestId('skill')).toHaveProperty('value', 'missing');
        expect(p.onChange).not.toHaveBeenCalled();
    });

    it('explains an empty enabled skill list', async () => {
        mocks.list.mockResolvedValue([]);
        render(<AdminSkillSelect {...props()} />);
        await waitFor(() => expect(screen.getByText(/Install or enable/)).toBeDefined());
    });

    it.each(['workspaces', 'list', 'workspaceConfig', 'globalConfig'] as const)(
        'keeps %s failures visible without private details and supports retry', async request => {
            mocks[request].mockRejectedValueOnce(new Error('private transport detail'));
            render(<AdminSkillSelect {...props()} />);
            await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unable to load'));
            expect(screen.queryByText(/private transport detail/)).toBeNull();
            expect(screen.getByTestId('skill')).toHaveProperty('disabled', true);
            fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
            await waitFor(() => expect(screen.getByTestId('skill')).toHaveProperty('disabled', false));
            expect(screen.queryByRole('alert')).toBeNull();
        },
    );

    it('rejects a late skill list after switching execution workspaces', async () => {
        let resolve!: (skills: SkillInfo[]) => void;
        mocks.list.mockImplementationOnce(() => new Promise<SkillInfo[]>(r => { resolve = r; }));
        const view = render(<AdminSkillSelect {...props()} />);
        await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('alpha'));
        view.rerender(<AdminSkillSelect {...props('beta')} />);
        await waitFor(() => expect(screen.getByTestId('skill')).toHaveProperty('disabled', false));
        await act(async () => resolve([{ name: 'stale-alpha' }]));
        expect(screen.queryByRole('option', { name: 'stale-alpha' })).toBeNull();
        expect(mocks.list).toHaveBeenLastCalledWith('beta');
    });

    it('rejects a late failure from the prior Admin machine', async () => {
        let reject!: (error: Error) => void;
        mocks.list.mockImplementationOnce(() => new Promise((_resolve, r) => { reject = r; }));
        const view = render(<AdminSkillSelect {...props()} />);
        await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
        owner = { ...server };
        view.rerender(<AdminSkillSelect {...props()} />);
        await waitFor(() => expect(screen.getByTestId('skill')).toHaveProperty('disabled', false));
        await act(async () => reject(new Error('old machine unavailable')));
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('discards pending results on unmount', async () => {
        let resolve!: (skills: SkillInfo[]) => void;
        mocks.list.mockImplementationOnce(() => new Promise<SkillInfo[]>(r => { resolve = r; }));
        const view = render(<AdminSkillSelect {...props()} />);
        await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
        view.unmount();
        await act(async () => resolve([{ name: 'late' }]));
        expect(screen.queryByRole('combobox')).toBeNull();
    });
});
