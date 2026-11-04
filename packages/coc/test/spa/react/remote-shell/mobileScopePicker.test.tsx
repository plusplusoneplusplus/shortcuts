/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMobileScopePicker } from '../../../../src/server/spa/client/react/features/remote-shell/mobileScopePicker';
import type { useScopePickerModel } from '../../../../src/server/spa/client/react/features/remote-shell/useScopePickerModel';
import type { ContextMenuItem } from '../../../../src/server/spa/client/react/tasks/comments/ContextMenu';

vi.mock('../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: ({ items }: { items: ContextMenuItem[] }) => (
        <div role="menu">{items.map(item => <button key={item.label} onClick={item.onClick}>{item.label}</button>)}</div>
    ),
}));

type Model = ReturnType<typeof useScopePickerModel>;
function makeModel() {
    const ref = { kind: 'group', key: 'remote:box:group-shared' };
    return {
        pinnedScopesEnabled: true,
        pinsFull: true,
        isPinned: vi.fn((candidate: { key: string }) => candidate.key === ref.key),
        togglePin: vi.fn(),
        selectScope: vi.fn(),
        pinnedRows: [{ id: 'group-pin', ref, targetId: ref.key, label: 'Pinned group', unseen: 2, partial: true }],
        virtualRows: [{ id: 'work', icon: '💼', label: 'My Work', active: false, onSelect: vi.fn() }],
        groupRows: [
            { id: 'group-shared', name: 'Local group', pinRef: { kind: 'group', key: 'group-shared' }, workspace: { id: 'group-shared' } },
            { id: ref.key, name: 'Remote group', pinRef: ref, workspace: { id: 'group-shared', remote: { serverId: 'box' } }, isRemote: true, serverLabel: 'Box' },
            { id: 'remote:offline:group-shared', name: 'Offline group', pinRef: { kind: 'group', key: 'remote:offline:group-shared' }, workspace: {}, offline: true },
        ],
        buildGroupMenuItems: vi.fn(() => [{ label: 'Edit', onClick: vi.fn() }]),
        buildRowMenuItems: vi.fn(() => []),
    } as unknown as Model;
}

function Harness({ model, prefix }: { model: Model; prefix: 'scope-picker' | 'scope-list' }) {
    const picker = useMobileScopePicker(model);
    return <>{picker.renderSections(prefix)}{picker.menus}</>;
}
afterEach(cleanup);

describe.each(['scope-picker', 'scope-list'] as const)('shared %s touch sections', prefix => {
    it('preserves qualified navigation and offline read-only controls', () => {
        const model = makeModel();
        render(<Harness model={model} prefix={prefix} />);
        fireEvent.click(screen.getAllByTestId('repo-group-item')[1]);
        expect(model.selectScope).toHaveBeenCalledWith('remote:box:group-shared');
        expect(screen.getAllByTestId('repo-group-row-menu').map(el => el.getAttribute('data-remote-key')))
            .toEqual(['group-shared', 'remote:box:group-shared']);
        expect(screen.getAllByTestId('repo-group-item')[2]).toBeDisabled();
        fireEvent.click(screen.getByTestId(`${prefix}-virtual-item`));
        expect(model.virtualRows[0].onSelect).toHaveBeenCalledOnce();
    });

    it('keeps touch pins visible and unpin available when capacity is full without navigating', () => {
        const model = makeModel();
        render(<Harness model={model} prefix={prefix} />);
        const unpin = screen.getAllByLabelText('Unpin Remote group')[0];
        expect(unpin).not.toBeDisabled();
        expect(unpin.className).not.toMatch(/hidden|opacity-0|group-hover/);
        expect(screen.getByLabelText('Pin Local group')).toBeDisabled();
        fireEvent.click(unpin);
        expect(model.togglePin).toHaveBeenCalledWith({ kind: 'group', key: 'remote:box:group-shared' });
        expect(model.selectScope).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId(`${prefix}-pinned-item`));
        expect(model.selectScope).toHaveBeenCalledWith('remote:box:group-shared');
    });

    it('opens the exact remote group menu and dismisses it before editing', () => {
        const model = makeModel();
        const edit = vi.fn();
        vi.mocked(model.buildGroupMenuItems).mockReturnValue([{ label: 'Edit', onClick: edit }]);
        render(<Harness model={model} prefix={prefix} />);
        fireEvent.click(screen.getByLabelText('More actions for Remote group'));
        expect(model.buildGroupMenuItems).toHaveBeenCalledWith(model.groupRows[1].workspace);
        expect(model.selectScope).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Edit'));
        expect(edit).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
