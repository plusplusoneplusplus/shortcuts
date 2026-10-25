import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminWorkspaceSelect } from '../../../../src/server/spa/client/react/admin/AdminWorkspaceSelect';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/admin/adminTarget', () => {
    const server = { client: { workspaces: { list } } };
    return { useAdminServer: () => server };
});

describe('IC3 Admin workspace selection', () => {
    beforeEach(() => list.mockReset());

    function show(value = '') {
        const onChange = vi.fn();
        const rendered = render(<AdminWorkspaceSelect value={value} onChange={onChange}
            label="Command workspace" data-testid="workspace" />);
        return { ...rendered, onChange };
    }

    it('lists only registered physical workspaces from the configured Admin server', async () => {
        list.mockResolvedValue({ workspaces: [
            { id: 'alpha', name: 'Alpha', rootPath: 'fixture-root' },
            { id: 'group', name: 'Group', rootPath: 'fixture-root', virtual: true },
            { id: 'missing', name: 'Missing', rootPath: '' },
        ] });
        const { onChange } = show();
        await waitFor(() => expect(screen.getByRole('option', { name: 'Alpha (alpha)' })).toBeDefined());
        expect(screen.queryByRole('option', { name: 'Group (group)' })).toBeNull();
        expect(screen.queryByRole('option', { name: 'Missing (missing)' })).toBeNull();
        fireEvent.change(screen.getByTestId('workspace'), { target: { value: 'alpha' } });
        expect(onChange).toHaveBeenCalledWith('alpha');
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
