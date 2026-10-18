/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import * as host from '../../../../src/server/spa/client/react/features/repo-settings/WorkspaceSettingsHost';
import {
    WorkspaceSettingsProvider, WorkspaceSettingsSlot, useWorkspaceSettingsOwner,
} from '../../../../src/server/spa/client/react/features/repo-settings/WorkspaceSettingsHost';

afterEach(cleanup);

const mount = vi.fn();
function Form() {
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    useEffect(() => { mount(); }, []);
    return <div data-testid="settings-form">
        <input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} />
        <button onClick={() => setError('Validation failed')}>Save</button>
        {error && <div role="alert">{error}</div>}
    </div>;
}

function Owner() {
    return <span data-testid="settings-owner">{useWorkspaceSettingsOwner()}</span>;
}

function Page({ panel = true, owner = 'ws-a', tabOwner = owner }: { panel?: boolean; owner?: string; tabOwner?: string }) {
    return <WorkspaceSettingsProvider ownerKey={owner} renderPage={() => <Form />}>
        <Owner />
        {panel && <WorkspaceSettingsSlot ownerKey={tabOwner} />}
    </WorkspaceSettingsProvider>;
}

describe('panel Settings page', () => {
    it('mounts on first panel open and keeps the exact form, edits and validation across close/reopen', () => {
        mount.mockClear();
        const view = render(<Page panel={false} />);
        expect(screen.queryByTestId('settings-form')).toBeNull();
        view.rerender(<Page />);
        const input = within(screen.getByTestId('panel-settings-host')).getByRole('textbox', { name: 'Draft' });
        fireEvent.change(input, { target: { value: 'unsaved' } });
        fireEvent.click(screen.getByText('Save'));
        view.rerender(<Page panel={false} />);
        expect(screen.queryByTestId('panel-settings-host')).toBeNull();
        view.rerender(<Page />);
        expect(within(screen.getByTestId('panel-settings-host')).getByRole('textbox')).toBe(input);
        expect(input).toHaveValue('unsaved');
        expect(screen.getByRole('alert')).toHaveTextContent('Validation failed');
        expect(mount).toHaveBeenCalledTimes(1);
    });

    it('keeps the form in a replacement slot when the old slot unmounts after it attached', () => {
        function Swap({ second }: { second: boolean }) {
            return <WorkspaceSettingsProvider ownerKey="ws-a" renderPage={() => <Form />}>
                {second ? <div key="b"><WorkspaceSettingsSlot ownerKey="ws-a" /></div>
                    : <div key="a"><WorkspaceSettingsSlot ownerKey="ws-a" /></div>}
            </WorkspaceSettingsProvider>;
        }
        const view = render(<Swap second={false} />);
        const input = screen.getByRole('textbox');
        view.rerender(<Swap second />);
        expect(within(screen.getByTestId('panel-settings-host')).getByRole('textbox')).toBe(input);
    });

    it('keeps matching local and remote owners separate, and rejects stale tab ownership', () => {
        const view = render(<Page owner="remote:server-a:ws-a" />);
        expect(screen.getByTestId('settings-owner')).toHaveTextContent('remote:server-a:ws-a');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'remote draft' } });
        view.rerender(<Page owner="remote:server-b:ws-a" tabOwner="remote:server-a:ws-a" />);
        expect(screen.getByRole('status')).toHaveTextContent('unavailable');
        expect(screen.queryByRole('textbox')).toBeNull();
        view.rerender(<Page owner="ws-a" />);
        expect(screen.getByRole('textbox')).toHaveValue('');
    });

    it('has no page-level Settings host or alternate activation', () => {
        render(<Page />);
        expect(screen.queryByTestId('top-settings-host')).toBeNull();
        expect(screen.queryByText('Show Settings here')).toBeNull();
        expect(host).not.toHaveProperty('useWorkspaceSettingsPanel');
    });
});
