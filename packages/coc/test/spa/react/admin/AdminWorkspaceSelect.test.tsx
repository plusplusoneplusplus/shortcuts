import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminWorkspaceSelect } from '../../../../src/server/spa/client/react/admin/AdminWorkspaceSelect';
import { getAdminSettingDefinition } from '../../../../src/config/admin-setting-definitions';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/admin/adminTarget', () => {
    const server = { client: { workspaces: { list } } };
    return { useAdminServer: () => server };
});

describe('IC3 Admin workspace selection', () => {
    beforeEach(() => list.mockReset());

    function show(value = '', includeRepoGroups = false) {
        const onChange = vi.fn();
        const rendered = render(<AdminWorkspaceSelect value={value} onChange={onChange}
            label="Command workspace" data-testid="workspace" includeRepoGroups={includeRepoGroups} />);
        return { ...rendered, onChange };
    }

    it('lists only registered physical workspaces from the configured Admin server', async () => {
        list.mockResolvedValue({ workspaces: [
            { id: 'alpha', name: 'Alpha', rootPath: 'fixture-root' },
            { id: 'group-team', name: 'Group', rootPath: 'fixture-root', virtual: true },
            { id: 'missing', name: 'Missing', rootPath: '' },
        ] });
        const { onChange } = show();
        await waitFor(() => expect(screen.getByRole('option', { name: 'Alpha (alpha)' })).toBeDefined());
        expect(screen.queryByRole('option', { name: /Group/ })).toBeNull();
        expect(screen.queryByRole('option', { name: 'Missing (missing)' })).toBeNull();
        fireEvent.change(screen.getByTestId('workspace'), { target: { value: 'alpha' } });
        expect(onChange).toHaveBeenCalledWith('alpha');
    });

    it('includes labeled repo groups only when enabled, excluding other virtual scopes and missing roots', async () => {
        list.mockResolvedValue({ workspaces: [
            { id: 'alpha', name: 'Alpha', rootPath: 'fixture-root' },
            { id: 'group-team', name: 'Team', rootPath: 'fixture-group', virtual: true },
            { id: 'my_work', name: 'My Work', rootPath: 'fixture-work', virtual: true },
            { id: 'group-missing', name: 'Missing', rootPath: '', virtual: true },
        ] });
        const { onChange } = show('', true);
        await waitFor(() => expect(screen.getByRole('option', { name: 'Team [Repo group] (group-team)' })).toBeDefined());
        expect(screen.getByRole('option', { name: 'Alpha (alpha)' })).toBeDefined();
        expect(screen.queryByRole('option', { name: /My Work|Missing/ })).toBeNull();
        fireEvent.change(screen.getByTestId('workspace'), { target: { value: 'group-team' } });
        expect(onChange).toHaveBeenCalledWith('group-team');
    });

    it('uses the Command workspace registry control to select a saved repo group', async () => {
        list.mockResolvedValue({ workspaces: [
            { id: 'group-team', name: 'Team', rootPath: 'fixture-group', virtual: true },
            { id: 'my_work', name: 'My Work', rootPath: 'fixture-work', virtual: true },
        ] });
        const definition = getAdminSettingDefinition('teamsIc3OwnCommands.workspaceId')!;
        if (definition.ui?.control?.type !== 'workspace') throw new Error('Expected workspace control');
        const { onChange } = show('group-team', definition.ui.control.includeRepoGroups);
        await screen.findByRole('option', { name: 'Team [Repo group] (group-team)' });
        expect((screen.getByTestId('workspace') as HTMLSelectElement).value).toBe('group-team');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByRole('option', { name: /My Work/ })).toBeNull();
        fireEvent.change(screen.getByTestId('workspace'), { target: { value: 'group-team' } });
        expect(onChange).toHaveBeenCalledWith('group-team');
    });

    it('retains an unavailable saved ID rather than choosing a different workspace', async () => {
        list.mockResolvedValue({ workspaces: [] });
        const { onChange } = show('saved');
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not available'));
        expect((screen.getByTestId('workspace') as HTMLSelectElement).value).toBe('saved');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows a read failure and allows an explicit retry', async () => {
        list.mockRejectedValueOnce(new Error('private transport detail')).mockResolvedValue({ workspaces: [] });
        show();
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unable to load'));
        expect(screen.queryByText(/private transport detail/)).toBeNull();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Refresh/ })); });
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
        expect(list).toHaveBeenCalledTimes(2);
    });
});
